// Small hand-built SVG charts, drawn like pen work in a ledger.
// Text inside the SVG is set with textContent only.

import { s } from "./dom.js";
import { toDate, shortDayET, yearET } from "./time.js";

const W = 320;
const H = 104;
const PAD = { l: 44, r: 14, t: 14, b: 22 };
const GAP_DAYS = 28;   // a break in training longer than this is drawn dashed

function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** An Epley estimate is a guess, so it is shown to the pound, never to a tenth. */
export function isEstimate(lift) {
  return !lift.lower_is_better && (lift.unit === "lb est. max" || !lift.unit);
}

/** A lift's figure as shown: estimates rounded to the pound, real weights as they are. */
export function figure(lift, v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "";
  return isEstimate(lift) ? String(Math.round(Number(v))) : fmtNum(Number(v));
}

/** The sessions a chart can draw, oldest first. */
export function chartPoints(lift) {
  return (lift.sessions || [])
    .map((x) => ({ t: toDate(x.iso), v: Number(x.score), label: x.date }))
    .filter((p) => p.t && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
}

/**
 * lift: {title, unit, lower_is_better, best, sessions: [{iso, score, date}]}
 * Sessions are spaced evenly (one step per session, not by date), so a burst
 * of sessions never piles into a smudge; a long break shows as a dashed line.
 * Returns an <svg> element.
 */
export function liftChart(lift) {
  const pts = chartPoints(lift);

  const lower = !!lift.lower_is_better;
  const svg = s("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "chart",
    role: "img",
    "aria-label": chartLabel(lift, pts),
    preserveAspectRatio: "xMidYMid meet",
  });

  if (pts.length === 0) return svg;

  let vMin = Math.min(...pts.map((p) => p.v));
  let vMax = Math.max(...pts.map((p) => p.v));
  const flat = vMin === vMax;
  if (flat) { vMin -= 5; vMax += 5; }
  const span = vMax - vMin;
  const lo = vMin - span * 0.12;
  const hi = vMax + span * 0.12;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i) => (pts.length === 1 ? PAD.l + plotW / 2 : PAD.l + (i / (pts.length - 1)) * plotW);
  // For assisted lifts less help is better, so it is drawn higher.
  const y = (v) => {
    const f = (v - lo) / (hi - lo);
    return lower ? PAD.t + f * plotH : PAD.t + (1 - f) * plotH;
  };

  // Ruled lines: top and bottom of the range, like a ledger's feint rules.
  const topVal = lower ? vMin : vMax;
  const botVal = lower ? vMax : vMin;
  const ruled = flat ? [pts[0].v] : [topVal, botVal];
  for (const v of ruled) {
    const yy = y(v);
    svg.append(
      s("line", { x1: PAD.l - 4, x2: W - PAD.r, y1: yy, y2: yy, class: "chart-rule" }),
      s("text", { x: PAD.l - 8, y: yy + 4, class: "chart-y", "text-anchor": "end", text: figure(lift, v) }),
    );
  }
  // Baseline under the plot.
  svg.append(s("line", { x1: PAD.l - 4, x2: W - PAD.r, y1: H - PAD.b + 4, y2: H - PAD.b + 4, class: "chart-base" }));

  // First and last date along the bottom (with the year when they differ).
  const first = pts[0];
  const last = pts[pts.length - 1];
  const years = yearET(first.t) !== yearET(last.t);
  svg.append(s("text", { x: x(0), y: H - 5, class: "chart-x", "text-anchor": pts.length === 1 ? "middle" : "start", text: shortDayET(first.t, years) }));
  if (pts.length > 1) {
    svg.append(s("text", { x: x(pts.length - 1), y: H - 5, class: "chart-x", "text-anchor": "end", text: shortDayET(last.t, years) }));
  }

  if (lower) {
    svg.append(s("text", { x: PAD.l, y: 9, class: "chart-note", "text-anchor": "start", text: "↑ less help" }));
  }

  // The pen line, in runs: a faint second stroke slightly offset gives it an
  // inked feel. A long break between two sessions is a dashed, lighter line.
  if (pts.length > 1) {
    const at = (i) => `${x(i).toFixed(1)},${y(pts[i].v).toFixed(1)}`;
    let run = [0];
    const runs = [];
    const gaps = [];
    for (let i = 1; i < pts.length; i++) {
      if ((pts[i].t - pts[i - 1].t) / 86400000 > GAP_DAYS) {
        runs.push(run);
        gaps.push(i);
        run = [i];
      } else {
        run.push(i);
      }
    }
    runs.push(run);
    for (const i of gaps) {
      svg.append(s("path", { d: `M${at(i - 1)} L${at(i)}`, class: "chart-gap" }));
    }
    for (const r of runs) {
      if (r.length < 2) continue;
      const d = r.map((i, k) => `${k ? "L" : "M"}${at(i)}`).join(" ");
      svg.append(
        s("path", { d, class: "chart-ink-ghost", transform: "translate(0.6,0.8)" }),
        s("path", { d, class: "chart-ink" }),
      );
    }
  }

  // Best point (by the lift's own direction).
  const bestV = lower ? Math.min(...pts.map((p) => p.v)) : Math.max(...pts.map((p) => p.v));
  let bestIdx = -1;
  pts.forEach((p, i) => { if (p.v === bestV) bestIdx = i; });

  pts.forEach((p, i) => {
    const isBest = i === bestIdx;
    const isLast = i === pts.length - 1;
    svg.append(s("circle", {
      cx: x(i), cy: y(p.v), r: isBest ? 3.6 : 2.6,
      class: isBest ? "chart-dot best" : isLast ? "chart-dot last" : "chart-dot",
    }));
  });

  if (bestIdx >= 0 && pts.length > 1) {
    const bx = x(bestIdx);
    const by = y(pts[bestIdx].v);
    const anchor = bx > W - PAD.r - 18 ? "end" : bx < PAD.l + 18 ? "start" : "middle";
    const dx = anchor === "end" ? 4 : anchor === "start" ? -4 : 0;
    svg.append(s("text", { x: bx + dx, y: by - 8, class: "chart-best", "text-anchor": anchor, text: "best" }));
  }
  return svg;
}

function chartLabel(lift, pts) {
  if (!pts.length) return `${lift.title}: no sessions yet`;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const unit = lift.unit || "";
  const dir = lift.lower_is_better ? " (lower is better)" : "";
  return `${lift.title}: ${pts.length} session${pts.length === 1 ? "" : "s"}, from ${figure(lift, first.v)} to ${figure(lift, last.v)} ${unit}${dir}`;
}

/** A small pen mark for the margin: climbing, stalled, slipping or new. */
export function statusMark(status) {
  const svg = s("svg", { viewBox: "0 0 24 24", class: `mark mark-${status}`, "aria-hidden": "true" });
  if (status === "climbing") {
    svg.append(s("path", { d: "M5 18.5 C9 14, 13 10, 18.5 5.5 M11.5 5.2 L18.6 5.4 L18.4 12.4" }));
  } else if (status === "slipping") {
    svg.append(s("path", { d: "M5 5.5 C9 10, 13 14, 18.5 18.5 M18.4 11.6 L18.6 18.6 L11.5 18.8" }));
  } else if (status === "stalled") {
    svg.append(s("path", { d: "M4.5 9.5 C9 9, 15 10, 19.5 9.4 M4.5 14.6 C9 14.2, 15 15.1, 19.5 14.5" }));
  } else {
    svg.append(s("path", { d: "M12 4.5 V19.5 M5.5 8.2 L18.5 15.8 M18.5 8.2 L5.5 15.8" }));
  }
  return svg;
}

export const STATUS_WORDS = {
  climbing: "climbing",
  stalled: "stalled",
  slipping: "slipping",
  new: "new entry",
  resting: "resting",
};

export { fmtNum };
