const CACHE_NAME = "rsk-holdings-shell-v5";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("rsk-holdings-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }
  if (!["script", "style", "image", "font"].includes(request.destination)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && !url.pathname.endsWith(".pdf")) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
