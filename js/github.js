// Talks to GitHub's REST API with the owner's fine-grained key.
// Nothing here is ever cached by the service worker, and the key is never logged.

const API = "https://api.github.com";
const SETTINGS_MESSAGE = "🎩 House rules updated from the ledger";

// Which permission each kind of call needs, in the words GitHub's token page uses.
const AREA_PERMISSION = {
  contents: "Contents",
  appdata: "Contents",
  issues: "Issues",
  actions: "Actions",
  repo: "Metadata",
};

export class GitHubError extends Error {
  constructor(status, area, githubMessage) {
    super(`GitHub ${status} (${area}): ${githubMessage || ""}`);
    this.status = status;
    this.area = area;
    this.githubMessage = githubMessage || "";
  }
}

/** Turns a failed call into plain English for the owner. */
export function explain(err, repo) {
  if (!(err instanceof GitHubError)) {
    return "I couldn't reach GitHub. Are you online? If you are, try again in a minute.";
  }
  const perm = AREA_PERMISSION[err.area] || "Contents";
  const msg = err.githubMessage.toLowerCase();
  if (err.status === -1) {
    return "The butler's ledger file is there but I can't read it (it isn't valid JSON). The next round should tidy it up.";
  }
  if (err.status === 0) return "I couldn't reach GitHub. Are you online? If you are, try again in a minute.";
  if (err.status === 401) {
    return "GitHub didn't accept the key. It may be mistyped, expired or deleted. Make a new one and paste it in again.";
  }
  if ((err.status === 403 || err.status === 429) && msg.includes("rate limit")) {
    return "GitHub has asked us to slow down for a little while (a rate limit). Try again in a few minutes.";
  }
  if (err.status === 403) {
    return `The key is missing the "${perm}" permission. On GitHub, edit the key and set ${perm} to "Read and write".`;
  }
  if (err.status === 404) {
    if (err.area === "repo") {
      return `I can't find ${repo}. Check the spelling, and that the key's "Repository access" includes that repository.`;
    }
    if (err.area === "appdata") {
      return "The butler hasn't written his ledger yet (state/app-data.json is missing). Tap \"Sync\" at the top, or run the butler once from the Actions tab on GitHub.";
    }
    if (err.area === "actions") {
      return "I can't find the butler's workflow (.github/workflows/butler.yml), or the key is missing the \"Actions\" permission.";
    }
    return `GitHub says it can't find that. The key may be missing the "${perm}" permission.`;
  }
  if (err.status === 409 || err.status === 422) {
    return "Someone else changed the same thing at the same moment. Please try once more.";
  }
  if (err.status >= 500) return "GitHub is having a moment of its own. Try again shortly.";
  return `GitHub said no (error ${err.status}). Try again in a minute.`;
}

/**
 * Why Sync (or a rehearsal) couldn't start the butler, in plain English. The
 * usual cause is a key made without the "Actions" permission, or with it set
 * to "Read-only": starting a round needs "Read and write".
 */
export function explainStart(err, repo) {
  if (err instanceof GitHubError && err.area === "actions") {
    const msg = err.githubMessage.toLowerCase();
    const rate = msg.includes("rate limit");
    if ((err.status === 403 && !rate) || err.status === 404) {
      return "Your GitHub key needs one more permission to start him. On GitHub, edit the key " +
        "(Settings → Developer settings → Fine-grained tokens) and set \"Actions\" to \"Read and write\".";
    }
    if (err.status === 422) {
      return "GitHub wouldn't start the butler. His workflow may be switched off: on GitHub, open the Actions tab, " +
        "choose \"Butler on duty\" and press \"Enable workflow\" if it offers one.";
    }
  }
  return explain(err, repo);
}

// --- base64 that survives emoji and accents -------------------------------

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// --- settings ---------------------------------------------------------------

/**
 * file: the settings as they are now; changes: {key: value} the owner edited;
 * toggles: {on: [routine ids], off: [routine ids]}. Pure, so the demo uses it too.
 */
export function mergeSettings(file, changes = {}, toggles = {}) {
  const merged = { ...(file || {}), ...(changes || {}) };
  const on = toggles.on || [];
  const off = new Set(toggles.off || []);
  if (on.length || off.size) {
    const list = Array.isArray(merged.tunable_routines) ? merged.tunable_routines : [];
    const next = list.filter((id) => !off.has(id));
    for (const id of on) if (!next.includes(id)) next.push(id);
    merged.tunable_routines = next;
  }
  return merged;
}

// --- the client -----------------------------------------------------------

export function liveClient(token, repo) {
  async function call(method, path, { area, accept, body } = {}) {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: accept || "application/vnd.github+json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers,
        cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) {
      throw new GitHubError(0, area, "network");
    }
    if (!res.ok) {
      let message = "";
      try { message = (await res.json()).message || ""; } catch (_) { /* no body */ }
      throw new GitHubError(res.status, area, message);
    }
    if (res.status === 204) return null;
    if (accept && accept.includes("raw")) return res.text();
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const R = `/repos/${repo}`;

  return {
    demo: false,
    repo,

    getRepo() { return call("GET", R, { area: "repo" }); },

    async appData() {
      const raw = await call("GET", `${R}/contents/state/app-data.json`, {
        area: "appdata", accept: "application/vnd.github.raw+json",
      });
      try {
        return JSON.parse(raw);
      } catch (_) {
        throw new GitHubError(-1, "appdata", "unreadable");
      }
    },

    async proposals() {
      const list = await call("GET", `${R}/issues?labels=butler-proposal&state=open&per_page=30`, { area: "issues" });
      return (list || []).filter((i) => !i.pull_request);
    },

    issue(number) { return call("GET", `${R}/issues/${number}`, { area: "issues" }); },

    comments(number) { return call("GET", `${R}/issues/${number}/comments?per_page=100`, { area: "issues" }); },

    /** body is exactly "/approve" or "/decline" */
    answer(number, body) {
      return call("POST", `${R}/issues/${number}/comments`, { area: "issues", body: { body } });
    },

    /** Returns {sha, json} or null when settings.json doesn't exist yet. */
    async settingsFile() {
      try {
        const file = await call("GET", `${R}/contents/settings.json`, { area: "contents" });
        let json = {};
        try { json = JSON.parse(fromBase64(file.content || "")); } catch (_) { json = {}; }
        if (!json || typeof json !== "object" || Array.isArray(json)) json = {};
        return { sha: file.sha, json };
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
      }
    },

    /**
     * Saves only what the owner changed. Reads settings.json fresh (on every
     * attempt), lays the changed keys over it, and switches routines on or off
     * in the file's own tunable_routines list. Every other key stays exactly as
     * the file has it. Returns the merged settings that were written.
     */
    async saveSettings(changes, toggles = {}) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const file = await this.settingsFile();
        const merged = mergeSettings(file ? file.json : {}, changes, toggles);
        const body = {
          message: SETTINGS_MESSAGE,
          content: toBase64(JSON.stringify(merged, null, 2) + "\n"),
        };
        if (file) body.sha = file.sha;
        try {
          await call("PUT", `${R}/contents/settings.json`, { area: "contents", body });
          return merged;
        } catch (err) {
          const retry = err instanceof GitHubError && (err.status === 409 || err.status === 422) && attempt === 0;
          if (!retry) throw err;
        }
      }
      return null;
    },

    async defaultBranch() {
      const info = await this.getRepo();
      return info.default_branch || "main";
    },

    async dispatch(dryRun, branch) {
      const ref = branch || (await this.defaultBranch());
      return call("POST", `${R}/actions/workflows/butler.yml/dispatches`, {
        area: "actions",
        body: { ref, inputs: { dry_run: dryRun ? "true" : "false" } },
      });
    },

    async latestRun() {
      const res = await call("GET", `${R}/actions/workflows/butler.yml/runs?per_page=1`, { area: "actions" });
      return (res && res.workflow_runs && res.workflow_runs[0]) || null;
    },

    /** The butler's five most recent rounds, newest first. */
    async recentRuns() {
      const res = await call("GET", `${R}/actions/workflows/butler.yml/runs?per_page=5`, { area: "actions" });
      return (res && Array.isArray(res.workflow_runs)) ? res.workflow_runs : [];
    },

    /** One round, by its id. */
    run(id) { return call("GET", `${R}/actions/runs/${id}`, { area: "actions" }); },

    /** Where to watch the butler's rounds on GitHub. */
    runsPage() { return `https://github.com/${repo}/actions/workflows/butler.yml`; },

    /**
     * Checks the key step by step and reports, in plain English, what works.
     * Returns {ok, branch, checks: [{label, ok, note}]}.
     */
    async verify() {
      const checks = [];
      let info;
      try {
        info = await this.getRepo();
        checks.push({ label: `Can see ${repo}`, ok: true });
      } catch (err) {
        checks.push({ label: `Can see ${repo}`, ok: false, note: explain(err, repo) });
        return { ok: false, fatal: true, checks };
      }
      const probe = async (label, fn, okNote) => {
        try {
          await fn();
          checks.push({ label, ok: true, note: okNote });
          return true;
        } catch (err) {
          // A missing ledger is not the key's fault.
          if (err instanceof GitHubError && err.area === "appdata" && err.status === 404) {
            checks.push({ label, ok: true, note: explain(err, repo) });
            return true;
          }
          checks.push({ label, ok: false, note: explain(err, repo) });
          return false;
        }
      };
      const contents = await probe("Contents: can read the ledger", () => this.appData());
      const issues = await probe("Issues: can see proposals", () => this.proposals());
      const actions = await probe("Actions: can see the butler's rounds", () => this.latestRun());
      return {
        ok: contents && issues && actions,
        fatal: !contents,
        branch: info.default_branch || "main",
        checks,
      };
    },
  };
}
