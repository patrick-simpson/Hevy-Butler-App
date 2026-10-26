// A WORD WITH THE BUTLER: sending a question and waiting for his answer.
//
// How it works, step by step:
// 1. The app makes an id for the question (like "q-1761470000-3fa9c21b") and asks
//    GitHub to start the butler's ask.yml workflow with the question, that id,
//    and whether it starts a fresh conversation.
// 2. It looks through the workflow's recent runs for the one whose title
//    carries that id, then watches that run until it has finished.
// 3. It reads state/conversation.json, where the butler has written his answer
//    under the same id, and shows it.
// The question waiting for its answer is remembered on the phone, so closing
// the app and opening it again carries on waiting. One question at a time.
// This module keeps going while you look at other pages; the "Ask" page
// (views/ask.js) only draws what is here.

import { buzz } from "./dom.js";
import { store } from "./store.js";
import { explain, explainAsk } from "./github.js";

export const MAX_QUESTION = 1000;
const LIMIT = 4 * 60 * 1000;          // no run found by four minutes: stop waiting (it may never have started)
const HARD_LIMIT = 11 * 60 * 1000;    // a run found but still going: keep watching up to its 10-minute limit, plus a little
const SLOW_EVERY = 15 * 1000;         // after four minutes, look every 15 seconds rather than every 4
const FORGET_AFTER = 60 * 60 * 1000;  // a question pending for over an hour is let go on opening
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const askState = {
  client: null,
  convo: null,          // {version, messages: [...]}, oldest first
  convoAt: 0,
  convoError: null,
  loading: false,
  triedAt: 0,           // when the letters were last asked for (worked or not)
  pending: null,        // {ask_id, question, fresh, at, phase, runId, runUrl}
  fresh: false,         // "Start afresh" pressed: the next question begins a new conversation
  note: null,           // how the last question went, when it didn't simply arrive: {tone, text, link}
  draft: "",            // the question being written (kept while you look at other pages)
  justAnswered: null,   // ask_id of an answer that has just arrived (the page scrolls to it)
};

/** An id the app makes for each question: letters, digits, "-" and "_" only, at most 64. */
export function makeAskId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `q-${Math.floor(Date.now() / 1000)}-${hex}`;
}

export const ASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function persistPending() {
  if (askState.client && askState.client.demo) return;   // the sample household remembers nothing
  store.setPendingAsk(askState.pending
    ? { ask_id: askState.pending.ask_id, question: askState.pending.question, fresh: !!askState.pending.fresh,
      at: askState.pending.at, runId: askState.pending.runId || null, runUrl: askState.pending.runUrl || null }
    : null);
}

function persistFresh() {
  if (askState.client && askState.client.demo) return;
  store.askFresh = askState.fresh;
}

function onAskPage() {
  return document.body.dataset.route === "ask";
}

function rerender(ctx) {
  if (onAskPage()) ctx.render();
}

/**
 * Called whenever the app connects (or opens already connected). Shows the
 * letters kept from last time at once, fetches fresh ones, and carries on
 * waiting for a question sent before the app was closed.
 */
export function bindAsk(ctx) {
  const client = ctx.client;
  if (askState.client === client) return;
  const demo = !!(client && client.demo);
  Object.assign(askState, {
    client, convo: null, convoAt: 0, convoError: null, loading: false, triedAt: 0, pending: null,
    fresh: false, note: null, draft: "", justAnswered: null,
  });
  if (!client) return;
  if (!demo) {
    askState.convo = store.cachedConversation();
    askState.fresh = store.askFresh;
    const p = store.pendingAsk();
    if (p && p.ask_id && ASK_ID_PATTERN.test(p.ask_id)) {
      if (Date.now() - (Number(p.at) || 0) > FORGET_AFTER) {
        store.setPendingAsk(null);
      } else {
        askState.pending = { ...p, phase: "waiting" };
      }
    } else if (p) {
      store.setPendingAsk(null);
    }
  }
  if (askState.pending) {
    // His answer may have arrived while the app was closed: look first, then wait.
    loadConversation(ctx, { quiet: true }).then(() => {
      if (askState.client === client && askState.pending) follow(ctx, client, askState.pending);
    });
  }
}

/** Reads state/conversation.json. Resolves true when it was read. */
export async function loadConversation(ctx, { quiet = false } = {}) {
  const client = askState.client;
  if (!client || typeof client.conversation !== "function") return false;
  askState.loading = true;
  askState.triedAt = Date.now();
  rerender(ctx);
  let ok = false;
  try {
    const convo = await (quiet ? client.conversation() : ctx.withLoading(client.conversation()));
    if (askState.client !== client) return false;
    askState.convo = convo;
    askState.convoAt = Date.now();
    askState.convoError = null;
    if (!client.demo) store.saveConversation(convo);
    ok = true;
    reconcile(ctx);
  } catch (err) {
    if (askState.client !== client) return false;
    askState.convoError = explain(err, client.repo);
  } finally {
    if (askState.client === client) askState.loading = false;
  }
  rerender(ctx);
  return ok;
}

/** The message for an ask_id, if the butler has written it. */
export function findMessage(askId) {
  const msgs = (askState.convo && askState.convo.messages) || [];
  return msgs.find((m) => m && m.ask_id === askId) || null;
}

/** If the letters now hold the answer we were waiting for, stop waiting. */
function reconcile(ctx) {
  const p = askState.pending;
  if (!p) return false;
  const msg = findMessage(p.ask_id);
  if (!msg) return false;
  // He regrets he couldn't answer: give the question back, as the other failures do.
  if (msg.status === "failed" && !askState.draft) askState.draft = p.question;
  askState.pending = null;
  askState.note = null;
  askState.justAnswered = p.ask_id;
  persistPending();
  buzz([15, 50, 15]);
  if (!onAskPage()) {
    ctx.slip(msg.status === "failed"
      ? `The butler couldn't answer your question this time, ${ctx.title}.`
      : `The butler has answered your question, ${ctx.title}.`,
    { ms: 9000, link: { href: "#/ask", label: "Read his reply" } });
  }
  return true;
}

/** "Start afresh", or change of mind. */
export function setFresh(ctx, on) {
  if (askState.pending) return;
  askState.fresh = !!on;
  askState.note = null;
  persistFresh();
  ctx.render();
}

/** Sends one question to the butler. */
export async function sendQuestion(ctx, raw) {
  const client = askState.client;
  const question = String(raw || "").trim().slice(0, MAX_QUESTION);
  if (!client || !question || askState.pending) return;
  const p = { ask_id: makeAskId(), question, fresh: askState.fresh, at: Date.now(), phase: "sending" };
  askState.pending = p;
  askState.note = null;
  askState.draft = "";
  askState.justAnswered = null;
  persistPending();
  buzz(12);
  ctx.render();

  try {
    // GitHub looks up the butler's branch fresh each time (it may have been renamed).
    const ref = await client.askDispatch(question, p.ask_id, p.fresh);
    if (!client.demo && typeof ref === "string" && ref) store.branch = ref;
  } catch (err) {
    if (askState.client !== client || askState.pending !== p) return;
    askState.pending = null;
    persistPending();
    askState.draft = question;   // give the question back, so nothing has to be typed again
    askState.note = { tone: "bad", text: `Your question didn't reach the butler, ${ctx.title}. ${explainAsk(err, client.repo)}` };
    ctx.render();
    return;
  }
  if (askState.client !== client || askState.pending !== p) return;
  p.phase = "waiting";
  if (p.fresh) { askState.fresh = false; persistFresh(); }
  persistPending();
  ctx.render();
  follow(ctx, client, p);
}

const following = new Set();

/** Waits for the question's run to finish, then fetches the answer. */
async function follow(ctx, client, p) {
  if (following.has(p.ask_id)) return;
  following.add(p.ask_id);
  try {
    await followInner(ctx, client, p);
  } finally {
    following.delete(p.ask_id);
  }
}

async function followInner(ctx, client, p) {
  const every = client.demo ? 1000 : 4000;
  const mine = () => askState.client === client && askState.pending === p;
  let run = null;
  let errors = 0;
  let lastError = null;

  while (true) {
    // Once he's been at it a while, look less often (a slow GitHub runner, usually).
    await wait(!client.demo && Date.now() - p.at > LIMIT ? SLOW_EVERY : every);
    if (!mine()) return;
    try {
      if (p.runId) {
        run = (await client.askRun(p.runId)) || run;
      } else {
        const runs = await client.askRuns();
        run = runs.find((r) => String(r.display_title || r.name || "").includes(p.ask_id)) || null;
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
    // No run found at all after four minutes: it probably never started.
    if (!p.runId && waited > LIMIT) break;
    // A run found but still queued or going: keep the question waiting (so a
    // second one can't be sent and jostle it) until the workflow's own limit.
    if (waited > HARD_LIMIT) break;
    const phase = run ? (waited > LIMIT ? "slow" : "running") : p.phase;
    if (phase !== p.phase) { p.phase = phase; rerender(ctx); }
  }
  if (!mine()) return;

  const t = ctx.title;
  const link = client.demo ? null : {
    href: (run && run.html_url) || p.runUrl || (typeof client.askRunsPage === "function" ? client.askRunsPage() : ""),
    label: "See it on GitHub",
  };
  const letGo = (note) => {
    askState.pending = null;
    persistPending();
    askState.note = note;
    ctx.render();
  };

  if (errors >= 5) {
    letGo({ tone: "warn", link,
      text: `I lost touch with GitHub while waiting, ${t}. ${explain(lastError, client.repo)} Your question went through all the same; his reply will appear here once I can reach GitHub again. Pull down to look.` });
    return;
  }
  if (!run || run.status !== "completed") {
    letGo({ tone: "warn", link,
      text: `He's taking his time over this one, ${t}. The answer will appear here when he's done; pull down on this page in a few minutes to look.` });
    return;
  }

  // The run has finished: fetch his letter (GitHub can take a moment to serve the new file).
  p.phase = "fetching";
  rerender(ctx);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait(client.demo ? 500 : 3000);
    if (!mine()) return;
    await loadConversation(ctx, { quiet: true });
    if (!mine()) return;   // reconcile() found the answer
  }
  if (!mine()) return;
  if (run.conclusion && run.conclusion !== "success") {
    if (!askState.draft) askState.draft = p.question;
    letGo({ tone: "bad", link,
      text: run.conclusion === "cancelled"
        ? `The question was called off before he could answer, ${t}. Your words are back in the box below; do ring again.`
        : `He couldn't finish answering, ${t} (the run ended with "${run.conclusion}"). Your words are back in the box below, should you care to ring again.` });
    return;
  }
  letGo({ tone: "warn", link,
    text: `He has answered, ${t}, but his letter hasn't reached the ledger yet. Pull down on this page in a minute to fetch it.` });
}
