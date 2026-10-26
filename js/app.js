// The Butler's Ledger: app shell, routing, refresh, Sync and the top hat.

import { h, mount, clear, buzz, prefersReducedMotion } from "./dom.js";
import { store } from "./store.js";
import { liveClient, explain, explainStart, mergeSettings } from "./github.js";
import { demoClient } from "./demo.js";
import { effectiveTitle, loadingLine, makeBell, resignationLetter, folioNumber } from "./eggs.js";
import { roman, ago, toDate, stampET } from "./time.js";
import { renderWelcome } from "./views/welcome.js";
import { renderLedger } from "./views/ledger.js";
import { renderAwaiting } from "./views/awaiting.js";
import { renderBook } from "./views/book.js";
import { renderRules } from "./views/rules.js";
import { renderDiary } from "./views/diary.js";
import { renderAsk } from "./views/ask.js";
import { bindAsk, loadConversation, askState } from "./ask.js";

const $ = (id) => document.getElementById(id);

const ROUTES = {
  ledger: renderLedger,
  awaiting: renderAwaiting,
  ask: renderAsk,
  book: renderBook,
  rules: renderRules,
  diary: renderDiary,
};

const ctx = {
  client: null,
  data: null,
  dataAt: 0,
  stale: false,
  proposalsCount: null,
  round: null,       // the round started from here: {kind: "sync"|"rehearse", phase, at, run, note}
  get title() { return effectiveTitle(this.data); },
  get demo() { return !!(this.client && this.client.demo); },
  navigate(route) { location.hash = `#/${route}`; },
  render() { render(); },
  slip,
  refresh,
  withLoading,
  sync: () => startRound("sync"),
  rehearse: () => startRound("rehearse"),
  get busyRound() { return isBusy(this.round); },
  setProposalsCount(n) {
    const changed = this.proposalsCount !== n;
    this.proposalsCount = n;
    updateBadge();
    // The Ledger names what awaits your word, so it needs the new count too.
    if (changed && ctx.client && currentRoute() === "ledger") render();
  },
  connect(client) {
    ctx.client = client;
    ctx.round = null;
    ctx.data = null;
    ctx.proposalsCount = null;
    const cached = store.cachedData();
    if (!client.demo && cached.data) { ctx.data = cached.data; ctx.dataAt = cached.at; }
    bindAsk(ctx);
    updateChrome();
    refresh({ quiet: !!ctx.data });
  },
  leave() {
    if (!ctx.demo) store.forget();
    else store.mode = null;
    ctx.client = null;
    ctx.data = null;
    ctx.proposalsCount = null;
    ctx.round = null;
    bindAsk(ctx);
    updateChrome();
    ctx.navigate("welcome");
    render();
  },
};

// ----------------------------------------------------------- loading lines --

let loadingDepth = 0;
let rotateTimer = null;

function nextLoadingLine() {
  const line = loadingLine(ctx.title, store.lastLine);
  store.lastLine = line.index;
  $("loading").textContent = line.text;
}

/** Shows a loading line until the returned function is called. */
function holdLoading() {
  loadingDepth += 1;
  const bar = $("loading");
  if (loadingDepth === 1) {
    nextLoadingLine();
    bar.hidden = false;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    loadingDepth -= 1;
    if (loadingDepth === 0) bar.hidden = true;
  };
}

async function withLoading(promise) {
  const release = holdLoading();
  try {
    return await promise;
  } finally {
    release();
  }
}

/**
 * While the butler is on a round, a new line every few seconds, so the page
 * plainly isn't stuck. Screen readers hear the first line only. With reduced
 * motion the first line simply stays.
 */
function rotateLoading(on) {
  clearInterval(rotateTimer);
  rotateTimer = null;
  const bar = $("loading");
  if (!on) { bar.setAttribute("aria-live", "polite"); return; }
  if (prefersReducedMotion()) return;
  rotateTimer = setInterval(() => {
    bar.setAttribute("aria-live", "off");
    nextLoadingLine();
  }, 4500);
}

// -------------------------------------------------------------- the slip --

let slipTimer = null;
/**
 * A short note from the butler at the foot of the page. link: {href, label}
 * adds a link after the text (for "see what happened on GitHub").
 */
function slip(text, { tone = "plain", ms = 5200, link = null } = {}) {
  const el = $("slip");
  clearTimeout(slipTimer);
  el.className = `slip slip-${tone}`;
  el.textContent = text;
  if (link && link.href) {
    const external = /^https?:/.test(link.href);
    el.append(" ", h("a", external ? { href: link.href, target: "_blank", rel: "noopener noreferrer" } : { href: link.href }, link.label));
  }
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("is-in"));
  slipTimer = setTimeout(() => {
    el.classList.remove("is-in");
    setTimeout(() => { if (!el.classList.contains("is-in")) el.hidden = true; }, 260);
  }, ms);
}

// ---------------------------------------------------------------- refresh --

// Pull-to-refresh: a plain re-read of the butler's ledger file. (Sync, the
// button at the top, starts a whole round first; see startRound below.)

let refreshing = null;
/** Re-reads app-data.json. Resolves true when the ledger is fresh. */
async function refresh({ quiet = false } = {}) {
  if (!ctx.client) return false;
  if (refreshing) return refreshing;
  // On the Ask page, pulling down also fetches the butler's letters.
  if (currentRoute() === "ask" && !askState.loading && Date.now() - askState.triedAt > 5000) {
    loadConversation(ctx, { quiet: true });
  }
  refreshing = (async () => {
    let ok = false;
    try {
      const data = overlaySavedSettings(await withLoading(ctx.client.appData()));
      ctx.data = data;
      ctx.dataAt = Date.now();
      ctx.stale = false;
      if (!ctx.demo) store.saveData(data);
      if (!quiet) slip(`The ledger is up to date, ${ctx.title}.`, { ms: 2600 });
      ok = true;
    } catch (err) {
      ctx.stale = true;
      const why = explain(err, ctx.client.repo);
      const when = ctx.dataAt ? ` Showing the copy from ${ago(new Date(ctx.dataAt))}.` : "";
      slip(why + when, { tone: "warn", ms: 9000 });
    } finally {
      refreshing = null;
      updateBusy();
    }
    render();
    countProposals();
    return ok;
  })();
  updateBusy();
  return refreshing;
}

// ---------------------------------------------------------------- sync --
//
// "Sync" (the button at the top) starts the butler's round for real: GitHub
// runs .github/workflows/butler.yml with dry_run "false". We wait for that run
// to finish, then re-read the ledger and say what he found. "Rehearse" (House
// Rules) is the same with dry_run "true". One round at a time from this phone.

const ROUND_LIMIT = 6 * 60 * 1000;   // after this, stop waiting (the round carries on)
const isBusy = (r) => !!r && (r.phase === "sending" || r.phase === "waiting");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setRound(round) {
  ctx.round = round;
  updateBusy();
  if (currentRoute() === "rules") render();
}

async function startRound(kind = "sync") {
  if (!ctx.client) return;
  if (isBusy(ctx.round)) {
    slip(`I am already on my way, ${ctx.title}.`, { ms: 2400 });
    return;
  }
  const client = ctx.client;
  const rehearse = kind === "rehearse";
  const at = Date.now();
  const before = ctx.data;
  setRound({ kind, phase: "sending", at });
  buzz(12);
  const release = holdLoading();
  rotateLoading(true);
  const stillMine = () => ctx.client === client && ctx.round && ctx.round.at === at;
  const finish = () => { rotateLoading(false); release(); };

  // 1. Note the rounds already on record, so the new one is easy to tell apart.
  // 2. Ask GitHub to start the butler.
  let seen;
  try {
    seen = new Set((await client.recentRuns()).map((r) => r.id));
    // (The branch is looked up fresh each time; the name is kept only for show.)
    const ref = await client.dispatch(rehearse);
    if (!client.demo && typeof ref === "string" && ref) store.branch = ref;
  } catch (err) {
    finish();
    if (!stillMine()) return;
    const note = explainStart(err, client.repo);
    setRound({ kind, phase: "failed", at, note });
    slip(`I couldn't start the ${rehearse ? "rehearsal" : "round"}, ${ctx.title}. ${note}`, { tone: "warn", ms: 14000 });
    return;
  }
  if (!stillMine()) { finish(); return; }
  setRound({ kind, phase: "waiting", at });

  // 3. Wait for it to finish.
  const every = client.demo ? 1200 : 5000;
  let run = null;
  let errors = 0;
  let lastError = null;
  while (true) {
    await wait(every);
    if (!stillMine()) { finish(); return; }
    try {
      if (!run) {
        const runs = await client.recentRuns();
        const fresh = runs.filter((r) => !seen.has(r.id) && r.event === "workflow_dispatch" &&
          (toDate(r.created_at) || new Date(0)).getTime() >= at - 5 * 60 * 1000);
        run = fresh.length ? fresh[fresh.length - 1] : null;   // the earliest new one: ours
      } else {
        run = (await client.run(run.id)) || run;
      }
      errors = 0;
      if (run) ctx.round = { ...ctx.round, run };
    } catch (err) {
      errors += 1;
      lastError = err;
      if (errors >= 5) break;   // five failures in a row: something more than a hiccup
    }
    if (run && run.status === "completed") break;
    if (Date.now() - at > ROUND_LIMIT) break;
  }
  if (!stillMine()) { finish(); return; }

  const t = () => ctx.title;
  const link = {
    href: (run && run.html_url) || (typeof client.runsPage === "function" ? client.runsPage() : ""),
    label: "See it on GitHub",
  };
  if (client.demo) link.href = "";

  // Gave up waiting (it carries on without us).
  if (!run || run.status !== "completed") {
    finish();
    if (errors >= 5) {
      const note = explain(lastError, client.repo);
      setRound({ kind, phase: "slow", at, run, note });
      slip(`I lost touch with GitHub while waiting, ${t()}. ${note} The round carries on regardless; pull down on the ledger later to see it.`,
        { tone: "warn", ms: 14000, link });
    } else {
      setRound({ kind, phase: "slow", at, run });
      slip(`He's taking his time, ${t()}. The ${rehearse ? "rehearsal" : "round"} will finish on its own; pull down on the ledger in a few minutes to see it.`,
        { tone: "warn", ms: 14000, link });
    }
    return;
  }

  // 4. It finished: re-read the ledger (after any read already under way).
  if (refreshing) { try { await refreshing; } catch (_) { /* reported already */ } }
  const ok = await refresh({ quiet: true });
  finish();
  if (!stillMine()) return;

  if (run.conclusion !== "success") {
    const cancelled = run.conclusion === "cancelled";
    setRound({ kind, phase: "failed", at, run,
      note: cancelled ? "It was called off before it finished." : `It ended with "${run.conclusion}".` });
    slip(cancelled
      ? `The ${rehearse ? "rehearsal" : "round"} was called off before it finished, ${t()}. Do try Sync again in a minute.`
      : `The ${rehearse ? "rehearsal" : "round"} didn't go to plan, ${t()}.`,
    { tone: "warn", ms: 14000, link });
    return;
  }
  setRound({ kind, phase: "done", at, run });
  if (!ok) return;   // refresh() has already said why the ledger couldn't be read
  if (rehearse) {
    const where = currentRoute() === "rules" ? "below" : "under House Rules";
    slip(`The rehearsal is finished, ${t()}. You'll find it ${where}; nothing in Hevy was changed.`, { ms: 6500 });
    return;
  }
  slip(syncSummary(before, ctx.data), { ms: 7000 });
}

/** What a finished Sync found, in the butler's words. */
function syncSummary(before, after) {
  const t = ctx.title;
  const demo = ctx.demo ? " (This is the sample household, so nothing really ran.)" : "";
  if (!after) return `The round is finished, ${t}.${demo}`;
  const key = (e) => `${e.kind}|${e.when_iso || e.when}|${e.workout || ""}`;
  const known = new Set(((before && before.log) || []).map(key));
  const added = (after.log || []).filter((e) => !known.has(key(e)));
  const reviews = added.filter((e) => e.kind === "review" || e.kind === "fallback");
  const proposed = reviews.some((e) => Array.isArray(e.proposed) && e.proposed.length);
  const awaits = proposed ? " A proposal awaits your word." : "";
  if (reviews.length === 1) {
    const name = reviews[0].workout;
    return `I found a new workout${name ? `, ${name},` : ""} and reviewed it, ${t}.${awaits}`;
  }
  if (reviews.length > 1) return `I found ${reviews.length} new workouts and reviewed them, ${t}.${awaits}`;
  if (added.some((e) => e.kind === "baseline")) return `I have taken stock of your workouts so far, ${t}. The ledger is ready.`;
  const lw = after.last_workout;
  const prev = before && before.last_workout;
  if (lw && prev && lw.id && lw.id !== prev.id) return `I found a new workout${lw.title ? `, ${lw.title},` : ""} and reviewed it, ${t}.`;
  if (after.settings && after.settings.on_holiday) {
    return `I am on holiday, ${t}, so I only saw to your answers. Switch the holiday off under House Rules when you're back.`;
  }
  const when = lw && toDate(lw.start_time);
  if (when) return `Nothing new since your last workout${lw.title ? `, ${lw.title},` : ""} on ${stampET(when)}, ${t}.${demo}`;
  return `Nothing new in Hevy, ${t}. The ledger is up to date.${demo}`;
}

/**
 * Rules saved from the ledger reach app-data.json only after the butler's next
 * round. Until then, show what was saved rather than the older copy. Only the
 * keys and routines actually changed are laid over; everything else is the
 * butler's. The note is dropped once the ledger shows the change (or after a
 * couple of hours, so it can never hide a later edit made elsewhere for long).
 */
function overlaySavedSettings(data) {
  if (ctx.demo || !data) return data;
  const saved = store.savedSettings();
  if (!saved) return data;
  if (!saved.changes || !Array.isArray(saved.on) || !Array.isArray(saved.off)) {
    store.setSavedSettings(null);    // a note in an older shape: not worth guessing
    return data;
  }
  const updated = Date.parse(data.updated || "") || 0;
  if ((updated > saved.at && reflects(data, saved)) || Date.now() - saved.at > 2 * 3600 * 1000) {
    store.setSavedSettings(null);
    return data;
  }
  data.settings = mergeSettings(data.settings || {}, saved.changes, saved);
  for (const r of data.routines || []) {
    if (saved.on.includes(r.id)) r.tunable = true;
    else if (saved.off.includes(r.id)) r.tunable = false;
  }
  return data;
}

function reflects(data, saved) {
  const s = data.settings || {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [k, v] of Object.entries(saved.changes)) if (!same(s[k], v)) return false;
  const routines = data.routines || [];
  const tunable = (id) => {
    const r = routines.find((x) => x.id === id);
    return r && typeof r.tunable === "boolean" ? r.tunable : (s.tunable_routines || []).includes(id);
  };
  return saved.on.every((id) => tunable(id)) && saved.off.every((id) => !tunable(id));
}

async function countProposals() {
  if (!ctx.client) return;
  try {
    const list = await ctx.client.proposals();
    ctx.setProposalsCount(list.length);
  } catch (_) { /* the Awaiting page explains errors itself */ }
}

// ---------------------------------------------------------------- render --

function currentRoute() {
  const r = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return r || "ledger";
}

let lastRoute = null;
function render() {
  const main = $("main");
  const route = currentRoute();
  const moved = route !== lastRoute;
  lastRoute = route;
  if (!ctx.client || route === "welcome") {
    if (ctx.client && route === "welcome") { ctx.navigate("ledger"); return; }
    document.body.dataset.route = "welcome";
    updateChrome();
    mount(main, renderWelcome(ctx, startLive, startDemo));
    return;
  }
  const focusId = document.activeElement && document.activeElement.id;
  const view = ROUTES[route] || renderLedger;
  document.body.dataset.route = ROUTES[route] ? route : "ledger";
  updateChrome();
  mount(main, view(ctx));
  renderFolio();
  if (moved) {
    window.scrollTo(0, 0);
  } else if (focusId && focusId !== "main") {
    const again = document.getElementById(focusId);
    if (again && main.contains(again)) again.focus({ preventScroll: true });
  }
  for (const tab of document.querySelectorAll(".tab")) {
    const on = tab.dataset.route === document.body.dataset.route;
    tab.classList.toggle("is-active", on);
    if (on) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
  }
}

function renderFolio() {
  const n = folioNumber(ctx.data);
  const foot = h("footer", { class: "folio" },
    h("span", { class: "folio-rule", "aria-hidden": "true" }),
    h("span", { class: "folio-num", title: n ? `Day ${n} of the butler's service` : "" }, `folio ${roman(n || 1)}`),
  );
  $("main").append(foot);
}

function updateBusy() {
  const btn = $("sync");
  const busy = isBusy(ctx.round);
  if (busy || refreshing) btn.setAttribute("aria-busy", "true");
  else btn.removeAttribute("aria-busy");
  btn.setAttribute("aria-disabled", busy ? "true" : "false");
  btn.setAttribute("aria-label", busy ? "Syncing: the butler is on his rounds" : "Sync: have the butler check Hevy now");
}

function updateChrome() {
  const welcome = !ctx.client || document.body.dataset.route === "welcome";
  $("tabs").hidden = welcome;
  $("sync").hidden = welcome;
  const marker = $("demo-marker");
  marker.hidden = !ctx.demo;
  updateBadge();
}

function updateBadge() {
  const badge = $("awaiting-count");
  const n = ctx.proposalsCount;
  badge.textContent = n ? `(${n})` : "";
  badge.hidden = !n;
  const tab = document.querySelector('.tab[data-route="awaiting"]');
  if (tab) tab.setAttribute("aria-label", n ? `Awaiting your word, ${n} waiting` : "Awaiting your word");
}

// ----------------------------------------------------------- start modes --

function startDemo() {
  store.mode = "demo";
  ctx.connect(demoClient());
  ctx.navigate("ledger");
  render();
}

function startLive(token, repo, branch) {
  store.connect(token, repo, branch);
  ctx.connect(liveClient(token, repo));
  ctx.navigate("ledger");
  render();
}

// ------------------------------------------------------- the top hat egg --

function setupHat() {
  const hat = $("hat");
  const say = (line, count) => {
    const stiff = count >= 7 ? "stiff" : count >= 4 ? "firm" : "plain";
    slip(line, { tone: stiff, ms: 3200 });
    if (!prefersReducedMotion()) {
      hat.classList.remove("is-rung");
      void hat.offsetWidth;
      hat.classList.add("is-rung");
    }
  };
  const bell = makeBell({
    getTitle: () => ctx.title,
    say,
    resign: () => openLetter(),
  });

  let timer = null;
  let longPressed = false;
  const LONG_MS = 700;

  hat.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    longPressed = false;
    hat.classList.add("is-pressing");
    timer = setTimeout(() => {
      longPressed = true;
      hat.classList.remove("is-pressing");
      buzz([10, 40, 10]);
      if (ctx.client) ctx.navigate("diary");
      else slip("Not before you've been introduced to the household, Sir.");
    }, LONG_MS);
  });
  const cancel = () => { clearTimeout(timer); hat.classList.remove("is-pressing"); };
  hat.addEventListener("pointerup", cancel);
  hat.addEventListener("pointerleave", cancel);
  hat.addEventListener("pointercancel", cancel);
  hat.addEventListener("contextmenu", (e) => e.preventDefault());
  hat.addEventListener("click", (e) => {
    if (longPressed) { longPressed = false; e.preventDefault(); return; }
    bell();
  });
  // Keyboard way into the diary, for completeness: Shift+Enter on the hat.
  hat.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.shiftKey && ctx.client) { e.preventDefault(); ctx.navigate("diary"); }
  });
}

function openLetter() {
  const dlg = $("letter");
  clear(dlg);
  dlg.append(resignationLetter(ctx.title, () => dlg.close()));
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

// ------------------------------------------------------- pull to refresh --

function setupPull() {
  const ind = $("pull");
  let startY = null;
  let pulled = 0;
  window.addEventListener("touchstart", (e) => {
    if (window.scrollY > 0 || !ctx.client || document.body.dataset.route === "welcome") { startY = null; return; }
    startY = e.touches[0].clientY;
    pulled = 0;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    pulled = Math.max(0, e.touches[0].clientY - startY);
    if (pulled > 12) {
      ind.hidden = false;
      ind.textContent = pulled > 80 ? "Let go, and I shall fetch the ledger." : "Pull a little further…";
    }
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (startY !== null && pulled > 80) refresh();
    startY = null;
    ind.hidden = true;
  });
}

// ------------------------------------------------------------------ boot --

function boot() {
  setupHat();
  setupPull();
  $("sync").addEventListener("click", () => startRound("sync"));
  $("leave-demo").addEventListener("click", () => ctx.leave());
  // A tap on the slip puts it away (a tap on its link still opens the link).
  $("slip").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    clearTimeout(slipTimer);
    $("slip").classList.remove("is-in");
    setTimeout(() => { if (!$("slip").classList.contains("is-in")) $("slip").hidden = true; }, 260);
  });
  window.addEventListener("hashchange", render);
  // Back from the background (an app left open for days): freshen up.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !ctx.client) return;
    if (Date.now() - ctx.dataAt > 5 * 60 * 1000) refresh({ quiet: true });
    else if (currentRoute() === "awaiting") render();   // reloads the in-tray if it's over 30 s old
  });

  const mode = store.mode;
  if (mode === "live" && store.token) {
    const cached = store.cachedData();
    ctx.client = liveClient(store.token, store.repo);
    if (cached.data) { ctx.data = cached.data; ctx.dataAt = cached.at; }
    bindAsk(ctx);
    render();
    refresh({ quiet: true });
  } else if (mode === "demo") {
    ctx.client = demoClient();
    bindAsk(ctx);
    render();
    refresh({ quiet: true });
  } else {
    render();
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* offline support is a nicety */ });
  }
}

boot();
