// Safe element builders. Everything that comes from GitHub, Hevy or the
// butler goes into the page as text (textContent), never as HTML.

const SVG_NS = "http://www.w3.org/2000/svg";

function applyAttrs(el, attrs, isSvg) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "text") {
      el.textContent = String(value);
    } else if (key === "class") {
      el.setAttribute("class", Array.isArray(value) ? value.filter(Boolean).join(" ") : value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "href" && !isSvg) {
      el.setAttribute("href", safeHref(value));
    } else if (key === "dataset") {
      for (const [k, v] of Object.entries(value)) el.dataset[k] = String(v);
    } else if (key === "style") {
      throw new Error("Inline style strings are not allowed (CSP). Use classes.");
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** h("p", {class: "x"}, "some text", h("em", null, "more")) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs, false);
  append(el, children);
  return el;
}

/** Same as h() but for SVG elements. */
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs, true);
  append(el, children);
  return el;
}

/** Only allow http(s), relative and hash links. Anything else becomes "#". */
export function safeHref(value) {
  const v = String(value || "");
  if (v.startsWith("#") || v.startsWith("./")) return v;
  try {
    const u = new URL(v, location.href);
    if (u.protocol === "https:" || u.protocol === "http:") return u.href;
  } catch (_) { /* fall through */ }
  return "#";
}

/** "160 lb -> 165 lb" reads better as "160 lb → 165 lb". Text in, text out. */
export function arrows(text) {
  return String(text ?? "").replace(/\s-{1,2}>\s/g, " → ");
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function buzz(pattern) {
  try {
    if (navigator.vibrate && !prefersReducedMotion()) navigator.vibrate(pattern);
  } catch (_) { /* some browsers throw without a user gesture */ }
}
