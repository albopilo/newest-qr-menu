// OneSignalSDKWorker.js (root)
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

// NOTE:
// OneSignal's service worker will handle displaying notifications when push arrives.
// We do not attempt to play audio from here because browsers block audio playback
// from service workers without a visible client. Instead we ensure the notification
// includes data and a click action to open staff.html.
// When the user opens staff.html, the page will start the repeating chime.
