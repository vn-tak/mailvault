/*
 * MailVault service worker: offline shell + new-mail notifications.
 *
 * Nothing under /api/ is ever cached — an inbox left in the browser cache would be a
 * second, unaccessed copy of private mail. Navigations are network-first and fall back
 * to the cached shell only when offline.
 */
const CACHE = "mailvault-shell-v1";
const SHELL_URLS = ["/", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheLater(request, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // no-store: a deploy must reach an installed client on the next open. Without it the
    // HTTP cache can answer with the previous index.html, which points at the previous
    // hashed bundle — i.e. the app silently runs an old UI. Offline still falls back.
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          void cacheLater(request, response);
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        void cacheLater(request, response);
        return response;
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  // The server deliberately sends no payload: subject, sender and OTP stay behind the
  // Access gate. All the device may learn is that something arrived.
  event.waitUntil(
    self.registration.showNotification("MailVault", {
      body: "New mail arrived",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "mailvault-new-mail",
      data: { url: "/#/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("navigate" in client) {
          void client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
