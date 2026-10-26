// "Have a look around first": the same interface as the GitHub client, but every
// answer comes from demo-data.json and every action is pretend. Nothing leaves the phone.

import { mergeSettings } from "./github.js";
import { HANDLED } from "./plan.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function runShape(r) {
  const iso = new Date(r.at).toISOString();
  return {
    id: r.id, event: r.event || "workflow_dispatch", status: r.status, conclusion: r.conclusion,
    created_at: iso, run_started_at: iso, updated_at: iso, html_url: "#/rules",
  };
}

// Invented answers for the sample household's "A word with the butler".
// Picked by a word or two in the question; every one says it is a sample.
const SAMPLE_NOTE = "(A sample answer, Your Grace: in your own ledger he reads your real workouts.)";
const CANNED = [
  [/rest|tired|sore|sleep|tomorrow/i,
    "Your Grace, you have trained three times in the past six days, and the lateral raises told me your shoulder grumbled.\n\nTake tomorrow off, or walk instead. Train again the day after, when the shoulder has had its say. Rest is not idleness; it is where the strength is kept."],
  [/leg press|legs?\b|squat/i,
    "Your Grace, the leg press is the pride of the household. You went from 270 lb for 10 in early September to 320 lb for 9 last night, a new best.\n\nStay at 320 lb until you make 10 on every set; Hevy Trainer will raise it for you after that. Rest a full two minutes between sets: the machine will wait."],
  [/stall|stuck|plateau|deload|\brow\b/i,
    "Your Grace, the seated row has sat at 130 lb for six sessions. That is a plateau, not a failure.\n\nA short step back usually breaks it: two weeks at 120 lb for 3 sets of 10, then return to 130 lb. I have written that up for your approval under Awaiting."],
  [/chest|bench|press/i,
    "Your Grace, the chest press is climbing nicely: 130 lb for 10 on your last visit.\n\nNext time try 140 lb for 8. If the last set falls short, stay there until all three sets reach 8."],
];
const FALLBACK = "Your Grace, an excellent question. Over the past eight weeks you have trained 24 times, and five of your eight lifts are climbing.\n\nKeep to two or three workouts a week as you have been, add a little weight only once every set reaches its reps, and mind the shoulder on the lateral raises.";

// "Think harder": a longer, more considered invented answer.
const CAREFUL = "Your Grace, I have gone through all twenty-four workouts before answering, rather than the last few.\n\n"
  + "Three things stand out. Your legs and back are doing the heavy lifting of this household: the leg press has climbed 50 lb since September. "
  + "Your shoulders have had less of the work, and the lateral raises have slipped from 20 lb in late September to 15 lb, which, with the grumbling you noted, "
  + "says the shoulder wants care rather than more weight. And the seated row has sat at 130 lb for six sessions.\n\n"
  + "So: keep the leg press as it is. Take the row back to 120 lb for two weeks of 3 sets of 10, then return to 130 lb. "
  + "Hold the lateral raises at 15 lb, slowly, until all three sets reach 12 without complaint.";

function cannedAnswer(question, careful = false) {
  if (careful) return `${CAREFUL}\n\n${SAMPLE_NOTE}`;
  const hit = CANNED.find(([re]) => re.test(question));
  return `${hit ? hit[1] : FALLBACK}\n\n${SAMPLE_NOTE}`;
}

function etStamp(date) {
  const f = (o) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...o }).format(date);
  return `${f({ weekday: "short" })} ${f({ month: "short", day: "numeric" })}, ${f({ hour: "numeric", minute: "2-digit" })} ET`;
}

export function demoClient() {
  let cache = null;
  const closed = new Set();
  const replies = new Map();
  let settingsOverride = null;
  let lastRun = { id: 100, at: Date.now() - 23 * 60000, status: "completed", conclusion: "success", event: "schedule" };
  let convo = null;                // the sample letters, plus any asked here
  const askRuns = [];              // pretend question runs, newest first
  let accounts = null;             // the sample statements, plus any requested here
  const accRuns = [];              // pretend accounts runs, newest first

  async function load() {
    if (!cache) {
      const res = await fetch("./demo-data.json");
      cache = await res.json();
    }
    return cache;
  }

  return {
    demo: true,
    repo: "a sample household",

    async appData() {
      await wait(450);
      const d = structuredClone((await load()).app_data);
      if (settingsOverride) {
        d.settings = settingsOverride;
        const tunable = new Set(d.settings.tunable_routines || []);
        d.routines.forEach((r) => { r.tunable = tunable.has(r.id); });
      }
      return d;
    },

    async proposals() {
      await wait(300);
      return structuredClone((await load()).issues).filter((i) => !closed.has(i.number));
    },

    async answer(number, body) {
      await wait(400);
      const id = Date.now();
      // The pretend butler attends to it a few seconds later.
      setTimeout(() => {
        closed.add(number);
        replies.set(number, {
          id: id + 1,
          created_at: new Date().toISOString(),
          body: body === "/decline"
            ? `As you wish, Sir. The proposal has been quietly shown out. (This is the sample household, so nothing was really changed.)\n\n${HANDLED}`
            : `Very good, Sir. It is done. (This is the sample household, so nothing was really changed.)\n\n${HANDLED}`,
        });
      }, 3500);
      return { id, created_at: new Date(id).toISOString(), body };
    },

    async issue(number) {
      await wait(200);
      return { number, state: closed.has(number) ? "closed" : "open" };
    },

    async comments(number) {
      await wait(150);
      return replies.has(number) ? [replies.get(number)] : [];
    },

    async saveSettings(changes, toggles) {
      await wait(700);
      const base = settingsOverride || (await load()).app_data.settings;
      settingsOverride = mergeSettings(base, changes, toggles);
      return structuredClone(settingsOverride);
    },

    /** A pretend round: it "runs" for a few seconds and finds nothing new. */
    async dispatch() {
      await wait(500);
      lastRun = { id: (lastRun.id || 100) + 1, at: Date.now(), status: "in_progress", conclusion: null };
      const id = lastRun.id;
      setTimeout(() => { if (lastRun.id === id) lastRun = { ...lastRun, status: "completed", conclusion: "success" }; }, 3500);
      return null;
    },

    async latestRun() {
      await wait(200);
      return runShape(lastRun);
    },

    async recentRuns() {
      await wait(200);
      return [runShape(lastRun)];
    },

    async run() {
      await wait(150);
      return runShape(lastRun);
    },

    runsPage() { return "#/rules"; },

    // --- A word with the butler (pretend) ---------------------------------

    async conversation() {
      await wait(350);
      if (!convo) convo = structuredClone((await load()).conversation || { version: 1, messages: [] });
      return structuredClone(convo);
    },

    /** A pretend run: it "thinks" for a few seconds, then writes an invented answer. */
    async askDispatch(question, askId, fresh, careful = false) {
      await wait(400);
      if (!convo) convo = structuredClone((await load()).conversation || { version: 1, messages: [] });
      const id = 500 + askRuns.length;
      const now = new Date();
      const run = {
        id, event: "workflow_dispatch", status: "queued", conclusion: null, html_url: "#/ask",
        display_title: `A word with the butler (${askId})`, created_at: now.toISOString(),
      };
      askRuns.unshift(run);
      setTimeout(() => { run.status = "in_progress"; }, 1200);
      setTimeout(() => {
        const nos = convo.messages.map((m) => Number(m.conversation) || 1);
        const top = nos.length ? Math.max(...nos) : 0;
        const done = new Date();
        convo.messages.push({
          ask_id: askId, conversation: fresh || !top ? top + 1 : top,
          asked: now.toISOString(), asked_et: etStamp(now), question,
          answer: cannedAnswer(question, careful), answered_et: etStamp(done),
          model: careful ? "claude-opus-5-5" : "claude-haiku-5-5", status: "answered",
          ...(careful ? { careful: true } : {}),
        });
        run.status = "completed";
        run.conclusion = "success";
      }, careful ? 9500 : 6500);
      return null;
    },

    async askRuns() {
      await wait(150);
      return structuredClone(askRuns.slice(0, 10));
    },

    async askRun(id) {
      await wait(120);
      return structuredClone(askRuns.find((r) => r.id === id) || null);
    },

    askRunsPage() { return "#/ask"; },

    // --- The monthly accounts (pretend) -----------------------------------

    async accounts() {
      await wait(350);
      if (!accounts) accounts = structuredClone((await load()).accounts || { version: 1, accounts: [] });
      return structuredClone(accounts);
    },

    /** A pretend run: Opus "thinks hard" for a few seconds, then files an invented statement. */
    async accountsDispatch(requestId) {
      await wait(450);
      if (!accounts) accounts = structuredClone((await load()).accounts || { version: 1, accounts: [] });
      const template = (await load()).accounts_on_request;
      const id = 900 + accRuns.length;
      const now = new Date();
      const run = {
        id, event: "workflow_dispatch", status: "queued", conclusion: null, html_url: "#/accounts",
        display_title: `Accounts: ${requestId}`, created_at: now.toISOString(),
      };
      accRuns.unshift(run);
      setTimeout(() => { run.status = "in_progress"; }, 1500);
      setTimeout(() => {
        const done = new Date();
        if (template) {
          accounts.accounts.push({
            ...structuredClone(template), id: `acc-${requestId}`, request_id: requestId,
            written: done.toISOString(), written_et: etStamp(done),
          });
        }
        run.status = "completed";
        run.conclusion = "success";
      }, 11000);
      return null;
    },

    async accountsRuns() {
      await wait(150);
      return structuredClone(accRuns.slice(0, 10));
    },

    async accountsRun(id) {
      await wait(120);
      return structuredClone(accRuns.find((r) => r.id === id) || null);
    },

    accountsRunsPage() { return "#/accounts"; },
  };
}
