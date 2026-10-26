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

export function demoClient() {
  let cache = null;
  const closed = new Set();
  const replies = new Map();
  let settingsOverride = null;
  let lastRun = { id: 100, at: Date.now() - 23 * 60000, status: "completed", conclusion: "success", event: "schedule" };

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
  };
}
