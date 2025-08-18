// firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
  projectId: "e-loyalty-12563",
  messagingSenderId: "3887061029",
  appId: "1:3887061029:web:f9c238731d7e6dd5fb47cc"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  console.log("📥 Background message received:", payload);
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png" // Optional: your PWA icon
  });
});

// Optional: Cache fallback for offline use
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});