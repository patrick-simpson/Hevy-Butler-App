// Everything the app remembers lives in this browser's localStorage only.
// The GitHub key never leaves the phone except in requests to api.github.com.

const KEYS = {
  token: "ledger.token",
  repo: "ledger.repo",
  mode: "ledger.mode",            // "live" | "demo" | absent (first open)
  data: "ledger.appdata",         // last good app-data.json
  dataAt: "ledger.appdataAt",
  branch: "ledger.branch",
  pending: "ledger.pending",      // proposals we've answered and are waiting on
  loadingLine: "ledger.lastLine",
  saved: "ledger.savedSettings",  // settings saved here, until the butler's next round
};

export const DEFAULT_REPO = "patrick-simpson/Hevy-Butler";

function get(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function set(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_) { /* storage full or blocked: carry on without it */ }
}
function getJSON(key, fallback) {
  const raw = get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

export const store = {
  get mode() { return get(KEYS.mode); },
  set mode(v) { set(KEYS.mode, v); },

  get token() { return get(KEYS.token); },
  get repo() { return get(KEYS.repo) || DEFAULT_REPO; },
  get branch() { return get(KEYS.branch); },
  set branch(v) { set(KEYS.branch, v); },

  connect(token, repo, branch) {
    set(KEYS.token, token);
    set(KEYS.repo, repo);
    set(KEYS.branch, branch || null);
    set(KEYS.mode, "live");
  },

  /** "Forget my key": wipes the key and everything cached from the private repo. */
  forget() {
    for (const k of [KEYS.token, KEYS.repo, KEYS.mode, KEYS.data, KEYS.dataAt, KEYS.branch, KEYS.pending, KEYS.saved]) set(k, null);
  },

  cachedData() {
    return { data: getJSON(KEYS.data, null), at: Number(get(KEYS.dataAt)) || 0 };
  },
  saveData(data) {
    set(KEYS.data, JSON.stringify(data));
    set(KEYS.dataAt, String(Date.now()));
  },

  /** House rules saved from the ledger that the butler hasn't written back yet. */
  savedSettings() { return getJSON(KEYS.saved, null); },
  /** saved: {changes: {key: value}, on: [routine ids], off: [routine ids]} or null. */
  setSavedSettings(saved) {
    set(KEYS.saved, saved ? JSON.stringify({ at: Date.now(), ...saved }) : null);
  },

  pending() { return getJSON(KEYS.pending, {}); },
  setPending(number, action, since) {
    const p = this.pending();
    if (action) p[number] = { action, at: Date.now(), since: since || null };
    else delete p[number];
    set(KEYS.pending, JSON.stringify(p));
  },

  get lastLine() { return Number(get(KEYS.loadingLine)); },
  set lastLine(i) { set(KEYS.loadingLine, String(i)); },
};
