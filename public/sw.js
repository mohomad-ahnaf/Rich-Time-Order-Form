const CACHE_NAME = "rsk-holdings-shell-v15";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/favicon-48.png", "/rsk-holdings-wordmark.png", "/rsk-brand-background.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("rsk-holdings-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = { title: "RSK Holdings", body: "You have a new update in RSK Holdings.", url: "/", tag: "rsk-notification", badgeCount: 0 };
    try { if (event.data) data = { ...data, ...event.data.json() }; }
    catch { console.warn("push display: payload_invalid"); }
    try {
      if ("setAppBadge" in self.navigator && Number.isFinite(data.badgeCount)) await self.navigator.setAppBadge(Math.max(0, Number(data.badgeCount)));
      await self.registration.showNotification(data.title || "RSK Holdings", { body: data.body || "You have a new update in RSK Holdings.", icon: "/icon-192.png", badge: "/icon-192.png", tag: data.tag || "rsk-notification", data: { url: data.url || "/" } });
      console.info("push display: shown");
    } catch (error) {
      console.warn(`push display: failed ${(error && error.name) || "Error"}`);
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => { const existing = windows.find((client) => client.url.startsWith(self.location.origin)); if (existing) return existing.focus(); return clients.openWindow(url); }));
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
