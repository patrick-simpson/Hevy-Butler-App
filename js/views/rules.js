// HOUSE RULES: settings (built from the schema), routines the butler may tune,
// buttons that start the butler (Sync, Rehearse), his health, the last rehearsal, and your key.

import { h, arrows } from "../dom.js";
import { store } from "../store.js";
import { explain } from "../github.js";
import { toDate, ago, clockET } from "../time.js";
import { fmtNum } from "../charts.js";

let bundledSchema = null;
let bundledLoading = false;

const state = {
  client: null,
  draft: null,       // {key: value} edits not yet saved: only what the owner touched
  on: new Set(),     // routine ids switched on here, not yet saved
  off: new Set(),    // routine ids switched off here, not yet saved
  file: null,        // {json}: settings.json as it is on GitHub right now
  fileAt: 0,
  fileLoading: false,
  saving: false,
  saveNote: null,    // {tone, text}
  run: null,         // latest workflow run
  runError: null,
  runFetchedAt: 0,
};

function reset(ctx) {
  Object.assign(state, {
    client: ctx.client, draft: null, on: new Set(), off: new Set(), file: null, fileAt: 0, fileLoading: false,
    saving: false, saveNote: null, run: null, runError: null, runFetchedAt: 0,
  });
}

function schemaFor(ctx) {
  const fromData = ctx.data && Array.isArray(ctx.data.settings_schema) && ctx.data.settings_schema.length
    ? ctx.data.settings_schema : null;
  if (fromData) return fromData;
  if (!bundledSchema && !bundledLoading) {
    bundledLoading = true;
    fetch("./settings_schema.json")
      .then((r) => r.json())
      .then((j) => { bundledSchema = Array.isArray(j) ? j : []; ctx.render(); })
      .catch(() => { bundledSchema = []; });
  }
  return bundledSchema || [];
}

/**
 * The rules as they stand: settings.json read fresh from GitHub when we have
 * it, else the copy in the butler's ledger (which can be a round behind).
 */
function baseSettings(ctx) {
  const fromData = (ctx.data && ctx.data.settings) || {};
  return state.file ? { ...fromData, ...state.file.json } : fromData;
}

function loadFile(ctx) {
  if (!ctx.client || typeof ctx.client.settingsFile !== "function") return;
  if (state.fileLoading || Date.now() - state.fileAt < 60000) return;
  state.fileLoading = true;
  state.fileAt = Date.now();
  const client = ctx.client;
  client.settingsFile()
    .then((file) => {
      if (state.client !== client) return;
      state.file = { json: (file && file.json) || {} };
      if (document.body.dataset.route === "rules") ctx.render();
    })
    .catch(() => { /* the ledger's copy will do */ })
    .finally(() => { state.fileLoading = false; });
}

function currentValue(ctx, field) {
  if (state.draft && field.key in state.draft) return state.draft[field.key];
  const s = baseSettings(ctx);
  return field.key in s ? s[field.key] : field.default;
}

/** Routines the butler may tune, before this page's unsaved switches. */
function baseTunable(ctx) {
  if (state.file && Array.isArray(state.file.json.tunable_routines)) return new Set(state.file.json.tunable_routines);
  const routines = (ctx.data && ctx.data.routines) || [];
  // Each routine's "tunable" is worked out alongside the routine list itself,
  // so it is fresher than the settings copy (a rehearsal refreshes only routines).
  if (routines.some((r) => typeof r.tunable === "boolean")) {
    return new Set(routines.filter((r) => r.tunable).map((r) => r.id));
  }
  const s = (ctx.data && ctx.data.settings) || {};
  return new Set(Array.isArray(s.tunable_routines) ? s.tunable_routines : []);
}

function tunableSet(ctx) {
  const set = baseTunable(ctx);
  for (const id of state.off) set.delete(id);
  for (const id of state.on) set.add(id);
  return set;
}

function switchRoutine(ctx, id, next) {
  const base = baseTunable(ctx);
  state.on.delete(id);
  state.off.delete(id);
  if (next && !base.has(id)) state.on.add(id);
  if (!next && base.has(id)) state.off.add(id);
}

function isDirty() {
  return !!((state.draft && Object.keys(state.draft).length) || state.on.size || state.off.size);
}

export function renderRules(ctx) {
  if (state.client !== ctx.client) reset(ctx);
  if (!ctx.demo) loadFile(ctx);
  const schema = schemaFor(ctx);

  const page = h("div", { class: "page rules" },
    h("header", { class: "page-head" },
      h("p", { class: "eyebrow" }, "Section IV"),
      h("h1", { class: "display" }, "House rules"),
      h("p", { class: "lede" }, "How much the butler may do on his own, and how he goes about it. He reads these at the start of every round."),
    ));

  // ---- the rules themselves
  const rules = h("section", { class: "section", "aria-labelledby": "rules-h" },
    h("h2", { id: "rules-h", class: "section-label" }, "The rules"));
  if (!schema.length) rules.append(h("p", { class: "meta" }, "Fetching the rule book…"));
  for (const field of schema) rules.append(fieldRow(ctx, field));
  page.append(rules);

  // ---- routines
  page.append(routinesBlock(ctx));

  // ---- save
  page.append(saveBlock(ctx));

  // ---- the rounds
  page.append(roundsBlock(ctx));

  // ---- health
  page.append(healthBlock(ctx));

  // ---- rehearsal
  const reh = ctx.data && ctx.data.rehearsal;
  if (reh && reh.text) {
    page.append(h("section", { class: "section", "aria-labelledby": "reh-h" },
      h("h2", { id: "reh-h", class: "section-label" }, "The last rehearsal"),
      h("p", { class: "meta" }, [reh.when_et, reh.workout ? `on ${reh.workout}` : ""].filter(Boolean).join(" · ")),
      rehearsalText(reh.text)));
  }

  // ---- your key
  page.append(keyBlock(ctx));
  return page;
}

/**
 * The rehearsal as the butler wrote it, set like the Book: his marker line
 * ("🎭 Rehearsal — nothing was changed") dropped, since the heading says so,
 * runs of "- " lines as a list, and "Advice:"-style lines as list labels.
 */
export function rehearsalText(text) {
  const body = String(text || "")
    .replace(/^\s*\p{Extended_Pictographic}?\uFE0F?\s*Rehearsal\b[^\n]*\n+/iu, "")
    .replace(/^\s*REHEARSAL\b[^\n]*\n+/u, "");
  const box = h("div", { class: "rehearsal-text" });
  let list = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    if (/^[-*•]\s+/.test(line)) {
      if (!list) { list = h("ul", null); box.append(h("div", { class: "log-list" }, list)); }
      list.append(h("li", null, arrows(line.replace(/^[-*•]\s+/, ""))));
      continue;
    }
    list = null;
    if (/^[A-Z][^.!?]{0,40}:$/.test(line)) box.append(h("p", { class: "log-list-label" }, line.replace(/:$/, "")));
    else box.append(h("p", null, arrows(line)));
  }
  return box;
}

// --------------------------------------------------------------- fields --

function setDraft(ctx, key, value) {
  state.draft = { ...(state.draft || {}), [key]: value };
  state.saveNote = null;
  ctx.render();
}

/** Update the save bar in place (no re-render), so a tap on Save isn't lost. */
function syncSaveBar() {
  const dirty = isDirty();
  const bar = document.getElementById("save-bar");
  if (!bar) return;
  bar.classList.toggle("is-dirty", dirty);
  const note = document.getElementById("save-state");
  if (note && !state.saveNote) note.textContent = dirty ? "You have unsaved changes." : "Everything is as written.";
  const btn = document.getElementById("save-btn");
  if (btn) btn.disabled = !dirty || state.saving;
  const undo = document.getElementById("undo-btn");
  if (undo) undo.hidden = !dirty || state.saving;
}

/** A number typed into a rule, read without waiting for the field to lose focus. */
function commitNumber(field, input, { snapIt }) {
  if (String(input.value).trim() === "") return;
  const raw = Number(input.value);
  if (!Number.isFinite(raw)) return;
  const value = snapIt ? snap(field, raw) : raw;
  if (snapIt) input.value = String(value);
  state.draft = { ...(state.draft || {}), [field.key]: value };
  state.saveNote = null;
  const row = input.closest(".rule");
  if (row) row.classList.add("is-changed");
  if (snapIt) {
    const less = document.getElementById(`${input.id}-less`);
    const more = document.getElementById(`${input.id}-more`);
    if (less) less.disabled = field.min !== undefined && value <= Number(field.min);
    if (more) more.disabled = field.max !== undefined && value >= Number(field.max);
  }
  syncSaveBar();
}

function decimals(step) {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

function snap(field, value) {
  const step = Number(field.step) || 1;
  const min = Number.isFinite(Number(field.min)) ? Number(field.min) : -Infinity;
  const max = Number.isFinite(Number(field.max)) ? Number(field.max) : Infinity;
  let v = Number(value);
  if (!Number.isFinite(v)) v = Number(field.default) || 0;
  const base = Number.isFinite(min) ? min : 0;
  v = base + Math.round((v - base) / step) * step;
  v = Math.min(max, Math.max(min, v));
  return Number(v.toFixed(decimals(step)));
}

function fieldRow(ctx, field) {
  const id = `f-${field.key}`;
  const help = field.help && field.help !== "..." ? h("p", { class: "field-help", id: `${id}-help` }, field.help) : null;
  const value = currentValue(ctx, field);
  const changed = state.draft && field.key in state.draft;

  if (field.kind === "number") {
    const step = Number(field.step) || 1;
    const v = snap(field, value);
    const input = h("input", {
      id, type: "number", inputmode: "decimal", class: "stepper-input num",
      min: field.min, max: field.max, step, value: String(v),
      "aria-describedby": help ? `${id}-help` : undefined,
    });
    input.dataset.key = field.key;
    // Typing updates the draft at once; leaving the field tidies the number
    // in place. Neither re-renders, so a tap on Save straight after still lands.
    input.addEventListener("input", () => commitNumber(field, input, { snapIt: false }));
    input.addEventListener("change", () => commitNumber(field, input, { snapIt: true }));
    const now = () => snap(field, currentValue(ctx, field));
    const minus = h("button", {
      type: "button", class: "stepper-btn", id: `${id}-less`, "aria-label": `Less: ${field.label}`,
      disabled: field.min !== undefined && v <= Number(field.min),
      onclick: () => setDraft(ctx, field.key, snap(field, now() - step)),
    }, "−");
    const plus = h("button", {
      type: "button", class: "stepper-btn", id: `${id}-more`, "aria-label": `More: ${field.label}`,
      disabled: field.max !== undefined && v >= Number(field.max),
      onclick: () => setDraft(ctx, field.key, snap(field, now() + step)),
    }, "+");
    return h("div", { class: ["rule", changed ? "is-changed" : ""] },
      h("label", { for: id, class: "rule-label" }, field.label),
      h("div", { class: "stepper" }, minus, input, plus, field.unit ? h("span", { class: "unit" }, field.unit) : null),
      field.min !== undefined && field.max !== undefined
        ? h("p", { class: "range num" }, `${fmtNum(Number(field.min))} to ${fmtNum(Number(field.max))}${field.unit ? ` ${field.unit}` : ""}`)
        : null,
      help);
  }

  if (field.kind === "choice") {
    const choices = Array.isArray(field.choices) ? field.choices : [];
    return h("fieldset", { class: ["rule", "choice", changed ? "is-changed" : ""], "aria-describedby": help ? `${id}-help` : undefined },
      h("legend", { class: "rule-label" }, field.label),
      h("div", { class: "choices" }, choices.map((c, i) => {
        const cid = `${id}-${i}`;
        const input = h("input", { type: "radio", id: cid, name: id, value: String(c.value), checked: String(c.value) === String(value) });
        input.addEventListener("change", () => setDraft(ctx, field.key, c.value));
        return h("label", { for: cid, class: "choice-opt" }, input, h("span", null, c.label || String(c.value)));
      })),
      help);
  }

  if (field.kind === "toggle") {
    return h("div", { class: ["rule", "toggle-rule", changed ? "is-changed" : ""] },
      h("span", { class: "rule-label", id: `${id}-label` }, field.label),
      toggle(`${id}-switch`, !!value, `${id}-label`, help ? `${id}-help` : undefined, (on) => setDraft(ctx, field.key, on)),
      help);
  }
  return h("div", { class: "rule" }, h("p", { class: "meta" }, `${field.label || field.key}: this ledger doesn't know how to edit that yet.`));
}

function toggle(id, on, labelledBy, describedBy, onChange) {
  return h("button", {
    id, type: "button", role: "switch", class: ["switch", on ? "is-on" : ""],
    "aria-checked": on ? "true" : "false", "aria-labelledby": labelledBy, "aria-describedby": describedBy,
    onclick: () => onChange(!on),
  },
  h("span", { class: "switch-box", "aria-hidden": "true" }, h("span", { class: "switch-knob" })),
  h("span", { class: "switch-word", "aria-hidden": "true" }, on ? "Yes" : "No"));
}

// ------------------------------------------------------------- routines --

function routinesBlock(ctx) {
  const routines = (ctx.data && ctx.data.routines) || [];
  const set = tunableSet(ctx);
  const block = h("section", { class: "section", "aria-labelledby": "routines-h" },
    h("h2", { id: "routines-h", class: "section-label" }, "Routines he may tune"),
    h("p", { class: "field-help" },
      "Hands off by default. Switch one on and the butler may adjust it: small changes on his own, bigger ones only with your approval. He also leaves a short 🎩 note at the top of its first exercise."),
    h("p", { class: "marginal" },
      "Hevy Trainer workouts aren't routines, so they aren't listed. The butler only advises on those."));
  if (!routines.length) {
    block.append(h("p", { class: "meta" }, "No routines on record yet."));
    return block;
  }
  const list = h("ul", { class: "routine-list" });
  for (const r of routines) {
    const on = set.has(r.id);
    const lid = `r-${String(r.id).replace(/[^\w-]/g, "")}`;
    const n = (r.exercises || []).length;
    list.append(h("li", { class: ["routine", on ? "is-on" : ""] },
      h("div", { class: "routine-text" },
        h("span", { class: "routine-title", id: lid }, r.title || "Untitled routine"),
        h("span", { class: "meta" }, `${n} exercise${n === 1 ? "" : "s"}${on ? " · the butler may tune" : " · hands off"}`)),
      toggle(`${lid}-switch`, on, lid, undefined, (next) => {
        switchRoutine(ctx, r.id, next);
        state.saveNote = null;
        ctx.render();
      }),
    ));
  }
  block.append(list);
  return block;
}

// ----------------------------------------------------------------- save --

function saveBlock(ctx) {
  const dirty = isDirty();
  const btn = h("button", {
    type: "button", id: "save-btn", class: "btn btn-primary", disabled: !dirty || state.saving,
    onclick: () => save(ctx),
  }, state.saving ? "Writing it into the book…" : "Save the house rules");
  const undo = h("button", {
    type: "button", id: "undo-btn", class: "btn btn-quiet", hidden: !dirty || state.saving,
    onclick: () => { state.draft = null; state.on.clear(); state.off.clear(); state.saveNote = null; ctx.render(); },
  }, "Undo my changes");
  return h("section", { id: "save-bar", class: ["save-bar", dirty ? "is-dirty" : ""] },
    h("p", { class: "save-state", id: "save-state", role: "status" },
      state.saveNote ? state.saveNote.text : dirty ? "You have unsaved changes." : "Everything is as written."),
    h("div", { class: "actions" }, btn, undo));
}

async function save(ctx) {
  if (state.saving) return;
  // A number still being typed counts, even if its field hasn't lost focus yet.
  const active = document.activeElement;
  if (active && active.classList && active.classList.contains("stepper-input") && active.dataset.key) {
    const field = schemaFor(ctx).find((f) => f.key === active.dataset.key);
    if (field) commitNumber(field, active, { snapIt: true });
  }
  if (!isDirty()) return;
  // Only what the owner actually changed: everything else in settings.json
  // (including rules edited elsewhere since the ledger was written) is left alone.
  const changes = { ...(state.draft || {}) };
  const toggles = { on: [...state.on], off: [...state.off] };
  state.saving = true;
  ctx.render();
  try {
    const merged = await ctx.withLoading(ctx.client.saveSettings(changes, toggles));
    // Show the new rules straight away; the butler's next round confirms them.
    if (merged) {
      state.file = { json: merged };
      state.fileAt = Date.now();
    }
    if (ctx.data) {
      ctx.data.settings = { ...(ctx.data.settings || {}), ...(merged || changes) };
      const set = merged && Array.isArray(merged.tunable_routines) ? new Set(merged.tunable_routines) : null;
      for (const r of ctx.data.routines || []) {
        if (set) r.tunable = set.has(r.id);
        else if (toggles.on.includes(r.id)) r.tunable = true;
        else if (toggles.off.includes(r.id)) r.tunable = false;
      }
      if (!ctx.demo) {
        store.saveData(ctx.data);
        store.setSavedSettings({ changes, on: toggles.on, off: toggles.off });
      }
    }
    state.draft = null;
    state.on.clear();
    state.off.clear();
    state.saveNote = {
      tone: "ok",
      text: ctx.demo
        ? "Saved (in the sample household, so nothing was really sent)."
        : `Saved, ${ctx.title}. The butler follows the new rules from his next round (tap Sync to start one now).`,
    };
    ctx.slip(`The house rules are updated, ${ctx.title}.`, { ms: 3000 });
  } catch (err) {
    state.saveNote = { tone: "bad", text: `Not saved. ${explain(err, ctx.client.repo)}` };
  } finally {
    state.saving = false;
    ctx.render();
  }
}

// ------------------------------------------------------------ the rounds --

function loadRun(ctx, force) {
  if (!force && Date.now() - state.runFetchedAt < 60000) return;
  state.runFetchedAt = Date.now();
  ctx.client.latestRun()
    .then((run) => { state.run = run; state.runError = null; })
    .catch((err) => { state.runError = explain(err, ctx.client.repo); })
    .finally(() => { if (document.body.dataset.route === "rules") ctx.render(); });
}

/** The newer of two workflow runs (either may be missing). */
function newer(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const at = (r) => (toDate(r.run_started_at || r.created_at) || new Date(0)).getTime();
  return at(b) >= at(a) ? b : a;
}

function runLine(ctx) {
  if (state.runError) return h("p", { class: "notice bad" }, state.runError);
  const run = newer(state.run, ctx.round && ctx.round.run);
  if (!run) return h("p", { class: "meta" }, "Asking after the butler's whereabouts…");
  const when = toDate(run.run_started_at || run.created_at);
  if (ctx.busyRound || (run.status && run.status !== "completed")) {
    return h("p", { class: "rounds-line" }, "The butler is on his rounds right now.");
  }
  const parts = [h("p", { class: "rounds-line" },
    "The butler last made his rounds ",
    h("span", { class: "num" }, when ? ago(when) : "some time ago"),
    when ? h("span", { class: "num" }, ` (${clockET(when)} ET)`) : null, ".")];
  const ours = ctx.round && ctx.round.run && ctx.round.run.id === run.id;   // the note below says it already
  if (run.conclusion && run.conclusion !== "success" && !ours) {
    parts.push(h("p", { class: "notice warn" },
      `His last round didn't finish properly (${run.conclusion}). `,
      !ctx.demo && run.html_url ? h("a", { href: run.html_url, target: "_blank", rel: "noopener noreferrer" }, "See what happened on GitHub") : null));
  }
  return parts;
}

/** How the round started from this phone (Sync or a rehearsal) is getting on. */
function roundNote(ctx) {
  const r = ctx.round;
  if (!r) return null;
  const t = ctx.title;
  const rehearse = r.kind === "rehearse";
  const what = rehearse ? "rehearsal" : "round";
  const text = {
    sending: "Ringing for him…",
    waiting: rehearse
      ? `Summoned, ${t}. He is rehearsing on your latest workout; nothing in Hevy will change. The ledger refreshes itself when he's done.`
      : `Summoned, ${t}. He'll be along within a minute or two; the ledger refreshes itself when he's done.`,
    done: rehearse
      ? `The rehearsal is finished, ${t}. You'll find it below.`
      : `His round is finished, ${t}. The ledger is up to date.`,
    slow: `He's taking his time with this ${what}. It will finish on its own; pull down on the Ledger later to see it.${r.note ? ` ${r.note}` : ""}`,
    failed: r.run
      ? `The ${what} didn't finish properly, ${t}. ${r.note || ""}`
      : `I couldn't start the ${what}. ${r.note || ""}`,
  }[r.phase];
  const link = (r.phase === "failed" || r.phase === "slow") && !ctx.demo && r.run && r.run.html_url
    ? h("a", { href: r.run.html_url, target: "_blank", rel: "noopener noreferrer" }, "See it on GitHub") : null;
  return h("p", { class: ["notice", r.phase === "failed" ? "bad" : r.phase === "done" ? "ok" : "plain"], role: "status" },
    text, link ? " " : null, link);
}

function roundsBlock(ctx) {
  loadRun(ctx, false);
  const busy = ctx.busyRound;
  return h("section", { class: "section", "aria-labelledby": "rounds-h" },
    h("h2", { id: "rounds-h", class: "section-label" }, "The butler's rounds"),
    runLine(ctx),
    h("p", { class: "field-help" },
      "He looks in twice a day, at about 10 in the morning and 10 at night, Eastern. You needn't wait: tap ",
      h("b", null, "Sync"), " at the top of any page, or here:"),
    h("div", { class: "actions stack" },
      h("button", { type: "button", class: "btn", id: "rounds-sync", disabled: busy, onclick: () => ctx.sync() }, "Check for new workouts now"),
      h("button", { type: "button", class: "btn", id: "rounds-rehearse", disabled: busy, onclick: () => ctx.rehearse() }, "Rehearse on my latest workout")),
    h("p", { class: "field-help" }, "A rehearsal goes through your latest workout as if for real, changes nothing in Hevy, and files its notes below, marked as a rehearsal."),
    roundNote(ctx));
}

// --------------------------------------------------------------- health --

function healthBlock(ctx) {
  const hl = (ctx.data && ctx.data.health) || null;
  const block = h("section", { class: "section", "aria-labelledby": "health-h" },
    h("h2", { id: "health-h", class: "section-label" }, "Below stairs"));
  if (!hl) {
    block.append(h("p", { class: "meta" }, "No report from below stairs yet."));
    return block;
  }
  const rows = [
    ["hevy", "Hevy key works", "The Hevy key is missing or not working. Check the HEVY_API secret on GitHub."],
    ["claude", "Claude key works", "The Claude key is missing or not working. Check the claude_key secret on GitHub."],
    ["claude_ok_last_time", "Claude answered last time", "Claude didn't answer last time, so the butler kept to the plain figures."],
    ["ntfy", "Phone buzzes (ntfy) are set up", ""],
    ["email", "Email is set up", ""],
  ];
  const list = h("ul", { class: "checklist" });
  for (const [key, label, fix] of rows) {
    if (hl[key] === undefined || hl[key] === null) continue;
    // Phone buzzes and email are off by choice: the ledger is where the butler
    // reports. Show them only if someone has set them up after all.
    const optional = key === "ntfy" || key === "email";
    if (optional && !hl[key]) continue;
    const ok = !!hl[key];
    list.append(h("li", { class: ok ? "ok" : "bad" },
      h("span", { class: "tick", "aria-hidden": "true" }, ok ? "✓" : "✗"),
      h("span", { class: "check-label" }, label, h("span", { class: "visually-hidden" }, ok ? ": yes" : ": no")),
      ok ? null : h("span", { class: "check-note" }, fix)));
  }
  block.append(list);
  if (hl.last_error) {
    block.append(h("div", { class: "notice warn" },
      h("p", { class: "notice-head" }, `The last thing that went wrong${hl.last_error_et ? `, ${hl.last_error_et}` : ""}:`),
      h("p", null, String(hl.last_error))));
  }
  return block;
}

// ------------------------------------------------------------------ key --

function keyBlock(ctx) {
  if (ctx.demo) {
    return h("section", { class: "section", "aria-labelledby": "key-h" },
      h("h2", { id: "key-h", class: "section-label" }, "The sample household"),
      h("p", { class: "field-help" }, "Everything here is invented. When you're ready, connect your own ledger."),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn", onclick: () => ctx.leave() }, "Leave the sample household")));
  }
  return h("section", { class: "section", "aria-labelledby": "key-h" },
    h("h2", { id: "key-h", class: "section-label" }, "Your key"),
    h("p", { class: "field-help" }, "Connected to ", h("b", null, store.repo), ". The key is kept only in this browser."),
    h("div", { class: "actions" },
      h("button", {
        type: "button", class: "btn btn-danger",
        onclick: () => {
          if (window.confirm("Forget the GitHub key on this phone? You'll need to paste it in again to reconnect.")) ctx.leave();
        },
      }, "Forget my key")));
}
