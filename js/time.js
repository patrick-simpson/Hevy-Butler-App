// Every time the app shows is Eastern Time, labelled "ET".

const TZ = "America/New_York";

function fmt(date, options) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...options }).format(date);
}

export function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "4:12 AM" */
export function clockET(date) {
  return fmt(date, { hour: "numeric", minute: "2-digit" });
}

/** "Mon Oct 26, 4:12 AM ET" */
export function stampET(date) {
  const wd = fmt(date, { weekday: "short" });
  const md = fmt(date, { month: "short", day: "numeric" });
  return `${wd} ${md}, ${clockET(date)} ET`;
}

/** "Monday, October 26" */
export function longDayET(date) {
  return fmt(date, { weekday: "long", month: "long", day: "numeric" });
}

/** "Oct 26", or "Oct 26 '25" with the year. */
export function shortDayET(date, withYear = false) {
  const md = fmt(date, { month: "short", day: "numeric" });
  return withYear ? `${md} '${fmt(date, { year: "2-digit" })}` : md;
}

/** The calendar year in Eastern Time, e.g. 2026. */
export function yearET(date) {
  return Number(fmt(date, { year: "numeric" }));
}

/** "2026-10-26": a key for grouping by Eastern calendar day. */
export function dayKeyET(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour of day (0-23) in Eastern Time. */
export function hourET(date = new Date()) {
  const h = Number(fmt(date, { hour: "numeric", hourCycle: "h23" }));
  return h === 24 ? 0 : h;
}

/** "just now", "12 min ago", "3 hours ago", "2 days ago" */
export function ago(date, now = new Date()) {
  const mins = Math.round((now - date) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Whole 24-hour blocks from a to b (elapsed time, not calendar days). */
export function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}

/**
 * Eastern calendar days from a to b: 11 PM Monday to 8 AM Tuesday is 1 day
 * ("yesterday"), even though fewer than 24 hours have passed.
 */
export function calendarDaysET(a, b) {
  return Math.round((Date.parse(dayKeyET(b)) - Date.parse(dayKeyET(a))) / 86400000);
}

/** Lower-case roman numerals for the folio number. */
export function roman(n) {
  if (!Number.isFinite(n) || n < 1) return "i";
  const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  let left = Math.floor(n);
  for (const [v, r] of table) while (left >= v) { out += r; left -= v; }
  return out;
}
