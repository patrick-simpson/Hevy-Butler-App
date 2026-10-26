// THE HOUSEHOLD BOOK: everything the butler has done, newest first, by day.

import { h, arrows } from "../dom.js";
import { toDate, dayKeyET, longDayET, clockET } from "../time.js";
import { compactReport, compactPs } from "./report.js";

const KINDS = {
  review: { label: "Review", note: "after a workout" },
  approval: { label: "Approved", note: "your word, carried out" },
  decline: { label: "Declined", note: "shown out" },
  baseline: { label: "First look", note: "took up his post" },
  note: { label: "A note", note: "where have you been?" },
  fallback: { label: "Plain figures", note: "Claude was unavailable" },
  rehearsal: { label: "Rehearsal", note: "nothing was changed" },
};

export function renderBook(ctx) {
  const data = ctx.data;
  const page = h("div", { class: "page book" },
    h("header", { class: "page-head" },
      h("p", { class: "eyebrow" }, "Section IV"),
      h("h1", { class: "display" }, "The household book"),
      h("p", { class: "lede" }, "Every round the butler has made, newest first. Times are Eastern."),
    ));

  const log = Array.isArray(data && data.log) ? data.log.slice() : [];
  if (!log.length) {
    page.append(h("section", { class: "empty" },
      h("p", { class: "empty-head" }, `The book is blank, ${ctx.title}.`),
      h("p", null, "Entries appear here after the butler's first round.")));
    return page;
  }

  // Oldest first in the data; we show newest first, grouped by Eastern day.
  const entries = log.map((e, i) => ({ e, i, d: toDate(e.when_iso) }));
  entries.sort((a, b) => (b.d && a.d ? b.d - a.d : b.i - a.i));

  let currentKey = null;
  let group = null;
  for (const { e, d } of entries) {
    const key = d ? dayKeyET(d) : (String(e.when || "").split(",")[0] || "Undated");
    if (key !== currentKey) {
      currentKey = key;
      group = h("ol", { class: "book-day-list" });
      page.append(h("section", { class: "book-day" },
        h("h2", { class: "day-head" }, d ? longDayET(d) : key),
        group));
    }
    group.append(bookEntry(e, d));
  }
  return page;
}

function bookEntry(e, d) {
  const kind = KINDS[e.kind] ? e.kind : "other";
  const k = KINDS[kind] || { label: String(e.kind || "Entry"), note: "" };
  const time = d ? clockET(d) : (String(e.when || "").split(",")[1] || "").replace("ET", "").trim();
  const [clock, ampm] = time.split(" ");
  // Approvals and declines carry the proposal's issue title; the kind label already says what it was.
  const workout = String(e.workout || "").replace(/^🎩\s*/u, "").replace(/^A proposal regarding\s+/i, "");

  const li = h("li", { class: ["entry", "log", `log-${kind}`] },
    h("div", { class: "margin" },
      h("span", { class: "time num" }, clock || ""),
      ampm ? h("span", { class: "ampm" }, ampm.toLowerCase()) : null),
    h("div", { class: "body" },
      h("p", { class: "log-kind" },
        h("span", { class: "kind-label" }, k.label),
        workout ? h("span", { class: "kind-note" }, ` · ${workout}`) : k.note ? h("span", { class: "kind-note" }, ` · ${k.note}`) : null),
      e.message ? h("p", { class: "log-message" }, arrows(e.message)) : null,
      // A review's report in brief: the figures, what went well, next time's targets, the P.S.
      e.report && typeof e.report === "object"
        ? compactReport(e.report, { withMessage: !e.message, ps: false })
        : null,
      list("Done", e.applied, "done"),
      list("Proposed", e.proposed, "proposed"),
      list("Advice", e.advice, "advice"),
      list("Set aside by the house rules", e.ignored, "ignored"),
      e.report && typeof e.report === "object" && !saysAlready(e.message, e.report.ps) ? compactPs(e.report) : null,
    ),
  );
  return li;
}

/** The butler's message may already end with the report's P.S.: don't print it twice. */
function saysAlready(message, ps) {
  const squash = (t) => String(t || "").replace(/^\s*P\.?\s?S\.?\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const p = squash(ps);
  return !!p && String(message || "").replace(/\s+/g, " ").includes(p);
}

function list(label, items, cls) {
  if (!Array.isArray(items) || !items.length) return null;
  return h("div", { class: ["log-list", `log-list-${cls}`] },
    h("p", { class: "log-list-label" }, label),
    h("ul", null, items.map((x) => h("li", null, arrows(String(x))))));
}
