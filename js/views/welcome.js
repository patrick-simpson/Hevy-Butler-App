// First open: the butler introduces himself, offers a look around or a proper connection.

import { h } from "../dom.js";
import { DEFAULT_REPO, store } from "../store.js";
import { liveClient } from "../github.js";

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export function renderWelcome(ctx, startLive, startDemo) {
  const keyInput = h("input", {
    id: "token", name: "token", type: "password", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", inputmode: "text", class: "field-input", placeholder: "github_pat_…",
    required: true,
  });
  const repoInput = h("input", {
    id: "repo", name: "repo", type: "text", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", class: "field-input", value: store.repo || DEFAULT_REPO, required: true,
  });
  const results = h("div", { class: "verify", "aria-live": "polite" });
  const connectBtn = h("button", { type: "submit", class: "btn btn-primary" }, "Connect");

  const form = h("form", { class: "connect-form", novalidate: true },
    h("div", { class: "field" },
      h("label", { for: "token", class: "field-label" }, "Your GitHub key"),
      keyInput,
      h("p", { class: "field-help" }, "A fine-grained personal access token. It stays on this phone only."),
    ),
    h("div", { class: "field" },
      h("label", { for: "repo", class: "field-label" }, "The butler's repository"),
      repoInput,
      h("p", { class: "field-help" }, "Owner and name, like patrick-simpson/Hevy-Butler."),
    ),
    h("div", { class: "actions" }, connectBtn),
    results,
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = keyInput.value.trim();
    const repo = repoInput.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
    results.replaceChildren();
    if (!token) {
      results.append(h("p", { class: "verify-note bad" }, "Please paste your GitHub key first."));
      keyInput.focus();
      return;
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      results.append(h("p", { class: "verify-note bad" }, "The repository should look like owner/name, for example patrick-simpson/Hevy-Butler."));
      repoInput.focus();
      return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = "Checking the key…";
    const client = liveClient(token, repo);
    let report;
    try {
      report = await ctx.withLoading(client.verify());
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
    }
    const list = h("ul", { class: "checklist" });
    for (const c of report.checks) {
      list.append(h("li", { class: c.ok ? "ok" : "bad" },
        h("span", { class: "tick", "aria-hidden": "true" }, c.ok ? "✓" : "✗"),
        h("span", { class: "check-label" }, c.label, h("span", { class: "visually-hidden" }, c.ok ? " — works" : " — not working")),
        c.note ? h("span", { class: "check-note" }, c.note) : null,
      ));
    }
    results.append(list);
    if (report.fatal) {
      results.append(h("p", { class: "verify-note bad" },
        "I can't open the ledger with this key yet. Fix the item marked ✗ above, then press Connect again."));
      return;
    }
    if (!report.ok) {
      results.append(
        h("p", { class: "verify-note warn" }, "I can read the ledger, but some buttons won't work until the key has the permission marked ✗. You can fix that later."),
        h("div", { class: "actions" },
          h("button", { type: "button", class: "btn", onclick: () => startLive(token, repo, report.branch) }, "Open the ledger anyway")),
      );
      return;
    }
    results.append(h("p", { class: "verify-note ok" }, "Splendid. Everything is in order. Opening the ledger…"));
    setTimeout(() => startLive(token, repo, report.branch), 900);
  });

  const steps = h("ol", { class: "steps" },
    h("li", null, "Open ", h("a", { href: TOKEN_URL, target: "_blank", rel: "noopener noreferrer" }, "GitHub's new-token page"), " (you may need to sign in)."),
    h("li", null, "Name it ", h("q", null, "Butler's Ledger"), ". Pick an expiry date you're happy with."),
    h("li", null, "Under ", h("b", null, "Repository access"), ", choose ", h("b", null, "Only select repositories"), " and pick ", h("b", null, "Hevy-Butler"), "."),
    h("li", null, "Under ", h("b", null, "Permissions"), ", set ", h("b", null, "Contents"), ", ", h("b", null, "Issues"), " and ", h("b", null, "Actions"), " to ", h("b", null, "Read and write"), ". (Metadata: Read is added for you.)"),
    h("li", null, "Press ", h("b", null, "Generate token"), ", copy it, and paste it above."),
  );

  return h("div", { class: "page welcome" },
    h("header", { class: "welcome-head" },
      h("p", { class: "eyebrow" }, "The Deadlift Butler · at your service"),
      h("h1", { class: "display" }, "Good day, Sir."),
      h("p", { class: "lede" },
        "I look in on your Hevy workouts twice a day, at about 10 in the morning and 10 at night, Eastern, and whenever you tap Sync. I write down how each lift is coming along, suggest what to do next, and wait for your word on anything bold. This ledger is where you read it all."),
    ),

    h("section", { class: "entry choice", "aria-labelledby": "choice-demo" },
      h("div", { class: "margin" }, h("span", { class: "numeral" }, "I.")),
      h("div", { class: "body" },
        h("h2", { id: "choice-demo", class: "h2" }, "Have a look around first"),
        h("p", null, "A sample household with invented figures. Press anything you like; nothing leaves the phone."),
        h("div", { class: "actions" },
          h("button", { type: "button", class: "btn", onclick: startDemo }, "Show me the sample ledger")),
      ),
    ),

    h("section", { class: "entry choice", "aria-labelledby": "choice-connect" },
      h("div", { class: "margin" }, h("span", { class: "numeral" }, "II.")),
      h("div", { class: "body" },
        h("h2", { id: "choice-connect", class: "h2" }, "Connect your own ledger"),
        h("p", null, "The ledger reads the butler's notes from your private GitHub repository. It needs a key for that one repository."),
        form,
        h("details", { class: "howto" },
          h("summary", null, "How to make the key (two minutes)"),
          steps,
        ),
      ),
    ),

    h("p", { class: "fineprint" },
      "Your key is kept in this phone's browser storage and sent only to GitHub. You can make the ledger forget it at any time under House Rules."),
  );
}
