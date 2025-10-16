// pwa-worker.js
const CACHE_NAME = "staff-pwa-v1";
const OFFLINE_URL = "/staff.html";
const ASSETS_TO_CACHE = [
  "/staff.html",
  "/manifest.json",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/app.js"
];

// Install
self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Activate
self.addEventListener("activate", (evt) => {
  evt.waitUntil(self.clients.claim());
});

// Fetch: serve cached first
self.addEventListener("fetch", (evt) => {
  if (evt.request.url.includes("https://cdn.onesignal.com/")) return; // let OneSignal handle itself
  evt.respondWith(caches.match(evt.request).then(r => r || fetch(evt.request)));
});


// Listen for messages (from page)
self.addEventListener("message", (event) => {
  // placeholder for potential communication
  console.log("SW message:", event.data);
});

// When notificationclick occurs (fallback click handling)
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || "/staff.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      // If staff.html is open, focus it; otherwise open a new window
      for (let client of windowClients) {
        if (client.url.includes("/staff.html") && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
