// THE MONTHLY ACCOUNTS: reading the butler's statements, and asking for the
// big picture now.
//
// How a request works, step by step:
// 1. The app makes an id for the request (like "acc-1761470000-3fa9c21b") and
//    asks GitHub to start the butler's accounts.yml workflow with that id.
// 2. It looks through the workflow's recent runs for the one whose title
//    carries the id ("Accounts: acc-..."), then watches that run until it has
//    finished. Claude Opus thinks hard over the accounts: usually a minute or
//    two, now and then longer.
// 3. It reads state/accounts.json, where the butler has filed the statement
//    under the same id, and shows it.
// The request waiting for its statement is remembered on the phone, so
// closing the app and opening it again carries on waiting. One at a time.
// This module keeps going while you look at other pages; the Accounts page
// (views/accounts.js) and the Ledger's line about it only draw what is here.

import { buzz, prefersReducedMotion } from "./dom.js";
import { store } from "./store.js";
import { explain, explainAccounts } from "./github.js";
import { toDate } from "./time.js";

export const COST = "15 to 25¢";
const LIMIT = 4 * 60 * 1000;          // no run found by four minutes: stop waiting (it may never have started)
const SLOW_AFTER = 6 * 60 * 1000;     // a run still going after six minutes: say he's taking his time
const HARD_LIMIT = 12 * 60 * 1000;    // a run found but still going: stop watching after twelve minutes
const SLOW_EVERY = 15 * 1000;         // after four minutes, look every 15 seconds rather than every 5
const FORGET_AFTER = 2 * 60 * 60 * 1000;   // a request pending for over two hours is let go on opening
const STALE_AFTER = 10 * 60 * 1000;   // re-read the accounts at most this often on their own
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const accState = {
  client: null,
  accounts: null,     // the statements, oldest first; null until read (or remembered)
  missing: false,     // accounts.json isn't there yet: none written so far
  readAt: 0,
  error: null,
  loading: false,
  triedAt: 0,
  pending: null,      // {request_id, at, phase, runId, runUrl}
  confirming: false,  // "Request the big picture now" pressed once: asking about the cost
  note: null,         // how the last request went, when it didn't simply arrive: {tone, text, link}
  justWritten: null,  // request_id of a statement that has just arrived (the page scrolls to it)
  lostRequest: null,  // request_id the app stopped watching while it might still be drawn up
};

/** An id the app makes for each request: letters, digits, "-" and "_" only, at most 64. */
export function makeRequestId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `acc-${Math.floor(Date.now() / 1000)}-${hex}`;
}

function persistPending() {
  if (accState.client && accState.client.demo) return;   // the sample household remembers nothing
  const p = accState.pending;
  store.setPendingAccounts(p ? { request_id: p.request_id, at: p.at, runId: p.runId || null, runUrl: p.runUrl || null } : null);
}

const onPage = (...routes) => routes.includes(document.body.dataset.route);

function rerender(ctx) {
  if (onPage("accounts", "ledger")) ctx.render();
}

function normalise(list) {
  return (Array.isArray(list) ? list : []).filter((a) => a && typeof a === "object");
}

/**
 * Called whenever the app connects (or opens already connected). Shows the
 * statements kept from last time at once, and carries on waiting for a
 * request sent before the app was closed.
 */
export function bindAccounts(ctx) {
  const client = ctx.client;
  if (accState.client === client) return;
  Object.assign(accState, {
    client, accounts: null, missing: false, readAt: 0, error: null, loading: false, triedAt: 0,
    pending: null, confirming: false, note: null, justWritten: null, lostRequest: null,
  });
  if (!client || client.demo) return;
  const cached = store.cachedAccounts();
  if (cached && typeof cached === "object") {
    accState.accounts = cached.missing ? [] : normalise(cached.accounts);
    accState.missing = !!cached.missing;
  }
  const p = store.pendingAccounts();
  if (p && p.request_id && REQUEST_ID_PATTERN.test(p.request_id) && Date.now() - (Number(p.at) || 0) <= FORGET_AFTER) {
    accState.pending = { ...p, phase: "waiting" };
    // The statement may have arrived while the app was closed: look first, then wait.
    loadAccounts(ctx, { quiet: true }).then(() => {
      if (accState.client === client && accState.pending) follow(ctx, client, accState.pending);
    });
  } else if (p) {
    store.setPendingAccounts(null);
  }
}

/** Reads the accounts when they haven't been read for a while (or ever). */
export function freshenAccounts(ctx, { every = STALE_AFTER } = {}) {
  if (!accState.client || accState.loading) return;
  if (Date.now() - accState.triedAt < every) return;
  setTimeout(() => loadAccounts(ctx, { quiet: true }), 0);
}

/** Reads state/accounts.json. Resolves true when it was read. */
export async function loadAccounts(ctx, { quiet = false } = {}) {
  const client = accState.client;
  if (!client || typeof client.accounts !== "function") return false;
  accState.loading = true;
  accState.triedAt = Date.now();
  let ok = false;
  try {
    const file = await (quiet ? client.accounts() : ctx.withLoading(client.accounts()));
    if (accState.client !== client) return false;
    accState.accounts = file ? normalise(file.accounts) : [];
    accState.missing = !file;
    accState.readAt = Date.now();
    accState.error = null;
    if (!client.demo) store.saveAccounts(file ? { accounts: accState.accounts } : { missing: true });
    ok = true;
    reconcile(ctx);
  } catch (err) {
    if (accState.client !== client) return false;
    accState.error = explain(err, client.repo);
  } finally {
    if (accState.client === client) accState.loading = false;
  }
  rerender(ctx);
  return ok;
}

/** The statement filed for a request id, if the butler has written it. */
export function findAccount(requestId) {
  return (accState.accounts || []).find((a) => a.request_id === requestId || a.id === `acc-${requestId}`) || null;
}

/** When a statement was written, for ordering (newest last). */
export function writtenAt(a) {
  const d = toDate(a && a.written);
  return d ? d.getTime() : 0;
}

/**
 * The newest written statement, for the Ledger's line: from accounts.json, or
 * the ledger's own copy (app-data's latest_accounts) when that is newer.
 */
export function latestWritten(ctx) {
  const list = (accState.accounts || []).filter((a) => a.status !== "failed");
  let best = list.length ? list.reduce((x, y) => (writtenAt(y) >= writtenAt(x) ? y : x)) : null;
  const fromData = ctx.data && ctx.data.latest_accounts;
  if (fromData && typeof fromData === "object" && fromData.status !== "failed" && (fromData.headline || fromData.period)) {
    if (!best || writtenAt(fromData) > writtenAt(best)) best = fromData;
  }
  return best;
}

/** Whether a statement carries the butler's figures (not when Hevy couldn't be read). */
export function hasFigures(acc) {
  return !!(acc && acc.numbers && typeof acc.numbers === "object");
}

/**
 * If the statements now hold the one we were waiting for, stop waiting. Also
 * notices a statement the app had stopped watching for, so the note saying
 * "pull down in a few minutes" doesn't outstay the statement itself.
 */
function reconcile(ctx) {
  const p = accState.pending;
  if (!p) {
    const acc = accState.lostRequest ? findAccount(accState.lostRequest) : null;
    if (!acc) return false;
    const id = accState.lostRequest;
    accState.lostRequest = null;
    return settle(ctx, id, acc);
  }
  const acc = findAccount(p.request_id);
  if (!acc) return false;
  accState.pending = null;
  return settle(ctx, p.request_id, acc);
}

function settle(ctx, requestId, acc) {
  const failed = acc.status === "failed";
  accState.justWritten = failed ? null : requestId;   // a failed one: the note at the top says so
  accState.note = !failed ? null : hasFigures(acc)
    ? { tone: "warn", text: `The butler drew up the figures, ${ctx.title}, but couldn't write the review itself this time. His note on it is below; do try again later.` }
    : { tone: "warn", text: `The butler couldn't draw up the accounts this time, ${ctx.title}. His note on it is below; do try again later.` };
  persistPending();
  buzz([15, 50, 15]);
  if (!onPage("accounts")) {
    ctx.slip(acc.status === "failed"
      ? `The butler couldn't finish the accounts this time, ${ctx.title}.`
      : `Your accounts are drawn up, ${ctx.title}.`,
    { ms: 9000, link: { href: "#/accounts", label: "Read them" } });
  }
  return true;
}

/** "Request the big picture now" pressed once: ask about the cost first. */
export function askToConfirm(ctx, on) {
  if (accState.pending) return;
  accState.confirming = !!on;
  if (on) accState.note = null;
  ctx.render();
  // The question about the cost appears where the button was: keep it in view
  // (and the button again after "Not now"), so the tap plainly did something.
  bringIntoView(on ? "acc-confirm-yes" : "acc-request-btn", { focus: true });
}

function bringIntoView(id, { focus = false } = {}) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el || !onPage("accounts")) return;
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    if (focus) el.focus({ preventScroll: true });
  });
}

/** Asks the butler for the big picture now (after the cost has been confirmed). */
export async function requestAccounts(ctx) {
  const client = accState.client;
  if (!client || accState.pending) return;
  const p = { request_id: makeRequestId(), at: Date.now(), phase: "sending" };
  accState.pending = p;
  accState.confirming = false;
  accState.note = null;
  accState.justWritten = null;
  accState.lostRequest = null;
  persistPending();
  buzz(12);
  ctx.render();
  bringIntoView("acc-pending");

  try {
    // GitHub looks up the butler's branch fresh each time (it may have been renamed).
    const ref = await client.accountsDispatch(p.request_id);
    if (!client.demo && typeof ref === "string" && ref) store.branch = ref;
  } catch (err) {
    if (accState.client !== client || accState.pending !== p) return;
    accState.pending = null;
    persistPending();
    accState.note = { tone: "bad", text: `Your request didn't reach the butler, ${ctx.title}. ${explainAccounts(err, client.repo)}` };
    ctx.render();
    return;
  }
  if (accState.client !== client || accState.pending !== p) return;
  p.phase = "waiting";
  persistPending();
  ctx.render();
  follow(ctx, client, p);
}

const following = new Set();

async function follow(ctx, client, p) {
  if (following.has(p.request_id)) return;
  following.add(p.request_id);
  try {
    await followInner(ctx, client, p);
  } finally {
    following.delete(p.request_id);
  }
}

async function followInner(ctx, client, p) {
  const every = client.demo ? 1000 : 5000;
  const mine = () => accState.client === client && accState.pending === p;
  let run = null;
  let errors = 0;
  let lastError = null;

  while (true) {
    await wait(!client.demo && Date.now() - p.at > LIMIT ? SLOW_EVERY : every);
    if (!mine()) return;
    try {
      if (p.runId) {
        run = (await client.accountsRun(p.runId)) || run;
      } else {
        const runs = await client.accountsRuns();
        run = runs.find((r) => String(r.display_title || r.name || "").includes(p.request_id)) || null;
        if (run) {
          p.runId = run.id;
          p.runUrl = run.html_url || null;
          persistPending();
        }
      }
      errors = 0;
    } catch (err) {
      errors += 1;
      lastError = err;
      if (errors >= 5) break;   // five failures in a row: more than a hiccup
    }
    if (!mine()) return;
    if (run && run.status === "completed") break;
    const waited = Date.now() - p.at;
    if (!p.runId && waited > LIMIT) break;      // no run at all: it probably never started
    if (waited > HARD_LIMIT) break;             // found, but still going after twelve minutes
    const phase = run ? (waited > SLOW_AFTER ? "slow" : "running") : p.phase;
    if (phase !== p.phase) { p.phase = phase; rerender(ctx); }
  }
  if (!mine()) return;

  const t = ctx.title;
  const link = client.demo ? null : {
    href: (run && run.html_url) || p.runUrl || (typeof client.accountsRunsPage === "function" ? client.accountsRunsPage() : ""),
    label: "See it on GitHub",
  };
  const letGo = (note, { lost = false } = {}) => {
    accState.pending = null;
    persistPending();
    accState.note = note;
    // Still being drawn up, perhaps: remember it, so the statement clears this note when it comes.
    accState.lostRequest = lost ? p.request_id : null;
    rerender(ctx);
    if (!onPage("accounts")) ctx.slip(note.text, { tone: "warn", ms: 12000, link: { href: "#/accounts", label: "The accounts" } });
  };

  if (errors >= 5) {
    letGo({ tone: "warn", link,
      text: `I lost touch with GitHub while waiting, ${t}. ${explain(lastError, client.repo)} The request went through all the same; the statement will appear here once I can reach GitHub again. Pull down to look.` }, { lost: true });
    return;
  }
  if (!run || run.status !== "completed") {
    letGo({ tone: "warn", link,
      text: run
        ? `He's taking his time over the accounts, ${t}. They will appear here when he's done; pull down on this page in a few minutes to look.`
        : `I couldn't see the butler start on the accounts, ${t}. GitHub may be busy; the statement will appear here if he gets to it. Pull down in a few minutes to look.` }, { lost: true });
    return;
  }

  // The run has finished: fetch the statement (GitHub can take a moment to serve the new file).
  p.phase = "fetching";
  rerender(ctx);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait(client.demo ? 500 : 3000);
    if (!mine()) return;
    await loadAccounts(ctx, { quiet: true });
    if (!mine()) return;   // reconcile() found it
  }
  if (!mine()) return;
  if (run.conclusion && run.conclusion !== "success") {
    letGo({ tone: "bad", link,
      text: run.conclusion === "cancelled"
        ? `The accounts were called off before he could finish them, ${t}. Do request them again when you're ready.`
        : `He couldn't finish the accounts, ${t} (the run ended with "${run.conclusion}"). Do try again in a little while.` });
    return;
  }
  letGo({ tone: "warn", link,
    text: `He has finished the accounts, ${t}, but they haven't reached the ledger yet. Pull down on this page in a minute to fetch them.` }, { lost: true });
}

// ------------------------------------------------------------ the waiting --

const LINES = [
  "Ruling a fresh page, {t}.",
  "Adding up the columns, {t}. Twice, as is proper.",
  "Turning back through the month's pages, {t}.",
  "Weighing the legs against the arms, {t}.",
  "Checking the sums against Hevy, {t}.",
  "Considering the stalls with some care, {t}.",
  "Sharpening a second pencil, {t}. The first has given its all.",
  "Consulting the Trainer's settings, {t}.",
];

export function accountsWaitLine(title, last) {
  let i = Math.floor(Math.random() * LINES.length);
  if (i === last) i = (i + 1) % LINES.length;
  return { index: i, text: LINES[i].replaceAll("{t}", title) };
}
