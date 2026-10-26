// THE AFTER-WORKOUT REPORT: what the butler wrote after your latest workout.
// The full report sits at the top of the Ledger; a compact one goes into the
// Book's review entries (and the last rehearsal under House Rules).
// The figures are the butler's own sums from Hevy; everything is shown as text.

import { h, arrows } from "../dom.js";
import { toDate, stampET } from "../time.js";

const ADVICE_FIRST = 2;     // advice shown before "more"

// Remembered while the app is open: which report's advice is opened out.
const view = { adviceOpen: new Set() };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (v === null || v === undefined ? "" : String(v));

/** 11250 -> "11,250" */
function thousands(n) {
  return Math.round(n).toLocaleString("en-US");
}

/** "Tue Oct 13, 7:29 PM ET" -> "Oct 13" (the day is enough for a comparison). */
function shortDay(whenEt) {
  const m = text(whenEt).match(/^[A-Za-z]{3}\s+([A-Za-z]{3}\s+\d{1,2})\b/);
  return m ? m[1] : text(whenEt).split(",")[0];
}

/** "+8% vs Oct 13" / "−5% vs Oct 13" / "the same as Oct 13", or "" */
export function volumeChange(numbers) {
  if (!numbers || !isNum(numbers.volume_change_pct) || !numbers.compared_to) return "";
  const pct = Math.round(numbers.volume_change_pct);
  const day = shortDay(numbers.compared_to.when_et);
  const vs = day ? ` vs ${day}` : " vs last time";
  if (pct === 0) return day ? `the same as ${day}` : "the same as last time";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%${vs}`;
}

function whenOf(report) {
  if (report.when_et) return report.when_et;
  const d = toDate(report.start_time);
  return d ? stampET(d) : "";
}

/**
 * The butler's opening note, tidied for the page: the bell emoji he rings for
 * a record are left out (the ledger uses no emoji), and "130 lb x 8" reads
 * "130 lb × 8", as the targets do. His words are otherwise untouched.
 */
function messageText(report) {
  return arrows(text(report.message).replace(/\u{1F514}\u{FE0F}?\s*/gu, "").replace(/\s+x\s+(?=\d)/g, " × ")).trim();
}

/** A target as the owner reads it at the rack: "300 lb × 8". */
export function targetText(t) {
  return arrows(text(t.target)).replace(/\s+x\s+/g, " × ");
}

// ------------------------------------------------------------ the figures --

/** The figures as ruled ledger lines: label on the left, figure on the right. */
function figuresTable(n) {
  const rows = [];
  if (isNum(n.duration_min)) {
    rows.push(["Time taken", `${Math.round(n.duration_min)} min`, ""]);
  }
  if (isNum(n.exercises)) rows.push(["Exercises", String(n.exercises), ""]);
  if (isNum(n.working_sets)) rows.push(["Working sets", String(n.working_sets), ""]);
  if (isNum(n.volume_lb) && n.volume_lb > 0) {
    const change = volumeChange(n);
    const tone = isNum(n.volume_change_pct) && Math.round(n.volume_change_pct) > 0 ? "up" : "level";
    rows.push(["Weight moved", `${thousands(n.volume_lb)} lb`, change, tone]);
  }
  if (isNum(n.records)) {
    rows.push(["New records", n.records > 0 ? String(n.records) : "none this time", "", n.records > 0 ? "record" : "none"]);
  }
  if (!rows.length) return null;
  return h("dl", { class: "report-figures" }, rows.map(([label, value, note, tone]) =>
    h("div", { class: ["report-figure", tone ? `is-${tone}` : ""] },
      h("dt", null, label),
      h("dd", { class: "num" },
        h("span", { class: "report-value" }, value),
        note ? h("span", { class: "report-change" }, note) : null))));
}

// ------------------------------------------------------------ the parts --

function wellDone(items, compact) {
  const xs = list(items).map(text).filter(Boolean);
  if (!xs.length) return null;
  return h("div", { class: ["report-part", "report-well", compact ? "log-list log-list-done" : ""] },
    h("p", { class: compact ? "log-list-label" : "report-label" }, "Well done"),
    h("ul", { class: compact ? "" : "report-well-list" }, xs.map((x) => h("li", null, arrows(x)))));
}

function targets(items, compact) {
  const xs = list(items).filter((t) => t && (t.lift || t.target));
  if (!xs.length) return null;
  if (compact) {
    return h("div", { class: "log-list log-list-next" },
      h("p", { class: "log-list-label" }, "Next time"),
      h("ul", null, xs.map((t) => h("li", null,
        h("span", { class: "next-lift" }, text(t.lift)), t.lift && t.target ? ": " : "",
        h("b", { class: "num" }, targetText(t))))));
  }
  return h("div", { class: "report-part report-next" },
    h("p", { class: "report-label" }, "Next time"),
    h("ol", { class: "next-list" }, xs.map((t) => h("li", { class: "next" },
      h("span", { class: "next-lift" }, text(t.lift)),
      h("span", { class: "next-target num" }, targetText(t)),
      t.why ? h("span", { class: "next-why" }, arrows(text(t.why))) : null))));
}

function adviceList(ctx, report, key) {
  const xs = list(report.advice).filter((a) => a && (a.text || a.lift));
  if (!xs.length) return null;
  const open = view.adviceOpen.has(key);
  const shown = open ? xs : xs.slice(0, ADVICE_FIRST);
  const more = xs.length - shown.length;
  const id = `report-advice-${key.replace(/[^\w-]/g, "")}`;
  return h("div", { class: "report-part report-advice" },
    h("p", { class: "report-label" }, "The butler advises"),
    h("ul", { class: "advice-list", id }, shown.map((a) => h("li", null,
      a.lift ? h("span", { class: "advice-lift" }, text(a.lift)) : null,
      h("span", { class: "advice-text" }, arrows(text(a.text))),
    ))),
    xs.length > ADVICE_FIRST ? h("button", {
      type: "button", class: "link-btn report-more", id: `${id}-more`,
      "aria-expanded": open ? "true" : "false", "aria-controls": id,
      onclick: () => { if (open) view.adviceOpen.delete(key); else view.adviceOpen.add(key); ctx.render(); },
    }, open ? "Show less" : `${more} more piece${more === 1 ? "" : "s"} of advice`) : null,
    report.trainer
      ? h("p", { class: "marginal" }, `For Hevy Trainer workouts these are suggestions only, ${ctx.title}; I never alter Trainer myself.`)
      : null,
  );
}

// --------------------------------------------------------- full report --

/**
 * The full report for the top of the Ledger. margin: an element for the
 * margin column (days since), or null.
 */
export function fullReport(ctx, report, margin) {
  const key = text(report.workout_id || report.start_time || report.workout || "latest");
  const kind = report.trainer ? "A Hevy Trainer workout" : "";
  const when = whenOf(report);
  const block = h("section", { class: ["section", "report", report.fallback ? "is-fallback" : ""], "aria-labelledby": "report-h" },
    h("h2", { id: "report-h", class: "section-label" }, "After your workout"),
    h("div", { class: "entry report-head" },
      h("div", { class: "margin", "aria-hidden": "true" }, margin),
      h("div", { class: "body" },
        h("p", { class: "workout-title" }, text(report.workout) || "Your workout"),
        h("p", { class: "meta" }, when),
        kind ? h("p", { class: "meta report-kind" }, kind) : null)));

  if (report.fallback) {
    block.append(h("p", { class: "report-fallback" },
      h("span", { class: "report-fallback-word" }, "Plain figures"),
      " Claude couldn't be reached, so this report is the numbers alone."));
  }
  if (report.message) block.append(h("p", { class: "report-message" }, messageText(report)));
  // (Each part is null when it has nothing to show. The browser's own append()
  // would print a null as the word "null", so the empty parts are left out.)
  const fig = report.numbers ? figuresTable(report.numbers) : null;
  if (fig) block.append(fig);
  block.append(...[
    wellDone(report.went_well, false),
    targets(report.targets, false),
    adviceList(ctx, report, key),
  ].filter(Boolean));
  if (report.ps) block.append(h("p", { class: "report-ps" }, h("span", { class: "report-ps-mark" }, "P.S. "), arrows(text(report.ps).replace(/^\s*P\.?\s?S\.?\s*/i, ""))));
  return block;
}

/** When there's no review yet. */
export function reportNullState(ctx) {
  return h("section", { class: "section report is-empty", "aria-labelledby": "report-h" },
    h("h2", { id: "report-h", class: "section-label" }, "After your workout"),
    h("p", { class: "lede" }, "Your next workout will be reviewed here."),
    h("p", { class: "marginal" }, `The figures, what went well, and what to aim for next time, ${ctx.title}.`));
}

// ------------------------------------------------------ compact report --

/** One line of figures for the Book: "52 min · 5 exercises · 15 sets · 11,250 lb (+8% vs Oct 13)". */
function figuresLine(n) {
  if (!n) return null;
  const bits = [];
  if (isNum(n.duration_min)) bits.push(`${Math.round(n.duration_min)} min`);
  if (isNum(n.exercises)) bits.push(`${n.exercises} exercise${n.exercises === 1 ? "" : "s"}`);
  if (isNum(n.working_sets)) bits.push(`${n.working_sets} set${n.working_sets === 1 ? "" : "s"}`);
  if (isNum(n.volume_lb) && n.volume_lb > 0) {
    const change = volumeChange(n);
    bits.push(`${thousands(n.volume_lb)} lb${change ? ` (${change})` : ""}`);
  }
  if (isNum(n.records) && n.records > 0) bits.push(`${n.records} record${n.records === 1 ? "" : "s"}`);
  if (!bits.length) return null;
  return h("p", { class: "report-line num" }, bits.join(" · "));
}

/**
 * The report in brief, for the Book. The log entry already carries the
 * message and the advice, so this adds the figures, what went well, the
 * targets and the P.S.
 */
export function compactReport(report, { withMessage = false, ps = true } = {}) {
  if (!report || typeof report !== "object") return null;
  return h("div", { class: ["report-compact", report.fallback ? "is-fallback" : ""] },
    withMessage && report.message ? h("p", { class: "log-message" }, messageText(report)) : null,
    figuresLine(report.numbers),
    wellDone(report.went_well, true),
    targets(report.targets, true),
    withMessage && list(report.advice).length
      ? h("div", { class: "log-list log-list-advice" },
        h("p", { class: "log-list-label" }, "Advice"),
        h("ul", null, list(report.advice).map((a) => h("li", null, arrows([a.lift, a.text].filter(Boolean).join(": "))))))
      : null,
    ps ? compactPs(report) : null,
  );
}

/** The report's P.S., in brief (the Book puts it last, after the lists). */
export function compactPs(report) {
  if (!report || !report.ps) return null;
  return h("p", { class: "report-ps is-compact" }, `P.S. ${arrows(text(report.ps).replace(/^\s*P\.?\s?S\.?\s*/i, ""))}`);
}
