// THE LEDGER: greeting, what awaits your word, last workout, how the lifts are
// going, the butler's advice, and every lift as a ruled line you can open.

import { h, arrows } from "../dom.js";
import { greeting, daysSinceLastWorkout } from "../eggs.js";
import { liftChart, chartPoints, statusMark, STATUS_WORDS, fmtNum, figure } from "../charts.js";
import { toDate, stampET, ago, dayKeyET, shortDayET, yearET, calendarDaysET } from "../time.js";
import { fullReport, reportNullState, targetText } from "./report.js";
import { accountsLine } from "./accounts.js";
import { latestWritten, freshenAccounts } from "../accounts.js";

const STATUSES = ["climbing", "stalled", "slipping"];
const SHOW_FIRST = 8;          // of the "Earlier" group
const RESTING_DAYS = 60;       // not trained for longer than this: "not lately"

// Remembered while the app is open.
const view = { filter: "all", showAll: false, resting: false, open: new Set(), sessions: new Set() };

export function renderLedger(ctx) {
  const data = ctx.data;
  const title = ctx.title;
  const g = greeting(title, data);

  const page = h("div", { class: "page ledger" });

  const updated = toDate(data && data.updated);
  page.append(h("header", { class: "greeting" },
    h("p", { class: "eyebrow" },
      updated ? `Ledger written ${data.updated_et || stampET(updated)}` : "The ledger"),
    h("h1", { class: ["display", title === "Patrick" ? "weary" : ""] }, g.headline),
    h("p", { class: "lede" }, g.aside),
    ctx.stale && ctx.dataAt
      ? h("p", { class: "marginal warn" }, `This is the copy I kept from ${ago(new Date(ctx.dataAt))}. Pull down or press Refresh to try again.`)
      : null,
  ));

  const due = ctx.proposalsCount;
  if (due > 0) {
    page.append(h("a", { class: "due", href: "#/awaiting", id: "due-notice" },
      h("span", { class: "due-text" },
        h("span", { class: "due-n num" }, String(due)),
        ` proposal${due === 1 ? "" : "s"} ${due === 1 ? "awaits" : "await"} your word`),
      h("span", { class: "due-arrow", "aria-hidden": "true" }, "→")));
  }

  if (!data) {
    page.append(h("section", { class: "empty" },
      h("p", null, `The ledger is still on its way, ${title}. If this lasts, press Refresh above.`)));
    return page;
  }

  const model = liftModel(data);

  // The butler's report on the latest workout comes first: it is what you
  // look at between sets. When it covers the last workout, "Last attended"
  // keeps only the tally (the report already names the workout).
  const report = data.latest_report && typeof data.latest_report === "object" ? data.latest_report : null;
  const covers = !!(report && data.last_workout && report.workout_id && report.workout_id === data.last_workout.id);
  if (report) page.append(fullReport(ctx, report, covers ? marginDays(daysSinceLastWorkout(data)) : reportMargin(report)));
  else page.append(reportNullState(ctx));

  // The latest monthly accounts, in one line under the report.
  freshenAccounts(ctx);
  const accLine = accountsLine(ctx, latestWritten(ctx));
  if (accLine) page.append(accLine);

  page.append(lastWorkout(ctx, data, title, model, covers));

  // The report carries its own advice; the older advice list shows only without one.
  const latestAdvice = report ? [] : adviceToShow(data.advice);
  if (latestAdvice.length) page.append(adviceBlock(latestAdvice, title));

  page.append(liftsBlock(ctx, data, model));
  return page;
}

// ------------------------------------------------------------ the model --

function latestSession(lift) {
  const s = (lift.sessions || []).slice().sort((a, b) => (toDate(a.iso) || 0) - (toDate(b.iso) || 0));
  return s[s.length - 1] || null;
}

/**
 * The butler's newest "Next time" target for each lift, by the lift's name.
 * Each report only names targets for the lifts in its own workout, and the
 * workouts rotate (Full Body 1, 2, 3), so today's lifts usually have their
 * targets in an older report: this gathers them from the latest report and
 * the Book's reviews, newest first. Each value also says which workout it
 * came from.
 */
function targetsByLift(data) {
  const log = Array.isArray(data.log) ? data.log : [];
  const reports = [data.latest_report, ...log.slice().reverse().map((e) => e && e.report)];
  const found = new Map();
  for (const r of reports) {
    if (!r || typeof r !== "object" || !Array.isArray(r.targets)) continue;
    for (const t of r.targets) {
      if (!t || !t.lift || !t.target) continue;
      const list = found.get(t.lift) || [];
      list.push({ target: t, workout: r.workout || "", when_et: r.when_et || "", at: toDate(r.start_time) });
      found.set(t.lift, list);
    }
  }
  return found;
}

/**
 * A lift's target, if it still stands: only the newest one counts, and only
 * when the lift hasn't been done again since (a later workout without a new
 * target for it means the old one has had its turn).
 */
function nextFor(nextTimes, lift, lastDone) {
  const list = nextTimes.get(lift.title);
  if (!list || !list.length) return null;
  const newest = list[0];
  if (lastDone && newest.at && lastDone.getTime() > newest.at.getTime() + 60 * 1000) return null;
  return newest;
}

/**
 * Every lift, newest first, with the group it belongs in:
 * "now" (trained in the last workout), "earlier", or "resting" (not lately).
 * A resting lift's status is shown as "resting", so last winter's lifts don't
 * shout "slipping" about today.
 */
function liftModel(data, now = new Date()) {
  const lastStart = toDate(data.last_workout && data.last_workout.start_time);
  const lastKey = lastStart ? dayKeyET(lastStart) : null;
  const nextTimes = targetsByLift(data);
  const lifts = (data.lifts || []).map((lift) => {
    const latest = latestSession(lift);
    const at = toDate(latest && latest.iso);
    const next = nextFor(nextTimes, lift, at);
    const status = STATUS_WORDS[lift.status] && lift.status !== "resting" ? lift.status : "new";
    let group = "earlier";
    if (at && lastKey && dayKeyET(at) === lastKey) group = "now";
    else if (!at || (now - at) / 86400000 > RESTING_DAYS) group = "resting";
    return { lift, latest, at, status, group, shown: group === "resting" ? "resting" : status, next };
  });
  lifts.sort((a, b) => (b.at || 0) - (a.at || 0));
  const counts = { all: lifts.length, climbing: 0, stalled: 0, slipping: 0, new: 0, resting: 0 };
  for (const m of lifts) counts[m.shown] += 1;
  return { lifts, counts };
}

// ---------------------------------------------------------- last attended --

function marginDays(n) {
  if (n === null || n === undefined) return null;
  if (n <= 0) return h("span", { class: "margin-note" }, "today");
  if (n === 1) return h("span", { class: "margin-note" }, "yest.");
  return h("span", { class: "margin-days" },
    h("span", { class: "numeral num" }, String(n)),
    h("span", { class: "margin-note" }, "days"));
}

/** The margin beside a report that isn't about the very last workout: its days since. */
function reportMargin(report) {
  const d = toDate(report.start_time);
  if (!d) return null;
  return marginDays(calendarDaysET(d, new Date()));
}

function lastWorkout(ctx, data, title, model, covered = false) {
  const lw = data.last_workout;
  const st = data.stats || {};
  const block = h("section", { class: "section", "aria-labelledby": "last-h" },
    h("h2", { id: "last-h", class: "section-label" }, covered ? "How the lifts stand" : "Last attended"));
  if (covered) {
    if (model.lifts.length) block.append(tally(ctx, model));
    const extras = [];
    if (Number.isFinite(Number(st.workout_count)) && st.workout_count) extras.push(`Workout No. ${st.workout_count}`);
    if (st.reviews) extras.push(`${st.reviews} review${st.reviews === 1 ? "" : "s"} written`);
    if (st.records) extras.push(`${st.records} record${st.records === 1 ? "" : "s"} rung in`);
    if (extras.length) block.append(h("p", { class: "marginal tally-extra" }, extras.join(" · ")));
    return block;
  }
  if (!lw) {
    block.append(h("p", { class: "lede" }, `No workouts on record yet, ${title}. The ledger awaits its first entry.`));
    return block;
  }
  const routine = (data.routines || []).find((r) => r.id === lw.routine_id);
  const kind = !lw.routine_id ? "A Hevy Trainer workout"
    : routine && routine.title !== lw.title ? `From your routine ${routine.title}` : "From one of your own routines";
  const away = daysSinceLastWorkout(data);
  const awayWords = away === null ? "" : away <= 0 ? "today" : away === 1 ? "yesterday" : `${away} days ago`;
  block.append(
    h("div", { class: "entry" },
      h("div", { class: "margin", "aria-hidden": "true" }, marginDays(away)),
      h("div", { class: "body" },
        h("p", { class: "workout-title" }, lw.title || "Untitled workout",
          awayWords ? h("span", { class: "visually-hidden" }, `, ${awayWords}`) : null),
        h("p", { class: "meta" },
          lw.when_et || stampET(toDate(lw.start_time) || new Date()), " · ", kind,
          Number.isFinite(Number(st.workout_count)) && st.workout_count
            ? h("span", { class: "num" }, ` · No. ${st.workout_count}`) : null),
      ),
    ),
  );
  if (model.lifts.length) block.append(tally(ctx, model));
  const extras = [];
  if (st.reviews) extras.push(`${st.reviews} review${st.reviews === 1 ? "" : "s"} written`);
  if (st.records) extras.push(`${st.records} record${st.records === 1 ? "" : "s"} rung in`);
  if (extras.length) block.append(h("p", { class: "marginal tally-extra" }, extras.join(" · ")));
  return block;
}

function setFilter(ctx, key) {
  const next = view.filter === key ? "all" : key;
  view.filter = next;
  view.showAll = false;
  ctx.render();
  if (next !== "all") {
    const head = document.getElementById("lifts-h");
    if (head) head.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

/** Climbing / Stalled / Slipping: the answer to "how am I doing", and the filter. */
function tally(ctx, model) {
  const row = h("div", { class: "tally", role: "group", "aria-label": "How the lifts are going. Tap one to show only those." });
  for (const key of STATUSES) {
    const n = model.counts[key] || 0;
    const on = view.filter === key;
    row.append(h("button", {
      type: "button", id: `tally-${key}`, class: ["tally-item", `is-${key}`, on ? "is-on" : ""],
      "aria-pressed": on ? "true" : "false",
      onclick: () => setFilter(ctx, key),
    },
    h("span", { class: "tally-label" }, statusMark(key), STATUS_WORDS[key]),
    h("span", { class: "tally-n num" }, String(n))));
  }
  return row;
}

// ----------------------------------------------------------------- advice --

/** The advice from the most recent review (oldest-first list in the data). */
function adviceToShow(advice) {
  if (!Array.isArray(advice) || !advice.length) return [];
  const latest = advice[advice.length - 1];
  const sameRound = advice.filter((a) => a.when_et === latest.when_et && a.workout === latest.workout);
  return sameRound.reverse().slice(0, 4);
}

function adviceBlock(items, title) {
  const first = items[0];
  return h("section", { class: "section advice", "aria-labelledby": "advice-h" },
    h("h2", { id: "advice-h", class: "section-label" }, "The butler advises"),
    h("p", { class: "meta" }, `After ${first.workout || "your last workout"}, ${first.when_et || ""}`),
    h("ul", { class: "advice-list" },
      items.map((a) => h("li", null,
        a.lift ? h("span", { class: "advice-lift" }, a.lift) : null,
        h("span", { class: "advice-text" }, arrows(a.text || "")),
      ))),
    h("p", { class: "marginal" }, `For your Hevy Trainer workouts these are suggestions only, ${title}; I never alter Trainer myself.`),
  );
}

// ------------------------------------------------------------------ lifts --

/** "55 lb x 6 @RPE 8" -> {set: "55 lb × 6", rpe: "8"} */
function setParts(text) {
  const raw = String(text || "");
  const m = raw.match(/^(.*?)\s*@\s*RPE\s*([\d.]+)\s*$/i);
  const set = (m ? m[1] : raw).replace(/\s+x\s+/g, " × ").replace(/\blb assist\b/, "lb help");
  return { set, rpe: m ? m[2] : "" };
}

function bestText(lift) {
  if (lift.best === null || lift.best === undefined) return "—";
  if (lift.unit === "lb assistance") return `${fmtNum(lift.best)} lb of help`;
  if (lift.unit === "reps") return `${fmtNum(lift.best)} reps`;
  return `${figure(lift, lift.best)} lb`;
}

function bestShort(lift) {
  if (lift.best === null || lift.best === undefined) return "—";
  if (lift.unit === "reps") return fmtNum(lift.best);
  return `${figure(lift, lift.best)} lb`;
}

function bestCaption(lift) {
  if (lift.unit === "lb assistance") return "least help";
  if (lift.unit === "reps") return "most reps";
  return "est. max";
}

function liftsBlock(ctx, data, model) {
  const section = h("section", { class: "section lifts", "aria-labelledby": "lifts-h" },
    h("h2", { id: "lifts-h", class: "section-label" }, "The lifts"));

  if (!model.lifts.length) {
    section.append(h("p", { class: "lede" }, "No lifts on record yet. They'll appear after the butler's first round."));
    return section;
  }
  const { counts } = model;

  const filterRow = h("div", { class: "filters", role: "group", "aria-label": "Show lifts" });
  const filterBtn = (key, label) => h("button", {
    type: "button", id: `filter-${key}`,
    class: ["filter", view.filter === key ? "is-on" : ""],
    "aria-pressed": view.filter === key ? "true" : "false",
    onclick: () => { view.filter = key; view.showAll = false; ctx.render(); },
  }, `${label} `, h("span", { class: "num" }, String(counts[key] || 0)));
  filterRow.append(filterBtn("all", "All"));
  if (counts.new) filterRow.append(filterBtn("new", "New"));
  if (STATUSES.includes(view.filter)) {
    filterRow.append(h("span", { class: "filter-now" },
      `Only the ${STATUS_WORDS[view.filter]} (${counts[view.filter] || 0})`));
  }
  section.append(filterRow);

  const shown = model.lifts.filter((m) => view.filter === "all" || m.shown === view.filter);
  if (!shown.length) {
    section.append(h("p", { class: "meta" }, "None of those at present."));
    return section;
  }

  const groups = [
    ["now", data.last_workout
      ? `In ${data.last_workout.title || "your last workout"} · ${shortDayET(toDate(data.last_workout.start_time) || new Date())}`
      : "Lately"],
    ["earlier", "Earlier"],
    ["resting", "Not lately"],
  ];
  for (const [key, label] of groups) {
    const members = shown.filter((m) => m.group === key);
    if (!members.length) continue;
    if (key === "resting") {
      const open = view.resting || view.filter === "resting";
      section.append(h("h3", { class: "group-head" },
        h("button", {
          type: "button", id: "lifts-resting", class: "group-toggle",
          "aria-expanded": open ? "true" : "false", "aria-controls": "lifts-resting-list",
          onclick: () => { view.resting = !view.resting; ctx.render(); },
        }, `${label} (${members.length})`, h("span", { class: "group-hint" }, open ? " hide" : " show"))));
      if (open) section.append(liftList(ctx, members, "lifts-resting-list"));
      continue;
    }
    section.append(h("h3", { class: "group-head" }, label));
    const visible = key === "earlier" && !view.showAll ? members.slice(0, SHOW_FIRST) : members;
    section.append(liftList(ctx, visible));
    if (visible.length < members.length) {
      section.append(h("div", { class: "actions" },
        h("button", { type: "button", id: "show-all-lifts", class: "btn btn-quiet", onclick: () => { view.showAll = true; ctx.render(); } },
          `Show all ${members.length} earlier lifts`)));
    }
  }
  return section;
}

function liftList(ctx, members, id) {
  const list = h("ol", { class: "lift-list", id });
  for (const m of members) list.append(liftEntry(ctx, m));
  return list;
}

function liftEntry(ctx, m) {
  const { lift, latest } = m;
  const shown = m.shown;
  const assisted = lift.unit === "lb assistance";
  const id = `lift-${String(lift.id).replace(/[^\w-]/g, "")}`;
  const open = view.open.has(lift.id);
  const parts = latest ? setParts(latest.top_set || fmtNum(latest.score)) : { set: "—", rpe: "" };
  const sub = shown === "resting"
    ? `last ${latest && m.at ? shortDayET(m.at, yearET(m.at) !== yearET(new Date())) : "long ago"}`
    : parts.set;

  const mark = statusMark(m.status);
  if (shown === "resting") mark.classList.add("mark-resting");

  const row = h("button", {
    type: "button", class: "lift-row", id: `${id}-row`,
    "aria-expanded": open ? "true" : "false", "aria-controls": `${id}-more`,
    onclick: () => { if (view.open.has(lift.id)) view.open.delete(lift.id); else view.open.add(lift.id); ctx.render(); },
  },
  h("span", { class: "lift-name" }, lift.title || "Unnamed lift"),
  h("span", { class: "lift-best num" }, bestShort(lift), h("span", { class: "lift-best-cap" }, bestCaption(lift))),
  h("span", { class: "lift-sub" },
    h("span", { class: `status status-${shown}` }, STATUS_WORDS[shown]),
    h("span", { class: "num" }, ` · ${sub}`),
    m.next && shown !== "resting"
      ? h("span", { class: "lift-next" }, "next ", h("b", { class: "num" }, targetText(m.next.target)))
      : null));

  return h("li", { class: ["entry", "lift", `is-${shown}`, open ? "is-open" : ""], id },
    h("div", { class: "margin" }, mark),
    h("div", { class: "body" },
      h("h3", { class: "lift-title" }, row),
      open ? liftDetail(ctx, m, id, parts, assisted) : null));
}

function liftDetail(ctx, m, id, parts, assisted) {
  const { lift, latest } = m;
  const pts = chartPoints(lift);
  const charted = pts.length >= 2;
  const sessions = (lift.sessions || []).slice().sort((a, b) => (toDate(b.iso) || 0) - (toDate(a.iso) || 0));
  const showSessions = view.sessions.has(lift.id);
  const metaBits = [];
  if (lift.equipment && lift.equipment !== "none") metaBits.push(lift.equipment);
  if (assisted) metaBits.push("less help is better");
  if (!charted && pts.length === 1) metaBits.push(`first entry ${shortDayET(pts[0].t)}`);
  if (m.shown === "resting") metaBits.push(`was ${STATUS_WORDS[m.status]}`);

  const toggle = sessions.length > 1 ? h("button", {
    type: "button", class: "link-btn", id: `${id}-sessions`,
    "aria-expanded": showSessions ? "true" : "false", "aria-controls": `${id}-s`,
    onclick: () => { if (view.sessions.has(lift.id)) view.sessions.delete(lift.id); else view.sessions.add(lift.id); ctx.render(); },
  }, showSessions ? "Hide the sessions" : `Every session (${sessions.length})`) : null;

  return h("div", { class: "lift-detail", id: `${id}-more` },
    metaBits.length ? h("p", { class: "meta" }, metaBits.join(" · ")) : null,
    h("dl", { class: "figures" },
      h("div", null, h("dt", null, "Latest"),
        h("dd", { class: "num" },
          h("span", { class: "set" }, latest ? parts.set : "—"),
          parts.rpe ? h("span", { class: "rpe" }, `RPE ${parts.rpe}`) : null)),
      h("div", null, h("dt", null, `Best (${bestCaption(lift)})`), h("dd", { class: "num" }, bestText(lift))),
      m.next ? nextTimeFigure(m.next) : null,
    ),
    latest && latest.notes ? h("p", { class: "marginal" }, `Your note: “${latest.notes}”`) : null,
    charted ? liftChart(lift) : null,
    charted && assisted ? h("p", { class: "chart-caption" }, "Machine assistance, in lb. Drawn upside down: up the page means less help, which is progress.") : null,
    toggle ? h("div", { class: "lift-more" }, toggle) : null,
    showSessions && toggle ? sessionTable(lift, sessions, `${id}-s`) : null,
  );
}

/** The "Next time" line in an opened lift: the target, why, and where it came from. */
function nextTimeFigure(next) {
  const day = (next.when_et || "").match(/^[A-Za-z]{3}\s+([A-Za-z]{3}\s+\d{1,2})\b/);
  const from = [next.workout, day ? day[1] : ""].filter(Boolean).join(", ");
  return h("div", { class: "figure-next" },
    h("dt", null, "Next time"),
    h("dd", null,
      h("span", { class: "next-target num" }, targetText(next.target)),
      next.target.why ? h("span", { class: "next-why" }, arrows(String(next.target.why))) : null,
      from ? h("span", { class: "figure-next-from" }, `from ${from}`) : null));
}

function dateCell(session) {
  const d = toDate(session.iso);
  if (!d) return session.date || "";
  return shortDayET(d, yearET(d) !== yearET(new Date()));
}

function sessionTable(lift, sessions, id) {
  const unit = lift.unit === "lb assistance" ? "Help" : lift.unit === "reps" ? "Reps" : "Est. max";
  const pretty = (x) => String(x).replace(/\s+x\s+/g, " × ").replace(/\blb assist\b/, "lb help");
  return h("table", { class: "sessions", id },
    h("caption", { class: "visually-hidden" }, `${lift.title}: every session, newest first`),
    h("thead", null, h("tr", null,
      h("th", { scope: "col" }, "Date"),
      h("th", { scope: "col" }, "Sets"),
      h("th", { scope: "col", class: "num" }, unit))),
    h("tbody", null, sessions.map((s) => h("tr", null,
      h("td", { class: "num" }, dateCell(s)),
      h("td", null,
        ((s.sets && s.sets.length) ? s.sets : [s.top_set || ""]).map((x, i, all) =>
          [h("span", { class: "set-one" }, pretty(x) + (i < all.length - 1 ? "," : "")), i < all.length - 1 ? " " : null]),
        s.notes ? h("span", { class: "cell-note" }, s.notes) : null),
      h("td", { class: "num" }, figure(lift, Number(s.score))),
    ))),
  );
}
