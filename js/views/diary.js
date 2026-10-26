// THE BUTLER'S PRIVATE DIARY. You were not supposed to find this.

import { h } from "../dom.js";
import { diaryIntro } from "../eggs.js";

export function renderDiary(ctx) {
  const title = ctx.title;
  const entries = Array.isArray(ctx.data && ctx.data.diary) ? ctx.data.diary.slice().reverse() : [];
  const [gasp, sigh] = diaryIntro(title);

  const page = h("div", { class: "page diary" },
    h("header", { class: "diary-head" },
      h("p", { class: "diary-private" }, "Private. Strictly."),
      h("h1", { class: "diary-title" }, "The Diary of the Deadlift Butler"),
      h("p", { class: "diary-gasp" }, gasp),
      h("p", { class: "diary-sigh" }, sigh),
    ),
  );

  const paper = h("div", { class: "diary-paper" });
  if (!entries.length) {
    paper.append(h("p", { class: "diary-entry" }, "The pages are blank. I keep my feelings where they belong: under the stairs, with the spare light bulbs."));
  }
  for (const e of entries) {
    paper.append(h("article", { class: "diary-entry" },
      h("p", { class: "diary-date" },
        e.day !== undefined && e.day !== null && !/^day\s*\d/i.test(String(e.text || "")) ? h("span", { class: "diary-day" }, `Day ${e.day}`) : null,
        e.when_et ? h("span", { class: "diary-when" }, e.when_et) : null),
      h("p", { class: "diary-text" }, e.text || ""),
    ));
  }
  page.append(paper,
    h("div", { class: "actions diary-actions" },
      h("button", { type: "button", class: "btn", onclick: () => ctx.navigate("ledger") },
        "Close the diary and pretend this never happened")));
  return page;
}
