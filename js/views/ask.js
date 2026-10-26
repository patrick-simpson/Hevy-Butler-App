// A WORD WITH THE BUTLER: your questions as short notes, his replies as
// letters, oldest first. The present conversation is shown in full; earlier
// ones are folded away by number. The sending and waiting live in ../ask.js.

import { h, prefersReducedMotion } from "../dom.js";
import { askState, loadConversation, sendQuestion, setFresh, MAX_QUESTION } from "../ask.js";
import { waitingLine } from "../eggs.js";
import { store } from "../store.js";
import { toDate, dayKeyET, longDayET, clockET, shortDayET, yearET } from "../time.js";

const SUGGESTIONS = [
  "How is my leg press coming along?",
  "Should I rest tomorrow, or train?",
  "What should I aim for on the chest press next time?",
];

let waitTimer = null;
let lastScrolled = null;   // what the page last scrolled to, so it does so once
const opened = new Set();  // earlier conversations opened out (kept while the app is open)

export function renderAsk(ctx) {
  // Fetch the letters when the page opens (at most every 30 seconds).
  if (!askState.loading && Date.now() - askState.triedAt > 30000) {
    setTimeout(() => loadConversation(ctx), 0);
  }

  const t = ctx.title;
  const page = h("div", { class: "page ask" },
    h("header", { class: "page-head" },
      h("p", { class: "eyebrow" }, "Section III"),
      h("h1", { class: "display" }, "A word with the butler"),
      h("p", { class: "lede" },
        "Ask him anything about your training. He reads every workout you have logged in Hevy and replies in a minute or so. A question never changes a routine."),
    ));

  if (askState.convoError) {
    page.append(h("div", { class: "notice bad ask-error", role: "alert" },
      h("p", null, askState.convoError),
      h("button", { type: "button", class: "btn btn-quiet", onclick: () => loadConversation(ctx) }, "Try again")));
  }

  const msgs = ((askState.convo && askState.convo.messages) || []).filter((m) => m && typeof m === "object");
  const groups = groupByConversation(msgs);
  const latestNo = groups.length ? groups[groups.length - 1].no : 0;
  const p = askState.pending;

  // Which conversation is "the present one": the newest, unless "Start afresh"
  // was pressed (or the question on its way starts a fresh one).
  const freshPage = askState.fresh || !!(p && p.fresh && !msgs.some((m) => m.ask_id === p.ask_id));
  const current = !freshPage && groups.length ? groups[groups.length - 1] : null;
  const earlier = groups.filter((g) => g !== current).reverse();   // newest first

  // ---- the present correspondence
  const section = h("section", { class: "section ask-current", "aria-labelledby": "ask-current-h" },
    h("h2", { id: "ask-current-h", class: "section-label" },
      freshPage ? "A fresh page" : current ? `Conversation No. ${current.no}` : "Your correspondence"));
  const list = h("ol", { class: "ask-list" });
  let lastDay = null;
  const dayHead = (d) => {
    const key = d ? dayKeyET(d) : null;
    if (key && key !== lastDay) {
      lastDay = key;
      list.append(h("li", { class: "ask-day" }, h("h3", { class: "ask-day-head" }, longDayET(d))));
    }
  };
  if (current) {
    for (const m of current.messages) {
      dayHead(toDate(m.asked));
      list.append(exchange(ctx, m));
    }
  }
  if (p && !msgs.some((m) => m.ask_id === p.ask_id)) {
    dayHead(new Date(p.at));
    list.append(pendingExchange(ctx, p));
  }
  if (list.childElementCount) {
    section.append(list);
  } else if (freshPage && groups.length) {
    section.append(h("p", { class: "lede ask-empty" },
      `A clean sheet, ${t}. Your next question starts a new conversation; he won't bring up the earlier letters, though they are kept below.`),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn btn-quiet", id: "ask-unfresh", onclick: () => setFresh(ctx, false) },
        `Carry on with Conversation No. ${latestNo} instead`)));
  } else if (!askState.convo && askState.loading) {
    section.append(h("p", { class: "meta" }, "Fetching the letter book…"));
  } else {
    section.append(h("p", { class: "lede ask-empty" }, `No letters yet, ${t}. Put a question to him below; he answers in a minute or so.`));
  }
  page.append(section);

  // ---- how the last question went, when it didn't simply arrive
  if (askState.note) {
    const n = askState.note;
    page.append(h("div", { class: ["notice", n.tone || "plain", "ask-note"], role: "status" },
      h("p", null, n.text,
        n.link && n.link.href ? [" ", h("a", { href: n.link.href, target: "_blank", rel: "noopener noreferrer" }, n.link.label)] : null)));
  }

  page.append(composer(ctx, { canAfresh: !!current && !p, empty: !msgs.length && !p }));

  // ---- earlier correspondence, folded away
  if (earlier.length) {
    const block = h("section", { class: "section ask-earlier", "aria-labelledby": "ask-earlier-h" },
      h("h2", { id: "ask-earlier-h", class: "section-label" }, "Earlier correspondence"));
    for (const g of earlier) block.append(earlierConversation(ctx, g));
    page.append(block);
  }

  page.append(h("p", { class: "fineprint ask-fine" },
    "Answered by Claude Haiku 5.5, kept quick and thrifty. He reads your Hevy history, the ledger and the last few letters of this conversation. "
    + (ctx.demo ? "In the sample household the answers are invented and nothing is sent." : "Each question runs on GitHub, like his rounds.")));

  keepWaitingLineTurning(ctx);
  scrollWhenFitting(ctx, current, p);
  return page;
}

// ----------------------------------------------------------- the letters --

function groupByConversation(msgs) {
  const byNo = new Map();
  for (const m of msgs) {
    const no = Number.isFinite(Number(m.conversation)) && Number(m.conversation) > 0 ? Number(m.conversation) : 1;
    if (!byNo.has(no)) byNo.set(no, { no, messages: [] });
    byNo.get(no).messages.push(m);
  }
  return [...byNo.values()].sort((a, b) => a.no - b.no);
}

/** A clock in the margin, like the Book: "6:02" over "am". */
function marginClock(d) {
  if (!d) return null;
  const [clock, ampm] = clockET(d).split(" ");
  return [h("span", { class: "time num" }, clock), ampm ? h("span", { class: "ampm" }, ampm.toLowerCase()) : null];
}

/** Paragraphs of a reply, as text. Light Markdown (bold, headings) is dropped. */
function paragraphs(text) {
  const clean = String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
  return clean.split(/\n\s*\n/).map((para) => h("p", null, para.trim())).filter((el) => el.textContent);
}

/** "Oct 25, 6:01 AM": only when he answered on a later day than you asked (the margin has the time). */
function answeredLater(m) {
  const day = (v) => (String(v || "").match(/^[A-Za-z]{3}\s+([A-Za-z]{3}\s+\d{1,2}),/) || [])[1] || "";
  const asked = day(m.asked_et) || (toDate(m.asked) ? shortDayET(toDate(m.asked)) : "");
  const answered = day(m.answered_et);
  if (!answered || answered === asked) return "";
  return String(m.answered_et).replace(/^[A-Za-z]{3}\s+/, "").replace(/\s+ET$/, " ET");
}

function note(question) {
  return h("div", { class: "ask-q" },
    h("p", { class: "ask-q-label" }, "You asked"),
    h("p", { class: "ask-q-text" }, String(question || "")));
}

function exchange(ctx, m, { compact = false } = {}) {
  const d = toDate(m.asked);
  const failed = m.status === "failed";
  const answered = m.status === "answered" || (m.answer && !failed);
  const id = `ask-${String(m.ask_id || "").replace(/[^\w-]/g, "")}`;
  const letter = answered || failed
    ? h("article", { class: ["ask-letter", failed ? "is-failed" : ""], "aria-label": failed ? "The butler could not answer" : "The butler's reply", id: `${id}-letter`, tabindex: "-1" },
      h("p", { class: "ask-letter-head" },
        h("span", null, failed ? "The butler regrets" : "The butler replies"),
        answeredLater(m) ? h("span", { class: "ask-letter-when num" }, answeredLater(m)) : null),
      h("div", { class: "ask-letter-body" }, paragraphs(m.answer)))
    : h("p", { class: "meta ask-noanswer" }, "No answer was recorded for this one.");
  return h("li", { class: ["entry", "ask-exchange", compact ? "is-compact" : ""], id },
    h("div", { class: "margin" }, marginClock(d)),
    h("div", { class: "body" }, note(m.question), letter));
}

function pendingExchange(ctx, p) {
  const sending = p.phase === "sending";
  const line = waitingLine(ctx.title, store.lastWaitLine);
  store.lastWaitLine = line.index;
  return h("li", { class: ["entry", "ask-exchange", "is-pending"], id: "ask-pending" },
    h("div", { class: "margin" }, marginClock(new Date(p.at))),
    h("div", { class: "body" },
      note(p.question),
      h("div", { class: "ask-letter is-pending" },
        h("p", { class: "ask-letter-head" }, h("span", null, sending ? "Ringing for him" : "The butler is writing")),
        h("p", { class: "ask-wait", id: "ask-wait", role: "status", "aria-live": "polite" },
          sending ? `Ringing for him, ${ctx.title}…` : line.text),
        p.phase === "slow"
          ? h("p", { class: "ask-wait-meta ask-slow", role: "status" },
            `Rung at ${clockET(new Date(p.at))} ET. He's taking his time over this one, ${ctx.title}. I shall keep watching.`)
          : h("p", { class: "ask-wait-meta" },
            `Rung at ${clockET(new Date(p.at))} ET · usually a minute or so`))));
}

/** While waiting, a fresh line every few seconds, so the page plainly isn't stuck. */
function keepWaitingLineTurning(ctx) {
  const waiting = askState.pending && askState.pending.phase !== "sending";
  if (!waiting || prefersReducedMotion()) {
    clearInterval(waitTimer);
    waitTimer = null;
    return;
  }
  if (waitTimer) return;
  waitTimer = setInterval(() => {
    const el = document.getElementById("ask-wait");
    if (!askState.pending) { clearInterval(waitTimer); waitTimer = null; return; }
    if (!el) return;
    const line = waitingLine(ctx.title, store.lastWaitLine);
    store.lastWaitLine = line.index;
    el.setAttribute("aria-live", "off");   // screen readers hear the first line only
    el.textContent = line.text;
  }, 4500);
}

/** On opening the page, or when an answer arrives, bring the newest letter into view. */
function scrollWhenFitting(ctx, current, p) {
  let target = null;
  if (askState.justAnswered) target = `ask-${askState.justAnswered.replace(/[^\w-]/g, "")}`;
  else if (p) target = "ask-pending";
  else if (current && current.messages.length > 1) {
    const last = current.messages[current.messages.length - 1];
    target = `ask-${String(last.ask_id || "").replace(/[^\w-]/g, "")}`;
  }
  const key = `${target}|${askState.justAnswered || ""}|${p ? p.ask_id : ""}`;
  if (!target || key === lastScrolled) return;
  lastScrolled = key;
  const smooth = !!askState.justAnswered && !prefersReducedMotion();
  askState.justAnswered = null;
  // After the app has put the page in place (and scrolled it to the top).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById(target);
    if (!el || document.body.dataset.route !== "ask") return;
    const bar = document.querySelector(".top");
    const clear = (bar ? bar.getBoundingClientRect().height : 120) + 12;   // clear of the masthead
    const top = el.getBoundingClientRect().top + window.scrollY - clear;
    if (top > 40) window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }));
}

// ------------------------------------------------------------ the composer --

function composer(ctx, { canAfresh, empty }) {
  const p = askState.pending;
  const area = h("textarea", {
    id: "ask-q", name: "question", class: "field-input ask-input", rows: 4, maxlength: MAX_QUESTION,
    placeholder: "How is my leg press coming along?", "aria-describedby": "ask-count",
    autocapitalize: "sentences",
  });
  area.value = askState.draft || "";
  const count = h("p", { class: "ask-count num", id: "ask-count", "aria-live": "off" });
  const send = h("button", { type: "submit", class: "btn btn-primary", id: "ask-send" },
    p ? "Awaiting his answer…" : "Ring for an answer");

  const update = () => {
    if (area.value.length > MAX_QUESTION) area.value = area.value.slice(0, MAX_QUESTION);
    askState.draft = area.value;
    const n = area.value.length;
    count.textContent = `${n} / ${MAX_QUESTION}`;
    count.classList.toggle("is-near", n >= MAX_QUESTION - 50);
    send.disabled = !!p || !area.value.trim();
  };
  area.addEventListener("input", update);
  update();

  const form = h("form", { class: "ask-form", novalidate: true },
    h("label", { for: "ask-q", class: "field-label" }, "Your question"),
    area,
    count,
    h("div", { class: "actions" },
      send,
      canAfresh && !askState.fresh
        ? h("button", { type: "button", class: "btn btn-quiet", id: "ask-afresh", onclick: () => setFresh(ctx, true) }, "Start afresh")
        : null),
    canAfresh && !askState.fresh
      ? h("p", { class: "field-help" }, "He remembers the last few letters of this conversation. Start afresh to change the subject entirely.")
      : null,
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (send.disabled) return;
    sendQuestion(ctx, area.value);
  });

  const block = h("section", { class: "section ask-compose", "aria-labelledby": "ask-compose-h" },
    h("h2", { id: "ask-compose-h", class: "section-label" }, p ? "One question at a time" : "Put a question to him"),
    form);
  if (p) block.insertBefore(h("p", { class: "field-help ask-busy" }, `He is attending to your last question, ${ctx.title}. You may write the next one meanwhile.`), form);
  if (empty && !area.value) {
    block.append(h("div", { class: "ask-ideas" },
      h("p", { class: "log-list-label" }, "For instance"),
      h("ul", null, SUGGESTIONS.map((s, i) => h("li", null,
        h("button", { type: "button", class: "link-btn", id: `ask-idea-${i}`, onclick: () => { askState.draft = s; ctx.render(); focusBox(); } }, s))))));
  }
  return block;
}

function focusBox() {
  requestAnimationFrame(() => {
    const el = document.getElementById("ask-q");
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
}

// --------------------------------------------- earlier correspondence --

function earlierConversation(ctx, g) {
  const first = toDate(g.messages[0] && g.messages[0].asked);
  const last = toDate(g.messages[g.messages.length - 1] && g.messages[g.messages.length - 1].asked);
  const year = (d) => d && yearET(d) !== yearET(new Date());
  const span = first && last
    ? (dayKeyET(first) === dayKeyET(last) ? shortDayET(first, year(first)) : `${shortDayET(first, year(first))} to ${shortDayET(last, year(last))}`)
    : "";
  const n = g.messages.length;
  const details = h("details", { class: "ask-fold", id: `ask-conv-${g.no}`, open: opened.has(g.no) },
    h("summary", null,
      h("span", { class: "ask-fold-name" }, `Conversation No. ${g.no}`),
      h("span", { class: "ask-fold-meta num" }, [`${n} letter${n === 1 ? "" : "s"}`, span].filter(Boolean).join(" · "))),
    h("p", { class: "ask-fold-first" }, `Began: “${String(g.messages[0].question || "").slice(0, 90)}${String(g.messages[0].question || "").length > 90 ? "…" : ""}”`),
    h("ol", { class: "ask-list" }, g.messages.map((m) => exchange(ctx, m, { compact: true }))));
  details.addEventListener("toggle", () => { if (details.open) opened.add(g.no); else opened.delete(g.no); });
  return details;
}

