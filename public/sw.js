const CACHE_VERSION = "time-goalie-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL = [
  "/",
  "/index.html",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

async function deleteOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);

  const title = payload.title || "Time Goalie";
  const options = {
    body: payload.body || "时间到了，回到当前计划。",
    tag: payload.tag || "time-goalie-reminder",
    icon: "/icon-192.png",
    badge: "/favicon.svg",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

function readPushPayload(event) {
  try {
    return event.data?.json() || {};
  } catch {
    return { title: "Time Goalie", body: event.data?.text() || "新的提醒" };
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      const visibleClient = clientsList.find((client) => "focus" in client);
      if (visibleClient) {
        visibleClient.navigate(targetUrl);
        return visibleClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
