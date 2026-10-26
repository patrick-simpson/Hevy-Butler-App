// Reads the machine-readable plan at the end of a proposal issue:
// <!-- BUTLER-PLAN {"version": 1, "workout": "...", "message": "...", "items": [{"desc", "reason"}], ...} -->
// The JSON never contains a literal ">", so the block ends at the first "-->".

const BLOCK = /<!--\s*BUTLER-PLAN\s+([\s\S]*?)-->/;

/** The marker the butler adds to every reply he has finished with. */
export const HANDLED = "<!-- BUTLER-HANDLED -->";

export function parsePlan(body) {
  const text = String(body || "");
  const m = text.match(BLOCK);
  const prose = text.replace(BLOCK, "").trim();
  if (!m) return { plan: null, prose };
  try {
    const plan = JSON.parse(m[1].trim());
    if (!plan || typeof plan !== "object") return { plan: null, prose };
    const items = Array.isArray(plan.items)
      ? plan.items.filter((i) => i && typeof i === "object").map((i) => ({
        desc: String(i.desc ?? ""),
        reason: String(i.reason ?? ""),
      }))
      : [];
    return {
      plan: {
        ...plan,
        items,
        workout: plan.workout ? String(plan.workout) : "",
        message: typeof plan.message === "string" ? cleanText(plan.message) : "",
      },
      prose,
    };
  } catch (_) {
    return { plan: null, prose };
  }
}

/**
 * Text from GitHub, made fit to read: drops hidden HTML comments (such as the
 * butler's "handled" marker) and Markdown emphasis (** __ `). Lone * and _ stay,
 * because exercise names and "3 x 10" notation can carry them.
 */
export function cleanText(text) {
  return String(text ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// "Sir,", "Your Grace," or "...Patrick.": a greeting on its own, not the message.
const GREETING = /^(\.\.\.|…)?[A-Za-z][A-Za-z ]{0,20}[,.]$/;

/** First real paragraph of the issue body (greetings and headings skipped), as plain text. */
export function firstParagraph(prose) {
  const paras = String(prose || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 1 && GREETING.test(paras[0]) && paras[0].split(/\s+/).length <= 3) paras.shift();
  const para = paras.find((p) => !p.startsWith("#"));
  if (!para) return "";
  return cleanText(para).replace(/[*_>#]/g, "").replace(/\s+/g, " ").trim();
}
