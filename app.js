// ==============================
// 13e-loyalty/app.js (Optimized, complete)
// ==============================

// -------- 🔥 FIREBASE CONFIG --------
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
const db = firebase.firestore();

// -------- 🌏 GLOBAL STATE --------
let mode = localStorage.getItem("mode") || "reader"; // UI hint only
let isAdminHint = localStorage.getItem("isAdmin") === "true"; // UI hint only

const settingsRef = db.collection("settings").doc("tierThresholds");
let tierSettings = {};
let cashbackSettings = {
  silverCashbackRate: 5,
  goldCashbackRate: 5,
  birthdayGoldCashbackRate: 30,
  silverDailyCashbackCap: 15000,
  goldDailyCashbackCap: 30000
};

// -------- 💾 SAVE MEMBER (GLOBAL, SAFE) --------
async function saveMember(member) {
  return db.collection("members")
    .doc(member.id)
    .set(member, { merge: true });
}


// Server-side pagination state
let currentPage = 1;
let pageSize = Number(localStorage.getItem("memberPageSize")) || 20; // 5, 10, 20
let pageCursors = []; // pageCursors[page] = lastDoc of that page
let currentPageData = [];
let hasNextPage = false;

// Lightweight caches
const roleCache = { uid: null, isAdmin: false, isPublic: false, ts: 0 };
const DASHBOARD_CACHE_TTL = 60_000; // 60s
let dashboardMembersCache = [];
let dashboardCacheTs = 0;

// -------- 🛡️ ROLE HELPERS (cached) --------
async function refreshRoleCache() {
  const user = firebase.auth().currentUser;
  if (!user) {
    roleCache.uid = null;
    roleCache.isAdmin = false;
    roleCache.isPublic = false;
    roleCache.ts = Date.now();
    return;
  }
  if (roleCache.uid === user.uid && Date.now() - roleCache.ts < 10_000) return;

  const [adm, pub] = await Promise.all([
    db.collection("admins").doc(user.uid).get(),
    db.collection("public_users").doc(user.uid).get()
  ]);

  roleCache.uid = user.uid;
  roleCache.isAdmin = adm.exists;
  roleCache.isPublic = pub.exists;
  roleCache.ts = Date.now();
}

async function ensureAdmin() {
  await refreshRoleCache();
  return !!roleCache.isAdmin;
}
async function ensurePublic() {
  await refreshRoleCache();
  return !!roleCache.isPublic;
}
async function getCurrentRole() {
  await refreshRoleCache();
  if (!roleCache.uid) return "reader";
  if (roleCache.isAdmin) return "admin";
  if (roleCache.isPublic) return "public";
  return "reader";
}

// -------- ⏳ AUTH READINESS --------
const authReady = new Promise((resolve) => {
  const unsub = firebase.auth().onAuthStateChanged(() => {
    unsub();
    resolve();
  });
});

// -------- 🧰 UTILITIES --------
function fmtRp(n) {
  return "Rp" + (Number(n) || 0).toLocaleString("id-ID");
}
function toProperTier(t) {
  if (!t) return "Bronze";
  const s = String(t).trim().toLowerCase();
  if (s === "gold") return "Gold";
  if (s === "silver") return "Silver";
  return "Bronze";
}
function isSameDay(d1, d2) {
  if (!d1 || !d2) return false;
  const a = new Date(d1), b = new Date(d2);
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}
function daysDiff(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  d1.setHours(0,0,0,0); d2.setHours(0,0,0,0);
  return Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
}
function localYMD(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}
function localMD(d) {
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

// -------- 🧾 OCR TEXT UTILS --------
function extractTotalAmount(ocrText) {
  const lines = (ocrText || "").split("\n").map(l => l.trim()).filter(Boolean);

  // Prefer labeled totals
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].toLowerCase().replace(/[^a-z ]/g, "").trim();
    if (/s?g?rand[ \-]?total/.test(label) || /total\s*bayar/.test(label) || /amount\s*due/.test(label)) {
      const scanLines = [lines[i], lines[i + 1]];
      for (const line of scanLines) {
        if (!line) continue;
        const matches = line.match(/[\d.,]+/g);
        if (matches) {
          for (const str of matches) {
            const num = parseInt(str.replace(/[^\d]/g, ""), 10);
            if (!isNaN(num) && num >= 1000 && num <= 20000000) return num;
          }
        }
      }
    }
  }

  // Fallback: largest plausible numeric value
  const fallback = [];
  for (const line of lines) {
    const matches = line.match(/[\d.,]+/g);
    if (matches) {
      matches.forEach(str => {
        const num = parseInt(str.replace(/[^\d]/g, ""), 10);
        if (!isNaN(num) && num >= 1000 && num <= 20000000) fallback.push(num);
      });
    }
  }
  return fallback.length > 0 ? Math.max(...fallback) : null;
}

// -------- 🐢 LAZY LIBS (Tesseract) --------
let tesseractWorker = null;
let tesseractLoading = null;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

function tierRank(tier) {
  return { Bronze: 1, Silver: 2, Gold: 3 }[toProperTier(tier)] || 0;
}

function calculateTierAfterTransaction(member, yearlySpend, monthlySpend) {
  const current = toProperTier(member.tier);
  let next = current;

  const T = tierSettings;

  if (!T) return current;

  // Bronze → Silver
  if (
    current === "Bronze" &&
    (yearlySpend >= T.bronzeToSilverYear ||
     monthlySpend >= T.bronzeToSilverMonth)
  ) {
    next = "Silver";
  }

  // Silver → Gold
  if (
    current === "Silver" &&
    (yearlySpend >= T.silverToGoldYear ||
     monthlySpend >= T.silverToGoldMonth)
  ) {
    next = "Gold";
  }

  // 🔒 Safety: never downgrade
  return tierRank(next) > tierRank(current) ? next : current;
}


async function ensureTesseractReady() {
  if (tesseractWorker) return tesseractWorker;
  if (tesseractLoading) return tesseractLoading;

  tesseractLoading = (async () => {
    if (!window.Tesseract) {
      // Load only when needed
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/tesseract.min.js");
    }
    const worker = await Tesseract.createWorker({ logger: () => {} });
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    tesseractWorker = worker;
    return worker;
  })();

  return tesseractLoading;
}

async function disposeTesseract() {
  if (tesseractWorker) {
    try { await tesseractWorker.terminate(); } catch {}
    tesseractWorker = null;
    tesseractLoading = null;
  }
}

// -------- 🎁 PERKS & BENEFITS --------
const tierBenefits = {
  Bronze: [
    "- 10% off at 13e Café",
    "- 5% off Honda motorbike service (excl. spare parts)"
  ],
  Silver: [
    "- 15% off at 13e Café",
    "- 10% off Honda service + 5% off at Millennium",
    "- 5% cashback (Rp15k/day cap)"
  ],
  Gold: [
    "- 20% off at 13e Café",
    "- 15% off Honda service + 10% off at Millennium",
    "- 🏨 Free room upgrade (every 6 months)",
    "- 💰 5% cashback (Rp30k/day cap) + new unit voucher"
  ]
};
const birthdayPerks = {
  Bronze: ["🎂 Birthday Treat:", "- Free drink/snack + 30% off Honda service"],
  Silver: ["🎂 Birthday Treat:", "- Free drink and snack", "- 50% off at Millennium", "- 30% off Honda service"],
  Gold: ["🎂 VIP Birthday Package:", "- 🏨 Free Deluxe room for one night", "- 🍽️ Free Food+drink+snack combo", "- 💰 30% cashback (Rp30k/day cap)", "- 🍽️ Free VIP lounge access at 13e Café", "- 🎁 Optional Free birthday gift delivered to home"]
};

// -------- ✉️ EMAIL HELPERS --------
function sendEmailNotification(templateId, data) {
  if (!window.emailjs || !emailjs.send) {
    console.warn("EmailJS not available — skipping email send.");
    return Promise.resolve();
  }
  return emailjs
    .send("service_dhmya66", templateId, data)
    .then(() => console.log("✅ Email sent"))
    .catch(err => console.error("❌ Email send failed:", err));
}

function getSubjectForType(type, member) {
  switch (type) {
    case "birthday": return `Celebrate in Style: Your Exclusive 13e Birthday Rewards`;
    case "upgrade": return `🚀 Congrats, ${member.name}! Welcome to ${member.tier} Status`;
    case "cashback_expire": return `⏳ Don’t Let Your Cashback Expire – Redeem Now, ${member.name}!`;
    case "transaction_summary": return `🧾 Your Transaction Has Been Recorded – Cashback Updated!`;
    case "welcome": return `☕ Welcome to 13e Café Rewards, ${member.name}!`;
    default: return `Hello from 13e Café ☕`;
  }
}

function getMessagePayload(type, member, meta = {}) {
  const safeTier = toProperTier(member.tier);
  switch (type) {
    case "birthday": {
      const b = birthdayPerks[safeTier] || [];
      return {
        main_message:
`🎉 We’re thrilled to celebrate you, {{member_name}}!
As a cherished {{member_tier}} member, you can now redeem your exclusive birthday rewards designed to make your day just a little more magical.`,
        benefit_1: b[0] || "", benefit_2: b[1] || "", benefit_3: b[2] || "",
        benefit_4: b[3] || "", benefit_5: b[4] || "", benefit_6: b[5] || "", benefit_7: b[6] || ""
      };
    }
    case "upgrade": {
      const perks = tierBenefits[safeTier] || [];
      const bday = birthdayPerks[safeTier] || [];
      return {
        main_message: `🚀 Congrats, ${member.name}! You've just leveled up to ${safeTier} tier at 13e Café.`,
        benefit_1: `🌟 Daily Perks:`,
        benefit_2: perks[0] || "", benefit_3: perks[1] || "", benefit_4: perks[2] || "", benefit_5: perks[3] || "",
        benefit_6: `🎂 Birthday Perks:`,
        benefit_7: bday[0] || "", benefit_8: bday[1] || "", benefit_9: bday[2] || "",
        benefit_10: bday[3] || "", benefit_11: bday[4] || "", benefit_12: bday[5] || ""
      };
    }
    case "transaction_summary": {
      const { lastTransaction, cashbackPoints, member: metaMember } = meta || {};
      const txDate = lastTransaction?.date ? new Date(lastTransaction.date).toLocaleString() : "(unknown date)";
      const m = metaMember || member;
      return {
        main_message: `🧾 A new transaction has been added to your 13e Café account.`,
        benefit_1: `• Transaction Date: ${txDate}`,
        benefit_2: `• Amount Spent: ${fmtRp(lastTransaction?.amount)}`,
        benefit_5: cashbackPoints > 0 ? `• Cashback Earned: ${fmtRp(cashbackPoints)}` : "• Cashback Earned: –",
        benefit_6: `• Available Cashback Points: ${fmtRp(m?.redeemablePoints ?? 0)}`
      };
    }
    case "cashback_expire":
      return { main_message: `⚠️ Reminder: Your cashback points are expiring soon!`, benefit_1: "Visit the café to redeem them before the deadline." };
    default:
      return { main_message: `Hello from 13e Café ☕` };
  }
}

// -------- ⚙️ SETTINGS LOADERS --------
async function loadCashbackSettings() {
  try {
    const doc = await db.collection("settings").doc("cashbackRates").get();
    if (!doc.exists) return;
    const d = doc.data() || {};
    cashbackSettings = {
      silverCashbackRate: Number(d.silverCashbackRate ?? 5),
      goldCashbackRate: Number(d.goldCashbackRate ?? 5),
      birthdayGoldCashbackRate: Number(d.birthdayGoldCashbackRate ?? 30),
      silverDailyCashbackCap: Number(d.silverDailyCashbackCap ?? 15000),
      goldDailyCashbackCap: Number(d.goldDailyCashbackCap ?? 30000)
    };
    console.log("✅ Cashback settings loaded:", cashbackSettings);
  } catch (err) {
    console.error("⚠️ Failed to load cashback settings:", err);
  }
}
async function loadTierSettingsFromCloud() {
  try {
    const doc = await settingsRef.get();
    if (!doc.exists) return;
    tierSettings = doc.data() || {};
    console.log("✅ Tier settings loaded:", tierSettings);
  } catch (err) {
    console.error("⚠️ Failed to load tier settings:", err);
  }
}

// -------- 👥 AUTH STATE HANDLER --------
firebase.auth().onAuthStateChanged(async (user) => {
  const sel = document.getElementById("modeSelect");
  const chosen = localStorage.getItem("mode") || "reader";

  let effectiveMode = "reader";
  if (user) {
    await refreshRoleCache();
    const isAdm = roleCache.isAdmin;
    const isPub = roleCache.isPublic;
    if (chosen === "admin" && isAdm) effectiveMode = "admin";
    else if (chosen === "public" && (isAdm || isPub)) effectiveMode = "public";
    else if (isAdm) effectiveMode = "admin";
    else if (isPub) effectiveMode = "public";
  }
  if (sel) sel.value = effectiveMode;

  const show = (el, visible) => { if (el) el.style.display = visible ? "inline-block" : "none"; };
  const isAdminRole = !!(user && roleCache.isAdmin);
  show(document.getElementById("backupDbBtn"), isAdminRole);
  show(document.getElementById("restoreDbBtn"), isAdminRole);
  show(document.getElementById("saveSettingsBtn"), isAdminRole);
  show(document.getElementById("sendAllWelcomeBtn"), isAdminRole);

  // Defer settings load so UI can paint first
  if (user) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => { loadTierSettingsFromCloud(); loadCashbackSettings(); });
    } else {
      setTimeout(() => { loadTierSettingsFromCloud(); loadCashbackSettings(); }, 0);
    }
  }
});

// -------- 🧩 MODE SWITCHER --------
const modeSelect = document.getElementById("modeSelect");
if (modeSelect) {
  const initialHint = isAdminHint ? "admin" : (mode || "reader");
  modeSelect.value = initialHint;

  modeSelect.addEventListener("change", async (e) => {
    const selected = e.target.value;
    const revertVal = () => (localStorage.getItem("isAdmin") === "true"
      ? "admin"
      : (localStorage.getItem("mode") || "reader"));

    try {
      if (selected === "admin") {
        const email = prompt("Enter Admin email:"); if (!email) throw new Error("No email entered.");
        const password = prompt("Enter Admin password:"); if (!password) throw new Error("No password entered.");
        const cred = await firebase.auth().signInWithEmailAndPassword(email.trim(), password.trim());
        if (!(await ensureAdmin())) {
          await firebase.auth().signOut();
          throw new Error("Signed in user is not an admin.");
        }
        localStorage.setItem("mode", "admin");
        localStorage.setItem("isAdmin", "true");
        console.log("Admin signed in:", cred.user.uid);

      } else if (selected === "public") {
        const email = prompt("Enter Kafe/Staff email:"); if (!email) throw new Error("No email entered.");
        const password = prompt("Enter Kafe/Staff password:"); if (!password) throw new Error("No password entered.");
        const cred = await firebase.auth().signInWithEmailAndPassword(email.trim(), password.trim());
        const isPub = await ensurePublic(), isAdm = await ensureAdmin();
        if (!isPub && !isAdm) {
          await firebase.auth().signOut();
          throw new Error("Signed in user has no role.");
        }
        localStorage.setItem("mode", "public");
        localStorage.setItem("isAdmin", isAdm ? "true" : "false");
        console.log("Public signed in:", cred.user.uid);

      } else if (selected === "reader") {
        await firebase.auth().signOut();
        localStorage.setItem("mode", "reader");
        localStorage.setItem("isAdmin", "false");
        console.log("Switched to Reader mode");
      }

      location.reload();
    } catch (err) {
      console.error(`Mode switch to "${selected}" failed:`, err);
      alert(`Cannot switch to ${selected} mode. ${err.message || ""}`);
      modeSelect.value = revertVal();
    }
  });
}

// -------- 🔎 OCR & IMAGE HELPERS --------
async function resizeImage(base64, maxWidth = 750) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        if (!canvas.getContext) return resolve(base64);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.filter = "grayscale(100%) contrast(130%) brightness(105%)";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => resolve(base64);
      img.src = base64;
    } catch {
      resolve(base64);
    }
  });
}

async function runReceiptOCR(file) {
  if (!window.FileReader) throw new Error("FileReader not supported");
  const imgData = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const base64 = await resizeImage(imgData);
  try {
    const worker = await ensureTesseractReady();
    const { data } = await worker.recognize(base64);
    return extractTotalAmount(data.text || "");
  } catch (e) {
    console.warn("⚠️ OCR unavailable, returning null", e);
    return null;
  }
}

async function handleReceiptOCRWithStatus(file, statusEl, amountEl) {
  if (!(await ensureAdmin()) && !(await ensurePublic())) {
    alert("This account cannot process receipt images.");
    return null;
  }
  if (statusEl) statusEl.textContent = "🔍 Scanning receipt… please wait";
  const started = performance.now();
  try {
    const amount = await runReceiptOCR(file);
    const scanTime = ((performance.now() - started) / 1000).toFixed(1);
    if (amount) {
      if (amountEl) amountEl.value = amount;
      if (statusEl) statusEl.textContent = `✅ Auto-filled: ${fmtRp(amount)} (${scanTime}s). Press 'Add' to confirm.`;
      return amount;
    } else {
      if (statusEl) statusEl.textContent = `⚠️ No valid total detected (${scanTime}s). Please enter manually.`;
      return null;
    }
  } catch (err) {
    console.error("OCR error:", err);
    if (statusEl) statusEl.textContent = "❌ Failed to scan receipt.";
    return null;
  }
}

// -------- 📥 DOWNLOAD HELPER --------
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -------- 📤 EXPORTS --------
async function exportMembersCSV() {
  if (!(await ensurePublic()) && !(await ensureAdmin())) return alert("You don’t have permission to export members.");
  try {
    const snap = await db.collection("members").get();
    const members = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const header = ["ID", "Name", "Birthdate", "Tier", "Phone", "Email"];
    const rows = members.map(m => [
      `"${m.id}"`, `"${m.name || ""}"`, `"${m.birthdate || ""}"`, `"${m.tier || ""}"`,
      `"${m.phone || ""}"`, `"${m.email || ""}"`
    ]);
    const csv = [header.join(","), ...rows.map(r => r.join(","))].join("\n");
    downloadFile("members.csv", csv, "text/csv");
  } catch (err) {
    console.error("Export failed:", err);
    alert("Unable to export members — check permissions or network.");
  }
}
async function exportMembersJSON() {
  if (!(await ensureAdmin())) return alert("Only admins can export full member JSON.");
  try {
    const snap = await db.collection("members").get();
    const members = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    downloadFile("members.json", JSON.stringify(members, null, 2), "application/json");
  } catch (err) {
    console.error("Export failed:", err);
    alert("Unable to export members JSON.");
  }
}
async function exportAllTransactions() {
  if (!(await ensurePublic()) && !(await ensureAdmin())) return alert("You don’t have permission to export transactions.");
  try {
    const snap = await db.collection("members").get();
    let csv = "Member ID,Member Name,Date,Amount,Cashback,File Attached\n";
    snap.forEach(doc => {
      const m = doc.data();
      (m.transactions || []).forEach(tx => {
        const date = new Date(tx.date).toLocaleDateString();
        csv += `"${doc.id}","${m.name || ""}","${date}",${tx.amount || 0},${tx.cashback || 0},"${tx.fileData ? "Yes" : "No"}"\n`;
      });
    });
    downloadFile("transactions.csv", csv, "text/csv");
  } catch (err) {
    console.error("Export transactions failed:", err);
    alert("Unable to export transactions.");
  }
}
async function exportTransactionsWithImages() {
  if (!(await ensureAdmin())) return alert("Only admins can export transaction images.");
  try {
    const snap = await db.collection("members").get();
    const rows = [["Member ID", "Member Name", "Date", "Amount", "Cashback", "Image"]];
    snap.forEach(doc => {
      const m = doc.data();
      (m.transactions || []).forEach(tx => {
        rows.push([
          doc.id,
          m.name || "",
          new Date(tx.date).toLocaleDateString(),
          tx.amount || 0,
          tx.cashback || 0,
          tx.fileData || ""
        ]);
      });
    });
    const csv = rows.map(row =>
      row.map(cell => (typeof cell === "string" && cell.includes(",") ? `"${cell}"` : cell)).join(",")
    ).join("\n");
    downloadFile("transactions-with-images.csv", csv, "text/csv");
  } catch (err) {
    console.error("Export with images failed:", err);
    alert("Unable to export transactions with images.");
  }
}

// -------- 🔐 BACKUP/RESTORE (admin) --------
const backupBtn = document.getElementById("backupDbBtn");
if (backupBtn && !backupBtn.dataset.bound) {
  backupBtn.addEventListener("click", async () => {
    if (!(await ensureAdmin())) return alert("Only admins can back up data.");
    const snapshot = await db.collection("members").get();
    const members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    downloadFile(`13e-members-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(members, null, 2), "application/json");
    alert("✅ Backup downloaded!");
  });
  backupBtn.dataset.bound = "true";
}
const restoreBtn = document.getElementById("restoreDbBtn");
if (restoreBtn && !restoreBtn.dataset.bound) {
  restoreBtn.addEventListener("click", async () => {
    if (!(await ensureAdmin())) return alert("Only admins can restore data.");
    window.location.href = "restore.html";
  });
  restoreBtn.dataset.bound = "true";
}

// -------- 🔍 SEARCH & LIST RENDER --------
function memberCardHTML(member) {
  const safeTier = toProperTier(member.tier);
  return `
    <div class="member-card" data-id="${member.id}">
      <span class="tier-${safeTier.toLowerCase()}">●</span>
      <strong>${member.name || "(Unnamed)"}</strong> (${safeTier})<br>
      <ul style="margin:4px 0 8px; padding-left:16px; font-size:0.75em; color:#555;">
        ${(tierBenefits[safeTier] || []).map(b => `<li>☕ ${b}</li>`).join("")}
        ${(birthdayPerks[safeTier] || []).map(b => `<li>🎉 ${b}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderMembersList(members) {
  const list = document.getElementById("memberList");
  if (!list) return;
  if (!members || members.length === 0) {
    list.innerHTML = "<p>No members found.</p>";
    return;
  }
  list.innerHTML = members.map(memberCardHTML).join("");
  // Delegate click
  list.querySelectorAll(".member-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-id");
      if (id) window.location.href = `details.html?id=${id}`;
    });
  });
}

function renderPagerControls() {
  const pager = document.getElementById("pager");
  if (!pager) return;
  pager.innerHTML = `
    <button ${currentPage === 1 ? "disabled" : ""} onclick="changePage(-1)">Prev</button>
    <span>Page ${currentPage}</span>
    <button ${!hasNextPage ? "disabled" : ""} onclick="changePage(1)">Next</button>
  `;
}

// Server-side pagination with cursor
async function queryMembersPage(pageNum) {
  let snapshot;
  try {
    let q = db.collection("members");

    // 🟡 Inject tier filter
    if (currentTier) {
      q = q.where("tier", "==", currentTier);
    }

    // 🔤 Order by nameLower if available
    q = q.orderBy("nameLower").limit(pageSize);

    if (pageNum > 1 && pageCursors[pageNum - 1]) {
      q = q.startAfter(pageCursors[pageNum - 1]);
    }

    snapshot = await q.get();
  } catch (err) {
    console.warn("Fallback to __name__ order due to nameLower issue:", err);
    let q = db.collection("members");

    // 🟡 Inject tier filter again in fallback
    if (currentTier) {
      q = q.where("tier", "==", currentTier);
    }

    q = q.orderBy(firebase.firestore.FieldPath.documentId()).limit(pageSize);
    if (pageNum > 1 && pageCursors[pageNum - 1]) {
      q = q.startAfter(pageCursors[pageNum - 1].id);
    }

    snapshot = await q.get();
  }
  return snapshot;
}

async function loadMembersPage(pageNumber, memberPageSize) {
  // If memberPageSize is null, load all docs, else use limit(memberPageSize)
  const list = document.getElementById("memberList");
  if (list) list.innerHTML = "<p>Loading members…</p>";

  const snap = await queryMembersPage(pageNumber);
  currentPageData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  hasNextPage = snap.size === pageSize;
  if (snap.size > 0) pageCursors[pageNumber] = snap.docs[snap.docs.length - 1];
  currentPage = pageNumber;

  renderMembersList(currentPageData);
  renderPagerControls();
  checkUpcomingBirthdays(currentPageData); // lightweight, per-page
}

function changePage(delta) {
  const target = currentPage + delta;
  if (target < 1) return;
  if (delta > 0 && !hasNextPage) return;
  loadMembersPage(target);
}
window.changePage = changePage;

function applyPageSize(newSize) {
  const size = Number(newSize);
  if (![5, 10, 20].includes(size)) return;
  pageSize = size;
  localStorage.setItem("memberPageSize", String(size));
  // reset pagination
  currentPage = 1;
  pageCursors = [];
  loadMembersPage(1);
}
window.applyPageSize = applyPageSize;

async function handleSearch(keyword) {
  const list = document.getElementById("memberList");
  const pager = document.getElementById("pager");
  const term = (keyword || "").trim().toLowerCase();
  if (!term) {
    // Back to paginated list
    if (pager) pager.style.visibility = "visible";
    return loadMembersPage(1);
  }

  if (list) list.innerHTML = "<p>Searching…</p>";
  if (pager) pager.style.visibility = "hidden";

  try {
    let snapshot;
    try {
      snapshot = await db.collection("members")
        .orderBy("nameLower")
        .startAt(term)
        .endAt(term + '\uf8ff')
        .limit(50)
        .get();
    } catch (err) {
      console.warn("Search fallback due to nameLower issue:", err);
      // Fallback: naive scan (limited) by ID order
      const scan = await db.collection("members")
        .orderBy(firebase.firestore.FieldPath.documentId())
        .limit(200)
        .get();
      const all = scan.docs.map(d => ({ id: d.id, ...d.data() }));
      const filtered = all.filter(m => (m.name || "").toLowerCase().includes(term));
      snapshot = { docs: filtered.map(m => ({ id: m.id, data: () => m })) };
    }
    const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderMembersList(results);
  } catch (err) {
    console.error("❌ Search failed:", err);
    if (list) list.innerHTML = "<p>Search failed.</p>";
  }
}

let currentTier = '';
let currentPageSize = 10;
let currentSearch = '';

function wireListUI() {
  // Search filter
  document.getElementById('searchInput').addEventListener('input', e => {
    currentSearch = e.target.value.trim().toLowerCase();
    loadMembersPage(1);
  });

  // Tier filter
  document.getElementById('tierFilter').addEventListener('change', e => {
    currentTier = e.target.value;
    loadMembersPage(1);
  });

  // Page size filter
  document.getElementById('applyPageSizeBtn').addEventListener('click', () => {
    const selected = document.getElementById('memberPageSize').value;
    currentPageSize = selected === 'all' ? null : parseInt(selected, 10);
    loadMembersPage(1);
  });
}


// -------- 🎈 BIRTHDAY BANNER --------
function checkUpcomingBirthdays(members) {
  const banner = document.getElementById("birthdayBanner");
  const messageSpan = document.getElementById("birthdayMessage");
  if (!banner || !messageSpan) return;

  const today = new Date();
  const msgs = (members || [])
    .filter(m => m.birthdate)
    .map(m => {
      const b = new Date(m.birthdate);
      b.setFullYear(today.getFullYear());
      const diff = daysDiff(b, today);
      const dateStr = b.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (diff === 0) {
        return `🎈 Today only: <strong>${m.name}</strong> gets a birthday freebie! 🎁`;
      } else if (diff >= -3 && diff <= 3) {
        return `🎉 <strong>${m.name}</strong>'s birthday is on ${dateStr}!`;
      }
      return null;
    })
    .filter(Boolean);

  if (msgs.length > 0) {
    banner.style.display = "block";
    messageSpan.innerHTML = msgs.join("<br>");
  } else {
    banner.style.display = "none";
  }
}

// -------- 📊 DASHBOARD --------
async function loadMembersForDashboard() {
  const now = Date.now();
  if (dashboardMembersCache.length > 0 && (now - dashboardCacheTs) < DASHBOARD_CACHE_TTL) {
    return dashboardMembersCache;
  }
  try {
    const snap = await db.collection("members").get();
    dashboardMembersCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    dashboardCacheTs = now;
    return dashboardMembersCache;
  } catch (err) {
    console.error("⚠️ Dashboard data load failed:", err);
    return [];
  }
}

async function renderTierChart() {
  const el = document.getElementById("tierChart");
  if (!el) return;
  if (typeof Chart === "undefined") {
    el.innerHTML = "<p>Chart library not loaded.</p>";
    return;
  }
  const members = await loadMembersForDashboard();
  if (members.length === 0) {
    el.innerHTML = "<p>No data available for chart.</p>";
    return;
  }
  const data = { Bronze: 0, Silver: 0, Gold: 0 };
  members.forEach(m => {
    const tier = toProperTier(m.tier);
    if (tier in data) data[tier]++;
  });
  new Chart(el, {
    type: "pie",
    data: {
      labels: Object.keys(data),
      datasets: [{
        label: "Members per Tier",
        data: Object.values(data),
        backgroundColor: ["#cd7f32", "#c0c0c0", "#ffd700"]
      }]
    }
  });
}

async function showTopMembers() {
  const div = document.getElementById("topMembers");
  if (!div) return;
  const members = await loadMembersForDashboard();
  if (members.length === 0) {
    div.innerHTML = "<p>No member data available.</p>";
    return;
  }
  const top = [...members].sort((a, b) =>
    (b.transactions || []).reduce((t, x) => t + (x.amount || 0), 0) -
    (a.transactions || []).reduce((t, x) => t + (x.amount || 0), 0)
  ).slice(0, 3);
  div.innerHTML = `
    <h3>🏅 Top Customers</h3>
    <ul>
      ${top.map(m => `<li><strong>${m.name}</strong> (${toProperTier(m.tier)}) — ${fmtRp((m.transactions || []).reduce((t, x) => t + (x.amount || 0), 0))}</li>`).join("")}
    </ul>
  `;
}

async function showActivityFeed() {
  const div = document.getElementById("activityFeed");
  if (!div) return;
  const members = await loadMembersForDashboard();
  if (members.length === 0) {
    div.innerHTML = "<p>No recent activity available.</p>";
    return;
  }
  const recent = [];
  members.forEach(m => {
    (m.transactions || []).forEach(tx => recent.push({
      name: m.name,
      date: new Date(tx.date),
      amount: tx.amount
    }));
  });
  recent.sort((a, b) => b.date - a.date);
  const feed = recent.slice(0, 5);
  div.innerHTML = `
    <h3>🔔 Recent Activity</h3>
    <ul>
      ${feed.map(f => `<li>${f.date.toLocaleString()} — ${f.name} spent ${fmtRp(f.amount)}</li>`).join("")}
    </ul>
  `;
}

// -------- 💾 MEMBER CRUD --------


async function deleteMember(memberId) {
  if (!(await ensureAdmin())) return alert("Only admin accounts can delete members.");
  try {
    await db.collection("members").doc(memberId).delete();
    console.log(`🗑 Member ${memberId} deleted from Firestore.`);
  } catch (err) {
    console.error("❌ Failed to delete member:", err);
    alert("Failed to delete member. Please try again.");
  }
}

function wireAddMemberForm() {
  const btn = document.getElementById("addMemberBtn");
  if (!btn || btn.dataset.bound) return;

  btn.addEventListener("click", async () => {
    if (!(await ensureAdmin())) return alert("Only admin accounts can add members.");
    const name = (document.getElementById("newName")?.value || "").trim();
    if (!name) return alert("Name is required.");

    const newMember = {
      id: Date.now().toString(),
      name,
      nameLower: name.toLowerCase(),
      birthdate: document.getElementById("newBirthdate")?.value || "",
      phone: document.getElementById("newPhone")?.value || "",
      email: document.getElementById("newEmail")?.value || "",
      ktp: document.getElementById("newKTP")?.value || "",
      tier: toProperTier(document.getElementById("newTier")?.value || "Bronze"),
      transactions: [],
      lastRoomUpgrade: null,
      welcomed: true,
      yearlySinceUpgrade: 0,
      monthlySinceUpgrade: 0,
      redeemablePoints: 0
    };

    if (!(await ensureAdmin())) {
      return alert("Permission lost before save — please sign in again.");
    }

    await saveMember(newMember);
    if (newMember.email) {
      await sendEmailNotification("template_hi5egvi", {
        member_name: newMember.name,
        member_email: newMember.email
      });
    }
    alert(`✅ ${newMember.name} added!`);
    location.href = "index.html";
  });

  btn.dataset.bound = "true";
}

// -------- 💰 CASHBACK CALC --------
function computeCashbackFor(member, amount, allTx) {
  const todayStr = localYMD(new Date());
  const tier = toProperTier(member.tier);
  const isBday = isSameDay(new Date(), member.birthdate);

  const rate = tier === "Gold" && isBday ? cashbackSettings.birthdayGoldCashbackRate :
               tier === "Gold" ? cashbackSettings.goldCashbackRate :
               tier === "Silver" ? cashbackSettings.silverCashbackRate : 0;
  const cap = tier === "Gold" ? cashbackSettings.goldDailyCashbackCap :
              tier === "Silver" ? cashbackSettings.silverDailyCashbackCap : 0;

  const todayCashback = (allTx || [])
    .filter(tx => localYMD(tx.date) === todayStr && Number(tx.cashback) > 0)
    .reduce((sum, tx) => sum + Number(tx.cashback || 0), 0);

  let cashback = Math.floor((Number(amount) * rate) / 100);
  if (cap > 0 && todayCashback + cashback > cap) {
    cashback = Math.max(0, cap - todayCashback);
  }
  return cashback;
}


// -------- 🧾 MEMBER DETAILS RENDER --------
async function renderDetails(member) {
  const detailsEl = document.getElementById("memberDetails");
  if (!detailsEl) return;

  // 🔒 FREEZE tier — render must NEVER change it
  const originalTier = toProperTier(member.tier);
  member.tier = originalTier;


  if (!Array.isArray(member.roomUpgradeHistory)) member.roomUpgradeHistory = [];
  if (typeof member.yearlySinceUpgrade !== "number") member.yearlySinceUpgrade = 0;
  member.redeemablePoints = Number(member.redeemablePoints || 0);

  // Only use embedded transactions from this member doc (no external fetch for speed)
  const embeddedTx = (member.transactions || []).map((t, i) => ({ ...t, _idx: i, source: "manual" }));
  let allTx = [...embeddedTx].sort((a, b) => new Date(b.date) - new Date(a.date));

  const isAdm = await ensureAdmin(), isPub = await ensurePublic();

  // Calculate totals
  const now = new Date();
  const thisMonth = now.getMonth(), thisYear = now.getFullYear(), lastYear = thisYear - 1;
  let monthly = 0, yearly = 0, lastYearTotal = 0, full = 0, cashbackTotal = 0;
  allTx.forEach(tx => {
    const date = new Date(tx.date), amt = Number(tx.amount || 0), cb = Number(tx.cashback || 0);
    full += amt; cashbackTotal += cb;
    if (date.getFullYear() === thisYear) {
      yearly += amt;
      if (date.getMonth() === thisMonth) monthly += amt;
    }
    if (date.getFullYear() === lastYear) lastYearTotal += amt;
  });

  // Table rows for recent transactions
  const recentRows = allTx.slice(0, 10).map(tx => `
    <tr>
      <td>${new Date(tx.date).toLocaleString()}</td>
      <td style="text-align:right">${fmtRp(tx.amount || 0)}</td>
      <td style="text-align:right">${tx.cashback ? fmtRp(tx.cashback) : "-"}</td>
      <td>${tx.note || ""}</td>
      <td>${tx.source || ""}</td>
    </tr>
  `).join("");

  // Render HTML
  detailsEl.innerHTML = `
    <div class="member-header">
      <h2>${member.name} <small>(${toProperTier(member.tier)})</small></h2>
      <p><strong>Email:</strong> ${member.email || "-"} | 
         <strong>Phone:</strong> ${member.phone || "-"} | 
         <strong>Birthdate:</strong> ${member.birthdate ? new Date(member.birthdate).toLocaleDateString() : "-"}</p>
      <p><strong>This month:</strong> ${fmtRp(monthly)} | 
         <strong>This year:</strong> ${fmtRp(yearly)} | 
         <strong>Last year:</strong> ${fmtRp(lastYearTotal)} | 
         <strong>All time:</strong> ${fmtRp(full)} | 
         <strong>Cashback total:</strong> ${fmtRp(cashbackTotal)} | 
         <strong>Redeemable points:</strong> ${fmtRp(member.redeemablePoints || 0)}</p>
    </div>
    ${(isAdm || isPub) ? `
      <div class="add-tx-card">
        <h3>Add transaction</h3>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <label>Amount: <input id="txAmount" type="number" min="0" step="1" placeholder="e.g. 100000" style="width:160px"></label>
          <label>Receipt image: <input id="txFile" type="file" accept="image/*"></label>
          <button id="addTxBtn">Add</button>
        </div>
        <div id="ocrStatus" style="margin-top:8px; font-size:0.9em; color:#555;"></div>
      </div>
    ` : `<p><em>Read‑only mode: cannot add transactions.</em></p>`}
    <div class="recent-tx">
      <h3>Recent activity</h3>
      <div style="overflow:auto">
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr>
            <th>Date</th><th>Amount</th><th>Cashback</th><th>Note</th><th>Source</th>
          </tr></thead>
          <tbody>
            ${recentRows || `<tr><td colspan="5" style="color:#777;">No transactions yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Wire "Add transaction" button
  const addBtn = document.getElementById("addTxBtn");
  if (addBtn && !addBtn.dataset.bound && (isAdm || isPub)) {
    addBtn.addEventListener("click", async () => {
      if (!(await ensureAdmin()) && !(await ensurePublic())) {
        return alert("You no longer have permission to add transactions.");
      }
      const amountInput = document.getElementById("txAmount");
      const fileInput = document.getElementById("txFile");
      const ocrStatus = document.getElementById("ocrStatus");
      const raw = (amountInput?.value || "").trim();
      let amount = parseFloat(raw);
      const file = fileInput?.files?.[0];

      if (file && (!raw || isNaN(amount) || amount <= 0)) {
        const detected = await handleReceiptOCRWithStatus(file, ocrStatus, amountInput);
        if (detected) amount = parseFloat(amountInput.value);
        else return;
      }
      if (isNaN(amount) || amount <= 0) return alert("Enter a valid amount.");

      const cashback = computeCashbackFor(member, amount, allTx);
      const newTx = {
        date: new Date().toISOString(),
        amount,
        cashback,
        note: "",
        source: "manual"
      };
      member.transactions = [newTx, ...(member.transactions || [])];

// Recalculate totals AFTER adding tx
const now = new Date();
let newYearly = 0;
let newMonthly = 0;

[ newTx, ...allTx ].forEach(tx => {
  const d = new Date(tx.date);
  if (d.getFullYear() === now.getFullYear()) {
    newYearly += Number(tx.amount || 0);
    if (d.getMonth() === now.getMonth()) {
      newMonthly += Number(tx.amount || 0);
    }
  }
});


// Calculate upgrade-only tier
const upgradedTier = calculateTierAfterTransaction(
  { tier: originalTier }, // 🔒 base on frozen tier
  newYearly,
  newMonthly
);

if (tierRank(upgradedTier) > tierRank(originalTier)) {
  member.tier = upgradedTier;
  member.lastKnownTier = upgradedTier;
  member.yearlySinceUpgrade = 0;
  member.monthlySinceUpgrade = 0;
}


await saveMember(member);



      // Refresh with latest doc from Firestore
      const freshDoc = await db.collection("members").doc(member.id).get();
      if (freshDoc.exists) {
        alert(`✅ Transaction of ${fmtRp(amount)} added${cashback ? ` with cashback ${fmtRp(cashback)}` : ""}.`);
        renderDetails({ id: freshDoc.id, ...freshDoc.data() });
      }
    });
    addBtn.dataset.bound = "true";
  }
}