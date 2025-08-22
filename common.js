// ==============================
// 13e-loyalty/common.js
// Globals & helpers for loyalty app
// ==============================

// ---- Firebase Init ----
if (typeof firebase !== "undefined" && !firebase.apps.length) {
  const firebaseConfig = {
    apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
    authDomain: "e-loyalty-12563.firebaseapp.com",
    projectId: "e-loyalty-12563",
    storageBucket: "e-loyalty-12563.appspot.com",
    messagingSenderId: "3887061029",
    appId: "1:3887061029:web:f9c238731d7e6dd5fb47cc",
    measurementId: "G-966P8W06W2"
  };
  firebase.initializeApp(firebaseConfig);
}

// ---- Firebase DB ----
window.db = window.db || (firebase && firebase.firestore());

// ---- Shared Data ----
window.tierBenefits = window.tierBenefits || { Bronze: [], Silver: [], Gold: [] };
window.birthdayPerks = window.birthdayPerks || { Bronze: [], Silver: [], Gold: [] };

// ---- Role Flags ----
// Always store mode as "admin", "kafe", or "reader"
window.mode = (localStorage.getItem("mode") || "reader").trim().toLowerCase();
window.isAdmin = localStorage.getItem("isAdmin") === "true" || window.mode === "admin";
window.isKafe = window.mode === "kafe" && !window.isAdmin;
window.isReader = window.mode === "reader" && !window.isAdmin;

// ---- Helpers ----
if (typeof window.fmtRp === "undefined") {
  window.fmtRp = n => "Rp" + (Number(n) || 0).toLocaleString();
}
if (typeof window.toProperTier === "undefined") {
  window.toProperTier = t => {
    if (!t) return "Bronze";
    const s = String(t).trim().toLowerCase();
    return s === "gold" ? "Gold" : s === "silver" ? "Silver" : "Bronze";
  };
}
if (typeof window.daysDiff === "undefined") {
  window.daysDiff = (d1, d2) => {
    const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.round((a - b) / (1000 * 60 * 60 * 24));
  };
}

// ---- Mode Select Setup ----
function setupModeSelect(modeSelect) {
  if (!modeSelect) return;

  const currentMode = window.mode;
  modeSelect.value = currentMode;

  modeSelect.addEventListener("change", e => {
    const newMode = e.target.value.trim().toLowerCase();
    if (newMode === currentMode) return;

// Admin mode
if (newMode === "admin") {
  const password = prompt("🔐 Enter admin password:");
  if (password === "1234") {
    alert("✅ Admin mode enabled.");
    localStorage.setItem("isAdmin", "true");
    localStorage.setItem("isKafe", "false");
    localStorage.setItem("mode", "admin");
    location.reload();
  } else {
    alert("❌ Incorrect password. Staying in current mode.");
    modeSelect.value = currentMode;
  }
  return;
}

// Kafe mode
if (newMode === "kafe") {
  const password = prompt("🔐 Enter kafe password:");
  if (password === "kafe") {
    alert("✅ Kafe mode enabled.");
    localStorage.setItem("isAdmin", "false");
    localStorage.setItem("isKafe", "true");
    localStorage.setItem("mode", "kafe");
    location.reload();
  } else {
    alert("❌ Incorrect password. Staying in current mode.");
    modeSelect.value = currentMode;
  }
  return;
}

// Reader mode
if (newMode === "reader") {
  const password = prompt("🔐 Enter reader password:");
  if (password === "mille123") { // <-- set your own reader password here
    alert("✅ Reader mode enabled.");
    localStorage.setItem("isAdmin", "false");
    localStorage.setItem("isKafe", "false");
    localStorage.setItem("mode", "reader");
    location.reload();
  } else {
    alert("❌ Incorrect password. Staying in current mode.");
    modeSelect.value = currentMode;
  }
  return;
}
    // Reader mode (or other)
    localStorage.setItem("isAdmin", "false");
    localStorage.setItem("isKafe", "false");
    localStorage.setItem("mode", "reader");
    location.reload();
  });
}