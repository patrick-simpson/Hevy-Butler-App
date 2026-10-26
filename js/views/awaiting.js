// AWAITING YOUR WORD: the butler's proposals (GitHub issues), approve or decline.

import { h, buzz, prefersReducedMotion, arrows } from "../dom.js";
import { store } from "../store.js";
import { explain } from "../github.js";
import { parsePlan, firstParagraph, cleanText, HANDLED } from "../plan.js";
import { waxSeal } from "../eggs.js";
import { toDate, stampET } from "../time.js";

// Survives re-renders while the app is open.
const state = {
  list: null,        // last fetched proposals
  error: null,
  loading: false,
  attending: {},     // number -> {action, phase: "checking"|"sending"|"waiting"|"done"|"moot"|"timeout", reply, since}
  freshSeal: null,   // number whose seal should animate in
  loadedAt: 0,
  client: null,      // which client the above belongs to (demo vs live)
};
const polls = new Map();

export function renderAwaiting(ctx) {
  if (state.client !== ctx.client) {
    for (const t of polls.values()) clearTimeout(t);
    polls.clear();
    Object.assign(state, { list: null, error: null, loading: false, attending: {}, freshSeal: null, loadedAt: 0, client: ctx.client });
  }
  const page = h("div", { class: "page awaiting" },
    h("header", { class: "page-head" },
      h("p", { class: "eyebrow" }, "Section II"),
      h("h1", { class: "display" }, "Awaiting your word"),
      h("p", { class: "lede" }, "Bigger changes to the routines you let me tune. Nothing here happens until you say so."),
    ));
  const body = h("div", { class: "memos" });
  page.append(body);

  fill(ctx, body);
  if (!state.loading && Date.now() - state.loadedAt > 30000) load(ctx);
  resumePending(ctx);
  return page;
}

async function load(ctx) {
  state.loading = true;
  try {
    const list = await ctx.withLoading(ctx.client.proposals());
    state.list = list;
    state.error = null;
    state.loadedAt = Date.now();
    ctx.setProposalsCount(list.filter((i) => !state.attending[i.number]).length);
  } catch (err) {
    state.error = explain(err, ctx.client.repo);
    state.loadedAt = Date.now();
  } finally {
    state.loading = false;
  }
  if (document.body.dataset.route === "awaiting") ctx.render();
}

function fill(ctx, body) {
  if (state.error) {
    body.append(h("div", { class: "notice bad", role: "alert" },
      h("p", null, state.error),
      h("button", { type: "button", class: "btn btn-quiet", onclick: () => { state.error = null; state.loadedAt = 0; ctx.render(); } }, "Try again")));
  }
  if (!state.list) {
    if (!state.error) body.append(h("p", { class: "meta" }, "Fetching the in-tray…"));
    return;
  }
  // Keep proposals we've just answered on screen until the butler closes them.
  const shown = state.list.slice();
  for (const [num, a] of Object.entries(state.attending)) {
    if (!shown.find((i) => String(i.number) === num) && a.issue) shown.push(a.issue);
  }
  if (!shown.length) {
    body.append(h("section", { class: "empty" },
      h("p", { class: "empty-head" }, `Nothing awaits your word, ${ctx.title}.`),
      h("p", null, "The in-tray is empty and the silver is polished. When I'd like to make a bigger change to a routine you've let me tune, I'll write it up here for your approval."),
      h("p", { class: "marginal" }, "Hevy Trainer workouts never come here: I only advise on those."),
    ));
    return;
  }
  shown.sort((a, b) => (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0));
  for (const issue of shown) body.append(memo(ctx, issue));
}

function memo(ctx, issue) {
  const { plan, prose } = parsePlan(issue.body);
  const att = state.attending[issue.number];
  const created = toDate(issue.created_at);
  const title = String(issue.title || "A proposal").replace(/^🎩\s*/, "");

  const article = h("article", { class: ["memo", att ? (att.phase === "moot" ? "is-moot" : `is-${att.action}`) : ""], "aria-labelledby": `memo-${issue.number}` },
    h("p", { class: "memo-no" }, h("span", null, "Memorandum"), h("span", { class: "num" }, ` No. ${issue.number}`)),
    h("h2", { id: `memo-${issue.number}`, class: "memo-title" }, title),
    h("p", { class: "meta" },
      created ? stampET(created) : "",
      plan && plan.workout && !title.includes(plan.workout) ? ` · after ${plan.workout}` : ""),
  );

  const intro = (plan && plan.message) || firstParagraph(prose);
  if (intro) article.append(h("p", { class: "memo-intro" }, arrows(intro)));

  if (plan && plan.items.length) {
    article.append(h("ol", { class: "memo-items" }, plan.items.map((it) => h("li", null,
      h("p", { class: "item-desc" }, arrows(it.desc)),
      it.reason ? h("p", { class: "item-reason" }, arrows(it.reason)) : null))));
  } else if (!intro) {
    article.append(h("p", { class: "memo-raw" }, arrows(cleanText(prose).slice(0, 1200)) || "(The butler left no particulars.)"));
  }

  if (!ctx.demo && issue.html_url) {
    article.append(h("p", { class: "memo-link" },
      h("a", { href: issue.html_url, target: "_blank", rel: "noopener noreferrer" }, "Read it in full on GitHub")));
  }

  if (att) {
    // The seal goes on once your word has reached GitHub; it comes off again
    // if the butler says the proposal had already been dealt with.
    const marked = att.phase === "waiting" || att.phase === "done" || att.phase === "timeout";
    if (marked && att.action === "approve") {
      const seal = waxSeal("Approved");
      if (state.freshSeal === issue.number && !prefersReducedMotion()) seal.classList.add("is-stamping");
      article.append(seal);
      state.freshSeal = null;
    } else if (marked) {
      article.append(h("p", { class: "declined-mark", "aria-hidden": "true" }, "Shown out"));
    }
    article.append(statusLine(ctx, att, issue.number));
  } else {
    article.append(answerButtons(ctx, issue));
  }
  return article;
}

function statusLine(ctx, att, number) {
  const t = ctx.title;
  let text;
  if (att.phase === "checking" || att.phase === "sending") text = `Sending your word, ${t}…`;
  else if (att.phase === "waiting") text = att.action === "approve"
    ? `Very good, ${t}. I am attending to it; this is usually done within a minute or two.`
    : `As you wish, ${t}. I am showing it out; this is usually done within a minute or two.`;
  else if (att.phase === "done") text = att.reply || "Done.";
  else if (att.phase === "moot") text = `This one had already been dealt with, ${t}, or replaced by a fresher proposal, so your word changed nothing.`;
  else if (att.phase === "timeout") text = `This is taking longer than the usual minute or two, ${t}. Your word won't be lost: if GitHub has dropped it, I shall see to it at my next check (about 10 in the morning or 10 at night, Eastern), or sooner if you tap Sync.`;
  else text = att.note || "Something went wrong.";
  return h("div", { class: ["memo-status", `phase-${att.phase}`], role: "status", id: `memo-${number}-status`, tabindex: "-1" },
    h("p", null, att.phase === "done" ? h("span", { class: "reply-label" }, "The butler replies: ") : null, text),
    att.phase === "moot" && att.reply
      ? h("p", { class: "memo-moot-reply" }, h("span", { class: "reply-label" }, "His last word on it: "), att.reply)
      : null);
}

function focusStatus(number) {
  const el = document.getElementById(`memo-${number}-status`);
  if (el) el.focus({ preventScroll: true });
}

/** A comment's text, fit to show: no hidden markers, no Markdown, proper arrows. */
function replyText(body) {
  return arrows(cleanText(body));
}

const isCommand = (body) => /^\s*\/(approve|decline)\s*$/i.test(body || "");

function answerButtons(ctx, issue) {
  const approve = h("button", { type: "button", class: "btn btn-primary btn-seal", id: `memo-${issue.number}-approve` }, "Approve");
  const decline = h("button", { type: "button", class: "btn", id: `memo-${issue.number}-decline` }, "Decline");
  const row = h("div", { class: "actions memo-actions" }, approve, decline);
  approve.addEventListener("click", () => answer(ctx, issue, "approve"));
  decline.addEventListener("click", () => answer(ctx, issue, "decline"));
  return row;
}

/** Drop a proposal that's no longer open from the in-tray. */
function dropFromList(ctx, number) {
  if (state.list) state.list = state.list.filter((i) => i.number !== number);
  ctx.setProposalsCount(state.list ? state.list.filter((i) => !state.attending[i.number]).length : 0);
}

async function answer(ctx, issue, action) {
  const n = issue.number;
  if (state.attending[n]) return;
  state.attending[n] = { action, phase: "checking", issue };
  buzz(action === "approve" ? [18, 60, 120] : 20);
  ctx.render();
  focusStatus(n);

  // The list may be minutes (or days) old: make sure it's still open first.
  let current;
  try {
    current = await ctx.client.issue(n);
  } catch (err) {
    delete state.attending[n];
    state.error = `Your word didn't reach GitHub, so nothing has changed. ${explain(err, ctx.client.repo)}`;
    ctx.render();
    return;
  }
  if (!current || current.state !== "open") {
    state.attending[n].phase = "moot";
    dropFromList(ctx, n);
    ctx.render();
    focusStatus(n);
    return;
  }

  state.attending[n].phase = "sending";
  ctx.render();
  let posted;
  try {
    posted = await ctx.client.answer(n, action === "approve" ? "/approve" : "/decline");
  } catch (err) {
    delete state.attending[n];
    state.error = `Your word didn't reach GitHub, so nothing has changed. ${explain(err, ctx.client.repo)}`;
    ctx.render();
    return;
  }
  state.error = null;
  const since = (posted && posted.created_at) || new Date(Date.now() - 60000).toISOString();
  store.setPending(n, action, since);
  Object.assign(state.attending[n], { phase: "waiting", since, sinceId: posted && posted.id });
  if (action === "approve") state.freshSeal = n;
  ctx.setProposalsCount(state.list ? state.list.filter((i) => !state.attending[i.number]).length : 0);
  ctx.render();
  focusStatus(n);
  poll(ctx, n);
}

/** If the app was closed while the butler was attending, pick up where we left off. */
function resumePending(ctx) {
  const pending = store.pending();
  for (const [num, p] of Object.entries(pending)) {
    if (Date.now() - p.at > 60 * 60 * 1000) { store.setPending(num, null); continue; }
    if (!state.attending[num]) {
      const issue = state.list && state.list.find((i) => String(i.number) === num);
      const since = p.since || new Date(p.at - 5 * 60000).toISOString();
      state.attending[num] = { action: p.action, phase: "waiting", issue, since };
    }
    poll(ctx, Number(num));
  }
}

function poll(ctx, number) {
  if (polls.has(number)) return;
  const every = ctx.demo ? 1500 : 8000;
  const started = Date.now();
  const limit = 6 * 60 * 1000;
  const tick = async () => {
    const att = state.attending[number];
    if (!att) { polls.delete(number); return; }
    try {
      const issue = await ctx.client.issue(number);
      if (issue && issue.state === "closed") {
        let comments = null;
        try { comments = await ctx.client.comments(number); } catch (_) { comments = null; }
        const verdict = judge(att, comments);
        // GitHub can list the reply a moment after the close: look once more.
        if (!verdict.fresh && comments !== null && !att.lookedAgain) {
          att.lookedAgain = true;
          polls.set(number, setTimeout(tick, every));
          return;
        }
        if (verdict.genuine) {
          att.phase = "done";
          att.reply = verdict.reply || (att.action === "approve" ? "It is done." : "The proposal has been shown out.");
        } else if (comments === null) {
          att.phase = "done";      // couldn't read the reply; the issue is closed all the same
          att.reply = att.action === "approve" ? "It is done." : "The proposal has been shown out.";
        } else {
          att.phase = "moot";
          att.reply = verdict.reply;
        }
        store.setPending(number, null);
        polls.delete(number);
        dropFromList(ctx, number);
        if (document.body.dataset.route === "awaiting") ctx.render();
        ctx.refresh({ quiet: true });
        return;
      }
    } catch (_) { /* keep trying quietly */ }
    if (Date.now() - started > limit) {
      att.phase = "timeout";
      polls.delete(number);
      if (document.body.dataset.route === "awaiting") ctx.render();
      return;
    }
    polls.set(number, setTimeout(tick, every));
  };
  polls.set(number, setTimeout(tick, every));
}

/**
 * Was the issue closed in answer to *our* word? Only a reply the butler wrote
 * after our comment, marked as handled, and not a "superseded" notice counts.
 * Returns {genuine, fresh, reply}.
 */
function judge(att, comments) {
  const list = (comments || []).filter((c) => c && !isCommand(c.body));
  const sinceMs = Date.parse(att.since || "") || 0;
  const after = (c) => {
    if (att.sinceId && typeof c.id === "number" && typeof att.sinceId === "number") return c.id > att.sinceId;
    const at = Date.parse(c.created_at || "");
    return Number.isFinite(at) ? at >= sinceMs - 1000 : true;
  };
  const fresh = list.filter(after);
  const genuine = fresh.filter((c) => String(c.body || "").includes(HANDLED) && !/^\s*Superseded/i.test(c.body || ""));
  if (genuine.length) return { genuine: true, fresh: true, reply: replyText(genuine[genuine.length - 1].body) };
  const last = fresh.length ? fresh[fresh.length - 1] : list[list.length - 1];
  return { genuine: false, fresh: fresh.length > 0, reply: last ? replyText(last.body) : "" };
}
