// Service worker: makes Binge installable and quick to open.
//  • App files: served from cache instantly, refreshed in the background.
//  • Show posters: cached after the first view.
//  • Everything else (Supabase, TVmaze searches): straight to the network.
const VERSION = "binge-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "store.js", "catalog.js", "config.js", "manifest.json", "icon.svg", "icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k.startsWith("binge-")).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // stale-while-revalidate
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.hostname === "static.tvmaze.com") {
    e.respondWith(caches.open("binge-posters").then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }));
  }
});
