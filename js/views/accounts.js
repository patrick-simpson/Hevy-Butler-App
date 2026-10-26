// THE MONTHLY ACCOUNTS: the butler's statement of your training, drawn up like
// a quarterly statement in a household ledger. The latest statement in full,
// "Request the big picture now", and earlier statements folded away below.
// The figures are the butler's own sums from Hevy; the words are Claude
// Opus's. Everything is shown as text. The requesting and waiting live in
// ../accounts.js.

import { h, s, arrows, prefersReducedMotion } from "../dom.js";
import {
  accState, freshenAccounts, loadAccounts, askToConfirm, requestAccounts, accountsWaitLine, writtenAt, hasFigures, COST,
} from "../accounts.js";
import { statusMark } from "../charts.js";
import { toDate, stampET, clockET, yearET } from "../time.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const VERDICTS = { "well fed": "well-fed", "about right": "about-right", neglected: "neglected" };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (v === null || v === undefined ? "" : String(v));
const thousands = (n) => Math.round(n).toLocaleString("en-US");
/**
 * His words, as text: "160 lb -> 165 lb" reads "160 lb → 165 lb", and "80 lb x 6"
 * reads "80 lb × 6". A figure keeps its unit, and a month its day, on the same
 * line ("140 lb", "Oct 5"), joined by a non-breaking space.
 */
const prose = (v) => arrows(text(v)).replace(/\s+x\s+(?=\d)/g, " × ")
  .replace(/(\d)\s+(lb|reps?|sets?)\b/g, "$1\u00a0$2")
  .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d)/g, "$1\u00a0$2");

/** The scheduled statement on the 1st reviews a calendar month; anything else was asked for. */
function isMonthly(acc) {
  return acc.period_kind ? acc.period_kind === "month" : !(acc.request_id && acc.request_id !== "monthly");
}

// Remembered while the app is open.
const view = { opened: new Set(), lifts: new Set() };
let waitTimer = null;
let lastWaitLine = -1;
let scrolledFor = null;

// ------------------------------------------------------------ the names --

/** "2026-10-01" -> {y, m, d}, read as a calendar date (no time zone). */
function ymd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v));
  if (!m) return null;
  const x = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return x.m >= 1 && x.m <= 12 && x.d >= 1 && x.d <= 31 ? x : null;
}

function dayText(x, withYear = false) {
  return `${MONTHS[x.m - 1].slice(0, 3)}\u00a0${x.d}${withYear ? `, ${x.y}` : ""}`;
}

/** "October 2026" -> {month: "October", year: 2026}, or null for any other period. */
function monthPeriod(acc) {
  const m = /^([A-Z][a-z]+)\s+(\d{4})$/.exec(text(acc.period).trim());
  return m && MONTHS.includes(m[1]) ? { month: m[1], year: Number(m[2]) } : null;
}

function rangeText(acc, withYear = true) {
  const a = ymd(acc.period_start);
  const b = ymd(acc.period_end);
  if (!a || !b) return "";
  return `${dayText(a, withYear && a.y !== b.y)} to ${dayText(b, withYear)}`;
}

/** What the statement covers, in full: "October 2026", or "Sep 27 to Oct 26, 2026". */
export function periodFull(acc) {
  if (monthPeriod(acc)) return text(acc.period).trim();
  return rangeText(acc) || text(acc.period).trim() || "The period";
}

/** The Ledger's way of naming it: "The accounts for October", "The accounts for Sep 27 to Oct 26". */
export function accountsTitle(acc) {
  const mp = monthPeriod(acc);
  if (mp) return `The accounts for ${mp.year === yearET(new Date()) ? mp.month : `${mp.month} ${mp.year}`}`;
  const end = ymd(acc.period_end);
  if (end) return `The accounts to ${dayText(end, end.y !== yearET(new Date()))}`;
  return acc.period ? `The accounts for ${text(acc.period)}` : "The latest accounts";
}

function writtenText(acc) {
  if (acc.written_et) return text(acc.written_et);
  const d = toDate(acc.written);
  return d ? stampET(d) : "";
}

/** "quadriceps" / "upper_back" -> "Quadriceps" / "Upper back" */
function groupName(g) {
  const t = text(g).replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Other";
}

function paragraphs(v, cls) {
  return text(v).replace(/\*\*(.+?)\*\*/g, "$1").trim().split(/\n\s*\n/)
    .map((para) => para.trim()).filter(Boolean)
    .map((para) => h("p", { class: cls }, prose(para)));
}

// ------------------------------------------------------------- the page --

export function renderAccounts(ctx) {
  freshenAccounts(ctx, { every: 60 * 1000 });
  const t = ctx.title;
  const page = h("div", { class: "page accounts" },
    h("header", { class: "page-head" },
      h("p", { class: "eyebrow" }, h("a", { href: "#/ledger", class: "acc-back" }, "The Ledger"), " · statement of accounts"),
      h("h1", { class: "display" }, "The monthly accounts"),
      h("p", { class: "lede" },
        "Once a month the butler steps back from the day-to-day and draws up the whole picture: what grew, what stalled, what was left wanting, and what to change.")));

  if (accState.error) {
    page.append(h("div", { class: "notice bad acc-notice", role: "alert" },
      h("p", null, accState.error),
      h("button", { type: "button", class: "btn btn-quiet", onclick: () => loadAccounts(ctx) }, "Try again")));
  }

  const all = (accState.accounts || []).slice();
  const numbered = all.map((acc, i) => ({ acc, no: i + 1 }))
    .sort((x, y) => writtenAt(x.acc) - writtenAt(y.acc) || x.no - y.no);
  const written = numbered.filter((x) => x.acc.status !== "failed");
  const primary = written.length ? written[written.length - 1] : numbered[numbered.length - 1] || null;
  const failedNewer = primary && primary.acc.status !== "failed"
    ? numbered.filter((x) => x.acc.status === "failed" && writtenAt(x.acc) > writtenAt(primary.acc)).pop() : null;
  const earlier = numbered.filter((x) => x !== primary).reverse();

  // A request under way (or a note on how one went) goes at the top; the
  // question about the cost stays where the button was pressed.
  const busy = !!(accState.pending || accState.note);
  if (busy) page.append(requestBlock(ctx, { top: true, any: !!primary }));

  if (primary) {
    if (failedNewer) {
      page.append(h("div", { class: "notice warn acc-notice" },
        h("p", { class: "notice-head" }, `The accounts you asked for ${writtenText(failedNewer.acc) ? `on ${writtenText(failedNewer.acc)}` : "last"} couldn't be written.`),
        h("p", null, prose(text(failedNewer.acc.summary) || "Claude couldn't be reached."),
          hasFigures(failedNewer.acc) ? " Their figures are kept under earlier accounts." : null)));
    }
    page.append(statement(ctx, primary.acc, primary.no, { main: true }));
  } else if (!accState.accounts && (accState.loading || !accState.triedAt)) {
    page.append(h("section", { class: "section" }, h("p", { class: "meta" }, "Fetching the accounts…")));
  } else if (!accState.error) {
    page.append(h("section", { class: "section acc-empty", "aria-labelledby": "acc-empty-h" },
      h("h2", { id: "acc-empty-h", class: "section-label" }, "No accounts yet"),
      h("p", { class: "empty-head" }, `The books are not yet open, ${t}.`),
      h("p", { class: "lede" },
        "The first statement arrives on the 1st of the month, in the morning, Eastern (about 9:30 in winter, 10:30 in summer). Or ask for one now, below, and he'll draw up the last 30 days.")));
  }

  if (!busy) page.append(requestBlock(ctx, { top: false, any: !!primary }));

  if (earlier.length) {
    const block = h("section", { class: "section acc-earlier", "aria-labelledby": "acc-earlier-h" },
      h("h2", { id: "acc-earlier-h", class: "section-label" }, "Earlier accounts"));
    for (const x of earlier) block.append(earlierFold(ctx, x.acc, x.no));
    page.append(block);
  }

  page.append(h("p", { class: "fineprint acc-fine" },
    "The figures are the butler's own sums from Hevy. The review is written by Claude Opus 5.5, thinking hard, "
    + `${COST} a statement. Nothing here changes a routine; the Hevy Trainer settings are for you to change, should you agree. `
    + (ctx.demo ? "In the sample household the accounts are invented and nothing is sent." : "Each statement runs on GitHub, like his rounds.")));

  keepWaitLineTurning(ctx);
  scrollToNew();
  return page;
}

// ------------------------------------------------------- the statement --

function statement(ctx, acc, no, { main = false } = {}) {
  const failed = acc.status === "failed";
  const figured = hasFigures(acc);
  const id = main ? "acc-latest" : `acc-${no}`;
  const range = monthPeriod(acc) ? rangeText(acc) : "";
  const kind = isMonthly(acc) ? "The monthly statement" : "Drawn up on request";

  const block = h("article", {
    class: ["acc-statement", failed ? "is-failed" : "", main ? "is-main" : ""],
    id, "aria-labelledby": `${id}-h`, tabindex: "-1",
  },
  h("header", { class: "acc-head" },
    h("p", { class: "acc-head-top" },
      h("span", { class: "acc-head-word" }, "Statement of accounts"),
      h("span", { class: "acc-no num" }, `No. ${no}`)),
    h(main ? "h2" : "h3", { class: "acc-period", id: `${id}-h` }, periodFull(acc)),
    h("p", { class: "acc-head-meta" },
      [range, kind].filter(Boolean).join(" · ")),
    writtenText(acc) ? h("p", { class: "acc-head-meta" }, `Rendered ${writtenText(acc)}`) : null));

  if (failed) {
    block.append(h("p", { class: "acc-stamp-line" },
      h("span", { class: "acc-stamp" }, "Not written"),
      h("span", { class: "acc-stamp-note" }, figured
        ? "The butler kept the figures, but the review itself couldn't be written."
        : "The accounts couldn't be drawn up this time.")));
    block.append(...paragraphs(acc.summary, "acc-summary-p"));
  } else {
    if (acc.headline) block.append(h("p", { class: "acc-headline" }, prose(text(acc.headline))));
    const summary = paragraphs(acc.summary, "acc-summary-p");
    if (summary.length) block.append(h("div", { class: "acc-summary" }, summary));
  }

  // The schedules, numbered like a formal statement. Each is left out when it has nothing in it.
  const parts = [
    ["Highlights", highlights(acc)],
    ["The figures", figures(acc.numbers, beforeText(acc))],
    ["Sets by muscle group", groups(acc.numbers)],
    ["The balance", balance(acc)],
    ["Stalls: cause and remedy", stalls(acc)],
    ["Hevy Trainer: settings to change", trainer(ctx, acc)],
    ["For the month ahead", focus(acc)],
  ].filter(([, body]) => body);
  parts.forEach(([label, body], i) => block.append(schedule(`${id}-s${i + 1}`, ROMAN[i] || String(i + 1), label, body)));

  const ps = text(acc.ps).replace(/^\s*P\.?\s?S\.?\s*/i, "");
  if (ps && !failed) block.append(h("p", { class: "report-ps acc-ps" }, h("span", { class: "report-ps-mark" }, "P.S. "), prose(ps)));

  const lifts = liftsFold(ctx, acc, id);
  if (lifts) block.append(lifts);

  block.append(h("p", { class: "acc-foot" },
    acc.model && /opus/i.test(acc.model) ? h("span", null, "Reviewed by Claude Opus 5.5")
      : acc.model ? h("span", null, `Reviewed by ${text(acc.model)}`)
        : figured ? h("span", null, "Figures from Hevy") : null,
    h("span", { class: "acc-foot-sign" }, "Your obedient servant, the Butler")));

  return main
    ? h("section", { class: "section acc-latest-wrap", "aria-label": "The latest accounts" }, block)
    : block;
}

function schedule(id, numeral, label, body) {
  return h("section", { class: "acc-part", "aria-labelledby": id },
    h("h3", { class: "acc-label", id },
      h("span", { class: "acc-roman", "aria-hidden": "true" }, numeral),
      h("span", { class: "acc-label-text" }, label)),
    body);
}

function highlights(acc) {
  const xs = list(acc.highlights).map(text).filter(Boolean);
  if (!xs.length) return null;
  return h("ul", { class: "report-well-list acc-highlights" }, xs.map((x) => h("li", null, prose(x))));
}

/** What "before" means: "Aug 28 to Sep 26, 2026", or the month before. */
function beforeText(acc) {
  if (acc.compared_with) return text(acc.compared_with);
  const a = ymd(acc.compared_start);
  const b = ymd(acc.compared_end);
  return a && b ? `${dayText(a, a.y !== b.y)} to ${dayText(b, true)}` : "";
}

/** The figures: a ruled table, this period against the one before. */
function figures(n, before = "") {
  if (!n || typeof n !== "object") return null;
  const rows = [];
  // A figure that fell is in ochre, as in the muscle groups below.
  const row = (label, now, before, fmt = String, cls = "") => {
    if (!isNum(now)) return;
    const down = isNum(before) && now < before;
    rows.push(h("tr", { class: [cls, down ? "is-down" : ""] },
      h("th", { scope: "row" }, label),
      h("td", { class: "num acc-now" }, fmt(now)),
      h("td", { class: ["num", "acc-before", isNum(before) ? "" : "is-none"] }, isNum(before) ? fmt(before) : "—")));
  };
  row("Workouts", n.workouts, n.workouts_before);
  row("Working sets", n.working_sets, n.working_sets_before);
  row("Weight moved", n.volume_lb, n.volume_lb_before, (v) => `${thousands(v)} lb`);
  const recordsFell = isNum(n.records) && isNum(n.records_before) && n.records < n.records_before;
  row("New records", n.records, n.records_before, String, isNum(n.records) && n.records > 0 && !recordsFell ? "is-record" : "");
  const anyDown = rows.some((r) => r.classList.contains("is-down"));
  const tally = ["climbing", "stalled", "slipping"].filter((k) => isNum(n[k]));
  if (!rows.length && !tally.length) return null;
  const wrap = h("div", { class: "acc-figures-wrap" });
  if (rows.length) {
    wrap.append(h("table", { class: "acc-table acc-figures" },
      h("caption", { class: "visually-hidden" }, "The figures for this period, with the period before"),
      h("thead", null, h("tr", null,
        h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Item")),
        h("th", { scope: "col", class: "num" }, "This period"),
        h("th", { scope: "col", class: "num" }, "Before"))),
      h("tbody", null, rows)));
  }
  if (rows.length && (before || anyDown)) {
    wrap.append(h("p", { class: "acc-legend" },
      [before ? `Before: ${before}.` : "", anyDown ? "Figures in ochre fell." : ""].filter(Boolean).join(" ")));
  }
  if (tally.length) {
    const fresh = isNum(n.new) && n.new > 0 ? ` · and ${n.new} new` : "";
    wrap.append(h("p", { class: "acc-sub" }, `How the lifts stand${fresh}`),
      h("dl", { class: "tally acc-tally" }, tally.map((k) => h("div", { class: ["tally-item", `is-${k}`] },
        h("dt", { class: "tally-label" }, statusMark(k), k),
        h("dd", { class: "tally-n num" }, String(n[k]))))));
  }
  return wrap;
}

/** Sets by muscle group: a ruled table, with a hairline for each period. */
function groups(n) {
  const xs = list(n && n.sets_by_group).filter((g) => g && (isNum(g.sets) || isNum(g.sets_before)));
  if (!xs.length) return null;
  xs.sort((a, b) => ((b.sets || 0) - (a.sets || 0)) || ((b.sets_before || 0) - (a.sets_before || 0)));
  const max = Math.max(1, ...xs.map((g) => Math.max(g.sets || 0, g.sets_before || 0)));
  const bar = (g) => {
    const w = (v) => (isNum(v) ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);
    const svg = s("svg", { class: "acc-bar", viewBox: "0 0 100 10", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
    if (w(g.sets) > 0) svg.append(s("line", { class: "acc-bar-now", x1: 0, y1: 3, x2: w(g.sets), y2: 3 }));
    if (w(g.sets_before) > 0) svg.append(s("line", { class: "acc-bar-before", x1: 0, y1: 8, x2: w(g.sets_before), y2: 8 }));
    return svg;
  };
  const anyDown = xs.some((g) => isNum(g.sets) && isNum(g.sets_before) && g.sets < g.sets_before);
  return h("div", null,
    h("table", { class: "acc-table acc-groups" },
      h("caption", { class: "visually-hidden" }, "Working sets by muscle group, this period and the one before"),
      h("thead", null, h("tr", null,
        h("th", { scope: "col" }, "Group"),
        h("th", { scope: "col", class: "num" }, "Now"),
        h("th", { scope: "col", class: "num" }, "Before"))),
      h("tbody", null, xs.map((g) => {
        const down = isNum(g.sets) && isNum(g.sets_before) && g.sets < g.sets_before;
        return h("tr", { class: down ? "is-down" : "" },
          h("th", { scope: "row" }, h("span", { class: "acc-group" }, groupName(g.group)), bar(g)),
          h("td", { class: "num acc-now" }, isNum(g.sets) ? String(g.sets) : "0"),
          h("td", { class: "num acc-before" }, isNum(g.sets_before) ? String(g.sets_before) : "—"));
      }))),
    h("p", { class: "acc-legend" },
      h("span", { class: "acc-key acc-key-now", "aria-hidden": "true" }), " this period ",
      h("span", { class: "acc-key acc-key-before", "aria-hidden": "true" }), " the period before",
      anyDown ? " · figures in ochre fell" : null));
}

function balance(acc) {
  const xs = list(acc.balance).filter((b) => b && (b.area || b.verdict));
  if (!xs.length) return null;
  return h("ul", { class: "acc-balance" }, xs.map((b) => {
    const v = text(b.verdict).toLowerCase();
    return h("li", { class: ["acc-balance-row", `is-${VERDICTS[v] || "other"}`] },
      h("span", { class: "acc-area" }, text(b.area)),
      v ? h("span", { class: "acc-verdict" }, v) : null,
      b.note ? h("span", { class: "acc-note" }, prose(text(b.note))) : null);
  }));
}

function stalls(acc) {
  const xs = list(acc.stalls).filter((x) => x && (x.lift || x.cause || x.remedy));
  if (!xs.length) return null;
  return h("ol", { class: "acc-stalls" }, xs.map((x) => h("li", { class: "acc-stall" },
    h("p", { class: "acc-stall-lift" }, text(x.lift)),
    h("dl", { class: "acc-cr" },
      x.cause ? h("div", { class: "acc-cause" }, h("dt", null, "Cause"), h("dd", null, prose(text(x.cause)))) : null,
      x.remedy ? h("div", { class: "acc-remedy" }, h("dt", null, "Remedy"), h("dd", null, prose(text(x.remedy)))) : null))));
}

function trainer(ctx, acc) {
  const xs = list(acc.trainer_settings).filter((x) => x && (x.setting || x.suggestion));
  if (!xs.length) return null;
  return h("div", null,
    h("ol", { class: "acc-settings" }, xs.map((x) => h("li", { class: "acc-setting" },
      h("span", { class: "acc-setting-name" }, text(x.setting)),
      h("span", { class: "acc-setting-to" }, h("span", { class: "acc-arrow", "aria-hidden": "true" }, "→ "), prose(text(x.suggestion))),
      x.why ? h("span", { class: "acc-setting-why" }, prose(text(x.why))) : null))),
    h("p", { class: "marginal" }, `Change these in Hevy Trainer yourself, ${ctx.title}, should you agree. The butler never alters Trainer.`));
}

function focus(acc) {
  const xs = list(acc.focus).map(text).filter(Boolean);
  if (!xs.length) return null;
  return h("ol", { class: "acc-focus" }, xs.map((x, i) => h("li", null,
    h("span", { class: "acc-focus-n", "aria-hidden": "true" }, `${i + 1}.`),
    h("span", { class: "acc-focus-text" }, prose(x)))));
}

/** Every lift, first to last in the period, folded away (it can be a long list). */
function liftsFold(ctx, acc, id) {
  const xs = list(acc.numbers && acc.numbers.lifts).filter((l) => l && l.lift);
  if (!xs.length) return null;
  const key = `${id}|${acc.id || acc.request_id || ""}`;
  const details = h("details", { class: "acc-lifts", id: `${id}-lifts`, open: view.lifts.has(key) },
    h("summary", null, h("span", { class: "acc-fold-name" }, `Every lift, first to last (${xs.length})`)),
    h("ol", { class: "acc-lift-list" }, xs.map((l) => {
      const st = text(l.status).toLowerCase();
      const known = ["climbing", "stalled", "slipping"].includes(st) ? st : "new";
      const from = setParts(l.start);
      const to = setParts(l.end);
      return h("li", { class: "acc-lift" },
        h("p", { class: "acc-lift-head" },
          h("span", { class: "acc-lift-name" }, text(l.lift)),
          st ? h("span", { class: `status status-${known}` }, st === "new" ? "new" : st) : null),
        h("p", { class: "acc-lift-sets num" },
          h("span", { class: "acc-from" }, from.set || "—", from.rpe ? h("span", { class: "acc-rpe" }, ` RPE ${from.rpe}`) : null),
          h("span", { class: "acc-arrow-to" }, h("span", { "aria-hidden": "true" }, " → "), h("span", { class: "visually-hidden" }, " to ")),
          h("span", { class: "acc-to" }, to.set || "—", to.rpe ? h("span", { class: "acc-rpe" }, ` RPE ${to.rpe}`) : null),
          isNum(l.sessions) ? h("span", { class: "acc-lift-n" }, ` · ${l.sessions} session${l.sessions === 1 ? "" : "s"}`) : null));
    })));
  details.addEventListener("toggle", () => { if (details.open) view.lifts.add(key); else view.lifts.delete(key); });
  return details;
}

/** "55 lb x 6 @RPE 8" -> {set: "55 lb × 6", rpe: "8"}; "90 lb assist x 8" -> "90 lb help × 8". */
function setParts(v) {
  const raw = text(v).trim();
  const m = raw.match(/^(.*?)\s*@\s*RPE\s*([\d.]+)\s*$/i);
  return { set: (m ? m[1] : raw).replace(/\s+x\s+/g, " × ").replace(/\blb assist\b/, "lb help"), rpe: m ? m[2] : "" };
}

function earlierFold(ctx, acc, no) {
  const key = String(acc.id || acc.request_id || no);
  const failed = acc.status === "failed";
  const details = h("details", { class: "acc-fold", id: `acc-fold-${no}`, open: view.opened.has(key) },
    h("summary", null,
      h("span", { class: "acc-fold-name" }, periodFull(acc)),
      h("span", { class: "acc-fold-meta num" },
        [failed ? "not written" : (isMonthly(acc) ? "" : "on request"), writtenText(acc).replace(/,\s*\d{1,2}:\d{2}\s*[AP]M\s*ET$/, "")].filter(Boolean).join(" · ")),
      !failed && acc.headline ? h("span", { class: "acc-fold-headline" }, prose(text(acc.headline))) : null));
  if (details.open) details.append(statement(ctx, acc, no));
  details.addEventListener("toggle", () => {
    if (details.open) {
      view.opened.add(key);
      if (!details.querySelector(".acc-statement")) details.append(statement(ctx, acc, no));
    } else {
      view.opened.delete(key);
    }
  });
  return details;
}

// ---------------------------------------------------------- the request --

function requestBlock(ctx, { top, any }) {
  const t = ctx.title;
  const p = accState.pending;
  const block = h("section", { class: ["section", "acc-request", top ? "is-top" : ""], "aria-labelledby": "acc-req-h", id: "acc-request" },
    h("h2", { id: "acc-req-h", class: "section-label" }, p ? "The butler is at his accounts" : "The big picture, now"));

  if (p) {
    const sending = p.phase === "sending";
    const line = accountsWaitLine(t, lastWaitLine);
    lastWaitLine = line.index;
    block.append(h("div", { class: "acc-pending", id: "acc-pending" },
      h("p", { class: "acc-wait", id: "acc-wait", role: "status", "aria-live": "polite" },
        sending ? `Ringing for him, ${t}…` : p.phase === "fetching" ? `Blotting the ink, ${t}…` : line.text),
      h("p", { class: "acc-wait-meta num" },
        `Requested at ${clockET(new Date(p.at))} ET · `,
        p.phase === "slow"
          ? `He's taking his time over these, ${t}. I shall keep watching for a few minutes more.`
          : "Claude Opus thinks hard over these: usually a minute or two. You may look at other pages meanwhile.")));
  } else if (accState.confirming) {
    block.append(h("div", { class: "acc-confirm", id: "acc-confirm", role: "group", "aria-labelledby": "acc-confirm-q" },
      h("p", { class: "acc-confirm-q", id: "acc-confirm-q" },
        `It costs ${COST} of Claude, ${t}, and takes a minute or two. Shall he draw up the last 30 days now?`),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn btn-primary", id: "acc-confirm-yes", onclick: () => requestAccounts(ctx) },
          "Yes, draw them up"),
        h("button", { type: "button", class: "btn btn-quiet", id: "acc-confirm-no", onclick: () => askToConfirm(ctx, false) }, "Not now"))));
  } else {
    block.append(
      h("p", { class: "field-help" },
        any
          ? "No need to wait for the 1st: he will draw up the last 30 days whenever you like. Claude Opus thinks hard over it, which takes a minute or two and costs "
          : "He will draw up the last 30 days whenever you like. Claude Opus thinks hard over it, which takes a minute or two and costs ",
        h("b", null, COST), "."),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn", id: "acc-request-btn", onclick: () => askToConfirm(ctx, true) },
          "Request the big picture now")));
  }

  if (accState.note) {
    const n = accState.note;
    block.append(h("div", { class: ["notice", n.tone || "plain", "acc-req-note"], role: "status" },
      h("p", null, n.text,
        n.link && n.link.href ? [" ", h("a", { href: n.link.href, target: "_blank", rel: "noopener noreferrer" }, n.link.label)] : null)));
  }
  return block;
}

/** While waiting, a fresh line every few seconds, so the page plainly isn't stuck. */
function keepWaitLineTurning(ctx) {
  const waiting = accState.pending && accState.pending.phase !== "sending";
  if (!waiting || prefersReducedMotion()) {
    clearInterval(waitTimer);
    waitTimer = null;
    return;
  }
  if (waitTimer) return;
  waitTimer = setInterval(() => {
    const el = document.getElementById("acc-wait");
    if (!accState.pending) { clearInterval(waitTimer); waitTimer = null; return; }
    if (!el || accState.pending.phase === "fetching") return;
    const line = accountsWaitLine(ctx.title, lastWaitLine);
    lastWaitLine = line.index;
    el.setAttribute("aria-live", "off");   // screen readers hear the first line only
    el.textContent = line.text;
  }, 6000);
}

/** When a statement has just arrived, bring it into view (once). */
function scrollToNew() {
  const id = accState.justWritten;
  if (!id || id === scrolledFor) return;
  scrolledFor = id;
  accState.justWritten = null;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById("acc-latest");
    if (!el || document.body.dataset.route !== "accounts") return;
    const bar = document.querySelector(".top");
    const clear = (bar ? bar.getBoundingClientRect().height : 120) + 12;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - clear), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }));
}

// ------------------------------------------------- the Ledger's one line --

/**
 * Under the after-workout report: "The accounts for October: <headline> →".
 * Nothing at all until the app knows whether there are any.
 */
export function accountsLine(ctx, latest) {
  const p = accState.pending;
  if (p) {
    return h("a", { class: "acc-line is-pending", href: "#/accounts", id: "acc-line" },
      h("span", { class: "acc-line-text" },
        h("span", { class: "acc-line-label" }, "The monthly accounts"),
        h("span", { class: "acc-line-headline" }, `The butler is at his accounts, ${ctx.title}.`)),
      h("span", { class: "acc-line-arrow", "aria-hidden": "true" }, "→"));
  }
  if (latest) {
    return h("a", { class: "acc-line", href: "#/accounts", id: "acc-line" },
      h("span", { class: "acc-line-text" },
        h("span", { class: "acc-line-label" }, accountsTitle(latest)),
        latest.headline ? h("span", { class: "acc-line-headline" }, prose(text(latest.headline))) : null),
      h("span", { class: "acc-line-arrow", "aria-hidden": "true" }, "→"));
  }
  // None written yet, or every one tried so far couldn't be: still a way in.
  const tried = (accState.accounts || []).filter((a) => a.status === "failed");
  if (accState.missing || tried.length) {
    const newest = tried.length ? tried.reduce((x, y) => (writtenAt(y) >= writtenAt(x) ? y : x)) : null;
    return h("a", { class: "acc-line is-none", href: "#/accounts", id: "acc-line" },
      h("span", { class: "acc-line-text" },
        h("span", { class: "acc-line-label" }, newest ? accountsTitle(newest) : "The monthly accounts"),
        h("span", { class: "acc-line-headline" }, newest
          ? "The last statement couldn't be written; ask again, or wait for the 1st."
          : "The first arrives on the 1st, or on request.")),
      h("span", { class: "acc-line-arrow", "aria-hidden": "true" }, "→"));
  }
  return null;
}
