const SERVICE_WORKER_VERSION = "satori-install-shell-v155";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Keep the PWA install contract without caching source files.
  event.respondWith(fetch(event.request));
});
