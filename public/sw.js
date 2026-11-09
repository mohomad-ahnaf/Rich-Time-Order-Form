const CACHE_NAME = "rsk-holdings-shell-v9";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
const PUSH_DIAGNOSTIC_URL = "/__rsk_push_diagnostics";
async function recordPushDiagnostic(stage) {
  const cache = await caches.open(CACHE_NAME);
  const previous = await cache.match(PUSH_DIAGNOSTIC_URL).then(async response => response ? await response.json().catch(() => []) : []);
  const next = [...previous.slice(-9), { stage, at: new Date().toISOString() }];
  await cache.put(PUSH_DIAGNOSTIC_URL, new Response(JSON.stringify(next), { headers: { "content-type": "application/json" } }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("rsk-holdings-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_PUSH_DIAGNOSTICS") event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    const diagnostics = await cache.match(PUSH_DIAGNOSTIC_URL).then(async response => response ? await response.json().catch(() => []) : []);
    event.ports[0]?.postMessage({ type: "RSK_PUSH_DIAGNOSTICS", diagnostics });
  }));
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    await recordPushDiagnostic("push_received");
    let data = { title: "RSK Holdings", body: "You have a new update in RSK Holdings.", url: "/", tag: "rsk-diagnostic" };
    try { if (event.data) data = { ...data, ...event.data.json() }; } catch { await recordPushDiagnostic("payload_invalid"); }
    try {
      if ("setAppBadge" in self.navigator && Number.isFinite(data.badgeCount)) await self.navigator.setAppBadge(Math.max(0, Number(data.badgeCount)));
      await self.registration.showNotification(data.title || "RSK Holdings", { body: data.body || "You have a new update in RSK Holdings.", icon: "/icon-192.png", badge: "/icon-192.png", tag: `${data.tag || "rsk"}-${Date.now()}`, data: { url: data.url || "/" } });
      await recordPushDiagnostic("showNotification_resolved");
    } catch { await recordPushDiagnostic("display_failed"); }
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
