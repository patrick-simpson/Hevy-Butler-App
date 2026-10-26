// The Butler's Ledger service worker.
// - The page itself (index.html): network first, so a new release arrives at
//   once; the cached copy is used when offline or after ~3 s of poor signal.
// - The app's other files: answered from the cache at once, with a fresh copy
//   fetched quietly for next time.
// - Google Fonts: a separate cache. GitHub's API: NEVER cached.
//
// BUMP VERSION WITH EVERY RELEASE. A changed sw.js is what makes installed
// phones fetch every file of the new release together (no mixed versions).

const VERSION = "ledger-v3";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./settings_schema.json",
  "./demo-data.json",
  "./js/app.js",
  "./js/dom.js",
  "./js/time.js",
  "./js/store.js",
  "./js/github.js",
  "./js/demo.js",
  "./js/plan.js",
  "./js/charts.js",
  "./js/eggs.js",
  "./js/views/welcome.js",
  "./js/views/ledger.js",
  "./js/views/awaiting.js",
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

  // Page loads: the network first (the app routes by #hash, so it's always
  // index.html), falling back to the cached copy when offline or slow.
  if (req.mode === "navigate") {
    event.respondWith(pageFirst(event));
    return;
  }

  // Everything else of ours: answer from the cache at once, and quietly fetch a
  // fresh copy for next time (so a new version arrives without anyone bumping anything).
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) {
        event.waitUntil(fresh);
        return hit;
      }
      return (await fresh) || Response.error();
    }),
  );
});

async function pageFirst(event) {
  const cache = await caches.open(VERSION);
  const network = fetch("./index.html", { cache: "no-cache" }).then((res) => {
    if (res.ok) {
      const put = cache.put("./index.html", res.clone());
      try { event.waitUntil(put); } catch (_) { /* the page was already answered from the cache */ }
    }
    return res;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, 3000, null));
  try {
    const res = await Promise.race([network, slow]);
    if (res && res.ok) return res;
  } catch (_) { /* offline: the cached copy below */ }
  const hit = await cache.match("./index.html");
  if (hit) return hit;
  return network.catch(() => Response.error());
}

