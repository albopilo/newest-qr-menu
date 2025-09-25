// sw.js
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// 🔑 Initialize Firebase in service worker
firebase.initializeApp({
  apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
  authDomain: "e-loyalty-12563.firebaseapp.com",
  projectId: "e-loyalty-12563",
  storageBucket: "e-loyalty-12563.appspot.com",
  messagingSenderId: "3887061029",
  appId: "1:3887061029:web:f9c238731d7e6dd5fb47cc",
  measurementId: "G-966P8W06W2"
});

const messaging = firebase.messaging();

// ✅ Background notifications handler
messaging.onBackgroundMessage((payload) => {
  console.log("[sw.js] Received background message ", payload);

  const notificationTitle = payload.notification?.title || "📢 New Update";
  const notificationOptions = {
    body: payload.notification?.body || "You have a new message",
    icon: "/assets/icon-192.png",   // ✅ matches manifest.json
    badge: "/assets/icon-192.png",  // ✅ small badge icon for Android
    data: payload.data || {}        // pass data to handle clicks
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ✅ Handle notification click (opens staff.html)
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow("/staff.html")
  );
});
