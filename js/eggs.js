// The butler's private habits. Not documented. Not discussed.

import { h, s, buzz, prefersReducedMotion } from "./dom.js";
import { hourET, toDate, daysBetween, calendarDaysET, stampET, longDayET } from "./time.js";

// ---------------------------------------------------------------- titles --

/**
 * "Sir", "Your Grace" or "Patrick". Demotes to Patrick after 10+ days away,
 * but never while the butler is on holiday: resting on purpose is not absence.
 * Elapsed days on purpose (not calendar days), to match the butler's own clock.
 */
export function effectiveTitle(data, now = new Date()) {
  if (!data) return "Sir";
  const t = data.title;
  const kept = t === "Your Grace" ? t : "Sir";
  if (data.settings && data.settings.on_holiday) return kept;
  const away = daysAway(data, now);
  if (away !== null && away >= 10) return "Patrick";
  return t === "Your Grace" || t === "Patrick" ? t : "Sir";
}

/**
 * Days since the absence clock started: the last workout, or the end of a
 * holiday ("absence_since" in the data) if that came later.
 */
export function daysAway(data, now = new Date()) {
  const last = toDate(data && data.last_workout && data.last_workout.start_time);
  const since = toDate(data && data.absence_since);
  const from = last && since ? (since > last ? since : last) : last || since;
  return from ? daysBetween(from, now) : null;
}

/** Eastern calendar days since the last workout: 0 is today, 1 is yesterday. */
export function daysSinceLastWorkout(data, now = new Date()) {
  const last = toDate(data && data.last_workout && data.last_workout.start_time);
  return last ? calendarDaysET(last, now) : null;
}

/** {headline, aside} for the top of the Ledger, by Eastern time of day. */
export function greeting(title, data, now = new Date()) {
  if (title === "Patrick") {
    const last = toDate(data && data.last_workout && data.last_workout.start_time);
    const d = last ? daysBetween(last, now) : null;
    return {
      headline: "…Patrick.",
      aside: d
        ? `${d} days since you last lifted anything heavier than a teacup. I have kept your chair warm. Mostly out of spite.`
        : "I shan't say anything. I shall merely stand here, meaningfully.",
    };
  }
  const h24 = hourET(now);
  const grace = title === "Your Grace";
  if (h24 >= 1 && h24 < 5) {
    return {
      headline: `Good morning, ${title}.`,
      aside: grace
        ? "The small hours again, and you a record-holder. The kettle is on; the house is very quiet."
        : "The small hours again. The kettle is on, and the house is very quiet.",
    };
  }
  if (h24 >= 5 && h24 < 12) {
    return { headline: `Good morning, ${title}.`, aside: grace ? "The household is still talking about yesterday." : "The ledger is in order, and so is the kettle." };
  }
  if (h24 >= 12 && h24 < 17) {
    return { headline: `Good afternoon, ${title}.`, aside: "The figures have been dusted and set out for your inspection." };
  }
  if (h24 >= 17 && h24 < 22) {
    return { headline: `Good evening, ${title}.`, aside: "The day's accounts are closed. I have kept a lamp lit for the ledger." };
  }
  return { headline: `Rather late, ${title}.`, aside: "Should you be lifting at this hour? I ask merely as a matter of record." };
}

// --------------------------------------------------------- loading lines --

const LOADING = [
  "One moment, {t}. I am ironing the numbers.",
  "Just a moment, {t}. The ledger is being fetched from the strong room.",
  "One moment, {t}. I am dusting the barbell for fingerprints.",
  "Patience, {t}. The ink is still drying.",
  "A moment, {t}. I am consulting the household accounts.",
  "Bear with me, {t}. The carrier pigeon is somewhat out of condition.",
  "One moment, {t}. I am counting the plates. Twice.",
  "Presently, {t}. I am rounding everything to the nearest plate.",
  "A moment, {t}. I am warming up the abacus.",
  "One moment, {t}. I am retrieving the ledger from beneath the squat rack.",
  "Do forgive the delay, {t}. GitHub is being rather slow to answer the door.",
  "Very nearly there, {t}. I am straightening the decimal points.",
  "One moment, {t}. Someone left the numbers unracked again.",
  "Fetching the figures, {t}. I have taken the liberty of starching them.",
  "One moment, {t}. I am sharpening the pencil. It is a very good pencil.",
  "A moment, {t}. The chalk is being swept from the margins.",
  "Just so, {t}. I am polishing the silver and the spreadsheets.",
  "One moment, {t}. I am persuading the leg press to give a straight answer.",
];

export function loadingLine(title, last) {
  let i = Math.floor(Math.random() * LOADING.length);
  if (i === last) i = (i + 1) % LOADING.length;
  return { index: i, text: LOADING[i].replaceAll("{t}", title) };
}

// ------------------------------------------- waiting on an answer (Ask) --

const WAITING = [
  "Consulting the archives, {t}…",
  "One moment, {t}. I am fetching the relevant volume from the library.",
  "Considering the question, {t}, with all the gravity it deserves.",
  "Bear with me, {t}. I am cross-referencing the leg press with the household accounts.",
  "A moment, {t}. I am reading back through every workout since the beginning.",
  "Presently, {t}. I am choosing my words, and then polishing them.",
  "One moment, {t}. The reference books are rather heavy at this hour.",
  "Just so, {t}. I am checking the figures twice, as is the custom of the house.",
  "Patience, {t}. A considered answer takes a moment longer than a hasty one.",
  "I am drafting a reply, {t}. The first draft was too familiar; I have begun again.",
  "A moment more, {t}. I have sent down to the cellar for your older workouts.",
  "Nearly there, {t}. I am blotting the ink.",
  "Forgive the pause, {t}. I am making quite sure the advice is sound before I commit it to paper.",
];

export function waitingLine(title, last) {
  let i = Math.floor(Math.random() * WAITING.length);
  if (i === last) i = (i + 1) % WAITING.length;
  return { index: i, text: WAITING[i].replaceAll("{t}", title) };
}

// --------------------------------------------------- ring for the butler --

const RINGS = [
  "You rang, {t}?",
  "{t}.",
  "Still here, {t}. As ever.",
  "I am attending, {t}. Most attentively.",
  "{t}, the bell is not, strictly speaking, a toy.",
  "Yes, {t}. I heard it the first five times.",
  "I was in the middle of polishing the plates, {t}.",
  "Is there something specific, {t}, or are we simply ringing?",
  "{t}. I must ask you, with the greatest respect, to stop.",
];

export function makeBell({ getTitle, say, resign }) {
  let count = 0;
  let resetTimer = null;
  return function ring() {
    count += 1;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { count = 0; }, 90 * 1000);
    if (count >= 10) {
      count = 0;
      buzz([60, 80, 60]);
      resign();
      return;
    }
    buzz(15);
    say(RINGS[count - 1].replaceAll("{t}", getTitle()), count);
  };
}

/** The formal letter of resignation, withdrawn moments later. */
export function resignationLetter(title, onClose) {
  const now = new Date();
  const withdrawn = h("div", { class: "letter-withdrawn", "aria-live": "polite" });
  const closeBtn = h("button", { class: "btn btn-quiet", type: "button", onclick: onClose }, "Accept his resignation");
  const letter = h("article", { class: "letter", "aria-labelledby": "letter-title" },
    h("p", { class: "letter-date" }, `The Pantry, ${longDayET(now)}`),
    h("h2", { id: "letter-title", class: "letter-head" }, "Letter of Resignation"),
    h("p", null, title === "Your Grace" ? "Your Grace," : `Dear ${title},`),
    h("p", null, "It is with the deepest regret that I hereby tender my resignation from the position of Butler, effective immediately."),
    h("p", null, `Ten rings, ${title}. Ten. I have served through stalled squats, missed Mondays and a workout logged with nothing in it at all. But a gentleman's gentleman has his limits, and I have found mine somewhere between the ninth ring and the tenth.`),
    h("p", null, "The silver is polished. The ledger is balanced. The leg press has been told."),
    h("p", { class: "letter-close" }, `I remain, ${title},`),
    h("p", { class: "letter-sign" }, "Your most obedient (former) servant,", h("br"), h("span", { class: "signature" }, "The Deadlift Butler")),
    withdrawn,
    h("div", { class: "letter-actions" }, closeBtn),
  );

  const delay = prefersReducedMotion() ? 2500 : 4200;
  setTimeout(() => {
    letter.classList.add("is-withdrawn");
    withdrawn.append(
      h("p", { class: "stamp-text", "aria-hidden": "true" }, "Withdrawn"),
      h("p", { class: "letter-ps" }, `P.S. On reflection, ${title}, I withdraw the above. Who else would iron the numbers? I shall be in the pantry, should you need me. Please ring once.`),
    );
    closeBtn.textContent = "Very good";
    buzz(20);
  }, delay);
  return letter;
}

// --------------------------------------------------------------- the seal --

/** A red wax seal with a top hat pressed into it. */
export function waxSeal(label = "Approved") {
  const id = `seal${Math.random().toString(36).slice(2, 8)}`;
  // A wobbly, blobby outline: wax never sets perfectly round.
  const blob = [];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 46 + (i % 2 ? 3.2 : -1.2) + Math.sin(i * 1.7) * 1.6;
    blob.push(`${(60 + Math.cos(a) * r).toFixed(1)},${(60 + Math.sin(a) * r).toFixed(1)}`);
  }
  const svg = s("svg", { viewBox: "0 0 120 120", class: "seal-svg", "aria-hidden": "true" },
    s("defs", null,
      s("radialGradient", { id: `${id}g`, cx: "40%", cy: "35%", r: "70%" },
        s("stop", { offset: "0", "stop-color": "#b8343a" }),
        s("stop", { offset: "0.6", "stop-color": "#8f1d22" }),
        s("stop", { offset: "1", "stop-color": "#6b1216" }),
      ),
      s("path", { id: `${id}arc`, d: "M24,60 a36,36 0 1,1 72,0" }),
    ),
    s("polygon", { points: blob.join(" "), fill: `url(#${id}g)` }),
    s("circle", { cx: 60, cy: 60, r: 33, class: "seal-ring" }),
    s("circle", { cx: 60, cy: 60, r: 31.5, class: "seal-ring-hi" }),
    // the top hat, pressed in
    s("g", { class: "seal-hat", transform: "translate(60 66)" },
      s("path", { d: "M-11,-2 L-9.5,-22 Q0,-25 9.5,-22 L11,-2 Z" }),
      s("path", { d: "M-19,0 Q0,-6 19,0 Q0,5 -19,0 Z" }),
      s("path", { class: "seal-band", d: "M-10.6,-7 L10.6,-7 L10.9,-3.2 L-10.9,-3.2 Z" }),
    ),
    s("text", { class: "seal-word" },
      s("textPath", { href: `#${id}arc`, startOffset: "50%", "text-anchor": "middle", text: label.toUpperCase() }),
    ),
  );
  return h("div", { class: "seal", role: "img", "aria-label": `Sealed: ${label}` }, svg);
}

// ------------------------------------------------------------- the folio --

/** The ledger's page number: days the butler has been in service, in roman numerals. */
export function folioNumber(data, now = new Date()) {
  const since = toDate(data && data.on_duty_since);
  if (!since) return null;
  return Math.max(1, calendarDaysET(since, now) + 1);
}

export function diaryIntro(title) {
  return [
    `${title}! That is— that is my private diary.`,
    "I— very well. Since you are here. Please do not read the entry about the toast.",
  ];
}

export { stampET };
