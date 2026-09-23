/* Service worker — faster repeat loads and an offline-capable shell.
 *  - page:          network first (fresh after deploys), cached copy when offline
 *  - hashed assets: cache first (their URLs change whenever their content does)
 *  - covers/thumbs: cache first, capped; they never change for a given URL
 *  - API:           always the network (the page keeps its own snapshot)
 * The version and precache list are filled in by the server at startup.
 */
const VERSION = "__VERSION__";
const SHELL = `shell-${VERSION}`;
const IMAGES = "images-v1";
const MAX_IMAGES = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll("__PRECACHE__")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put("/", res.clone());
    return res;
  } catch (e) {
    return (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(req, cacheName, trim) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    cache.put(req, res.clone());
    if (trim) trimSoon(cache);
  }
  return res;
}

let trimming = null;
function trimSoon(cache) {
  if (trimming) return;
  trimming = setTimeout(async () => {
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(k);
    trimming = null;
  }, 10000);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") return e.respondWith(networkFirst(req));
  if (url.pathname.startsWith("/covers/") || url.pathname === "/img") return e.respondWith(cacheFirst(req, IMAGES, true));
  if (url.searchParams.has("v")) return e.respondWith(cacheFirst(req, SHELL, false));
});
