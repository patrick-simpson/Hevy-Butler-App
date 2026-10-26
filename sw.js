// The Butler's Ledger service worker: keeps a copy of the app for when there's no signal.
// - Every file of ours: fetched fresh from the network first (checked with GitHub
//   Pages, so an unchanged file costs almost nothing), so the page, its styles and
//   its code always come from the same release. The saved copy is used only when
//   offline or after ~3.5 s of poor signal.
// - Google Fonts: a separate cache. GitHub's API: NEVER cached.
//
// RELEASE: run `python3 tools/bump_version.py` (it bumps the edition here, in
// index.html, js/app.js and styles.css together; js/boot.js checks they match).

const VERSION = "ledger-v6";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./settings_schema.json",
  "./demo-data.json",
  "./js/boot.js?b=ledger-v6",
  "./js/app.js",
  "./js/dom.js",
  "./js/time.js",
  "./js/store.js",
  "./js/github.js",
  "./js/demo.js",
  "./js/plan.js",
  "./js/charts.js",
  "./js/eggs.js",
  "./js/ask.js",
  "./js/accounts.js",
  "./js/views/welcome.js",
  "./js/views/ledger.js",
  "./js/views/awaiting.js",
  "./js/views/ask.js",
  "./js/views/report.js",
  "./js/views/accounts.js",
  "./js/views/book.js",
  "./js/views/rules.js",
  "./js/views/diary.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
];
const FONTS = "ledger-fonts-v1";

self.addEventListener("install", (event) => {
  // cache: "reload" skips the browser's HTTP cache (GitHub Pages allows 10 minutes),
  // so a new version never installs yesterday's files.
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // GitHub (the private repo, proposals, workflow runs): always straight to the network.
  if (url.hostname === "api.github.com") return;

  // Fonts: cache after first use.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Page loads (the app routes by #hash, so it's always index.html) and every
  // other file of ours: the network first, the saved copy as a fallback.
  event.respondWith(networkFirst(event, req.mode === "navigate" ? "./index.html" : req.url));
});

// Set when a page load had to use the saved page: the rest of that page then comes
// from the same saved copy at once (same edition, no 3.5 s wait per file).
let savedUntil = 0;

async function networkFirst(event, key) {
  const cache = await caches.open(VERSION);
  const page = key === "./index.html";
  if (!page && Date.now() < savedUntil) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  // "no-cache" asks GitHub Pages whether the file changed, instead of trusting the
  // phone's own 10-minute copy, so a release is never half old, half new.
  const network = fetch(key, { cache: "no-cache" }).then((res) => {
    if (res.ok) {
      const put = cache.put(key, res.clone());
      try { event.waitUntil(put); } catch (_) { /* already answered from the saved copy */ }
    }
    return res;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, 3500, null));
  try {
    const res = await Promise.race([network, slow]);
    if (res && res.ok) { if (page) savedUntil = 0; return res; }
  } catch (_) { /* offline: the saved copy below */ }
  const hit = await cache.match(key);
  if (hit) { if (page) savedUntil = Date.now() + 20000; return hit; }
  return network.catch(() => Response.error());
}
