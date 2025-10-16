/* === OneSignal Worker for Netlify Deployment ===
   - Handles background push notifications (even if the site is closed)
   - Works with OneSignal Web SDK v16+
   - Safe to host at:  /OneSignalSDKWorker.js
*/

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Optional: simple diagnostic logging
self.addEventListener('install', (e) => {
  console.log('[OneSignal] Service worker installed.');
});

self.addEventListener('activate', (e) => {
  console.log('[OneSignal] Service worker activated.');
});

// Optional: custom fallback for offline fetch (won’t affect notifications)
self.addEventListener('fetch', (event) => {
  // You can customize caching here if needed
  // For example, ignore OneSignal API calls:
  if (event.request.url.includes('cdn.onesignal.com')) return;
});
