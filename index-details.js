// ==============================
// 13e-loyalty/index-details.js
// List & Detail views
// ==============================

// ---- Globals from common.js (safeguarded) ----
window.db = window.db || (firebase && firebase.firestore());

// Enable Firestore local persistence for instant cached reads
firebase.firestore().enablePersistence({ synchronizeTabs: true })
  .catch(err => console.warn("⚠️ Firestore persistence not enabled:", err));

// Cache freshness window for session cache (in ms)
const MEMBER_CACHE_TTL = 60_000;

// ✅ Hardcoded perks
window.tierBenefits = window.tierBenefits || {
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

window.birthdayPerks = window.birthdayPerks || {
  Bronze: [
    "🎂 Birthday Treat:",
    "- Free drink/snack + 30% off Honda service"
  ],
  Silver: [
    "🎂 Birthday Treat:",
    "- Free drink and snack",
    "- 50% off at Millennium",
    "- 30% off Honda service"
  ],
  Gold: [
    "🎂 VIP Birthday Package:",
    "- 🏨 Free Deluxe room for one night",
    "- 🍽️ Free Food+drink+snack combo",
    "- 💰 30% cashback (Rp30k/day cap)",
    "- 🍽️ Free VIP lounge access at 13e Café",
    "- 🎁 Optional Free birthday gift delivered to home"
  ]
};

// ---- Mode helpers ----
function isAdminMode() {
  return localStorage.getItem("isAdmin") === "true" || localStorage.getItem("mode") === "admin";
}
function isReaderMode() {
  return localStorage.getItem("mode") === "reader";
}

// Canonical, consistent flags
window.mode = (localStorage.getItem("mode") || "reader").trim().toLowerCase();
window.isAdmin = localStorage.getItem("isAdmin") === "true" || window.mode === "admin";
window.isKafe = window.mode === "kafe" && !window.isAdmin;
window.isReader = window.mode === "reader" && !window.isAdmin;

// ---- State (GLOBAL SAFE) ----
window.currentTier = window.currentTier || "";
window.currentSearch = window.currentSearch || "";
let currentPage = 1;
let pageSize = (() => {
  const raw = localStorage.getItem("pageSize");
  return raw && raw !== "all" ? Number(raw) || 20 : 20;
})();
let pageCursors = [];
let currentPageData = [];
let hasNextPage = false;
let txPage = 1;
const txPageSize = 10;

// ---- Settings Cache ----
window.tierSettings = window.tierSettings || {};
async function loadTierSettingsFromCloud() {
  try {
    const thresholdsDoc = await db.collection("settings").doc("tierThresholds").get();
    if (thresholdsDoc.exists) window.tierSettings = { ...window.tierSettings, ...thresholdsDoc.data() };
    const ratesDoc = await db.collection("settings").doc("cashbackRates").get();
    if (ratesDoc.exists) window.tierSettings = { ...window.tierSettings, ...ratesDoc.data() };
  } catch (err) {
    console.error("⚠️ Failed to load settings:", err);
  }
}


// ============================================
// ✉️ Email + Payload Functions
// ============================================
function sendEmailNotification(templateId, data) {
  return emailjs.send("service_dhmya66", templateId, data)
    .then(() => console.log("✅ Email sent"))
    .catch(err => console.error("❌ Email send failed:", err));
}

// Hard‑coded perks for upgrade email
const tierBenefits = {
  Bronze: [
    "- 10% off at 13e Café",
    "- 5% off Honda motorbike service (excl. spare parts)",
  ],
  Silver: [
    "- 15% off at 13e Café",
    "- 10% off Honda service + 5% off at Millennium",
    "- 5% cashback (Rp15k/day cap)",
  ],
  Gold: [
    "- 20% off at 13e Café",
    "- 15% off Honda service + 10% off at Millennium",
    "- 🏨 Free room upgrade (every 6 months)",
    "- 💰 5% cashback (Rp30k/day cap) + new unit voucher",
  ]
};

const birthdayPerks = {
  Bronze: [
    "🎂 Birthday Treat:",
    "- Free drink/snack + 30% off Honda service"
  ],
  Silver: [
    "🎂 Birthday Treat:",
    "- Free drink and snack",
    "- 50% off at Millennium",
    "- 30% off Honda service"
  ],
  Gold: [
    "🎂 VIP Birthday Package:",
    "- 🏨 Free Deluxe room for one night",
    "- 🍽️ Free Food+drink+snack combo",
    "- 💰 30% cashback (Rp30k/day cap)",
    "- 🍽️ Free VIP lounge access at 13e Café",
    "- 🎁 Optional Free birthday gift delivered to home"
  ]
};


function getMessagePayload(type, member, meta = {}) {
  switch (type) {
    case "birthday": {
      const birthdayItems = birthdayPerks[member.tier] || [];
      return {
        main_message: `🎉 We’re thrilled to celebrate you, ${member.name}!
As a cherished ${member.tier} member, you can now redeem your exclusive birthday rewards designed to make your day just a little more magical.`,
        benefit_1: birthdayItems[0] || "",
        benefit_2: birthdayItems[1] || "",
        benefit_3: birthdayItems[2] || "",
        benefit_4: birthdayItems[3] || "",
        benefit_5: birthdayItems[4] || "",
        benefit_6: birthdayItems[5] || "",
        benefit_7: birthdayItems[6] || ""
      };
    }

    case "upgrade": {
      const perks = tierBenefits[member.tier] || [];
      const birthday = birthdayPerks[member.tier] || [];
      return {
        main_message: `🚀 Congrats, ${member.name}! You've just leveled up to ${member.tier} tier at 13e Café.`,
        benefit_1: `🌟 Daily Perks:`,
        benefit_2: perks[0] || "",
        benefit_3: perks[1] || "",
        benefit_4: perks[2] || "",
        benefit_5: perks[3] || "",
        benefit_6: `🎂 Birthday Perks:`,
        benefit_7: birthday[1] || "",
        benefit_8: birthday[2] || "",
        benefit_9: birthday[3] || "",
        benefit_10: birthday[4] || "",
        benefit_11: birthday[5] || "",
        benefit_12: birthday[6] || ""
      };
    }
    case "transaction_summary": {
      const { lastTransaction, cashbackPoints, member: m } = meta || {};
      const txDate = lastTransaction?.date
        ? new Date(lastTransaction.date).toLocaleString()
        : "(unknown date)";
      return {
        main_message: `🧾 A new transaction has been added to your 13e Circle account.`,
        benefit_1: `• Transaction Date: ${txDate}`,
        benefit_2: `• Amount Spent: Rp${lastTransaction?.amount?.toLocaleString()}`,
        benefit_5: cashbackPoints > 0 ? `• Cashback Earned: Rp${cashbackPoints.toLocaleString()}` : "• Cashback Earned: –",
        benefit_6: `• Available Cashback Points: Rp${(m?.redeemablePoints ?? 0).toLocaleString()}`
      };
    }
    case "cashback_expire":
      return { main_message: `⚠️ Reminder: Your cashback points are expiring soon!`, benefit_1: "Visit the café to redeem them before the deadline." };
    default:
      return { main_message: `Hello from 13e Café ☕` };
  }
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

// ============================================
// 🎂 Birthday Banner + Auto Email
// ============================================
function daysDiff(d1, d2) {
  return Math.floor((d1 - d2) / (1000 * 60 * 60 * 24));
}

window.checkUpcomingBirthdays = async function() {
  const banner = document.getElementById("birthdayBanner");
  const messageSpan = document.getElementById("birthdayMessage");
  if (!banner || !messageSpan) return;

  const today = new Date();
  const msgs = [];
  const snap = await db.collection("members").get();

  snap.forEach(doc => {
    const m = doc.data();
    if (!m.birthdate) return;

    const b = new Date(m.birthdate);
    b.setFullYear(today.getFullYear());
    const diff = daysDiff(b, today);
    const dateStr = b.toLocaleDateString(undefined, { month: "short", day: "numeric" });

    if (diff === 0) msgs.push(`🎈 Today: <strong>${m.name}</strong> gets a birthday treat! 🎁`);
    else if (diff >= -3 && diff <= 3) msgs.push(`🎉 <strong>${m.name}</strong>'s birthday is on ${dateStr}!`);
  });

  banner.style.display = msgs.length ? "block" : "none";
  if (msgs.length) messageSpan.innerHTML = msgs.join("<br>");
};

async function markBirthdayEmailSent(memberId) {
  await db.collection("members").doc(memberId).update({
    lastBirthdayEmailSent: firebase.firestore.Timestamp.fromDate(new Date())
  });
}

function toProperTier(tier) {
  if (!tier) return "Bronze";
  const t = tier.toString().trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function sendBirthdayEmail(member) {
  try {
    const payload = {
      member_name: member.name,
      member_email: member.email,
      ...getMessagePayload("birthday", member),
      closing_line: "Drop by 13e Café today to claim your treats 🎂",
      subject_line: getSubjectForType("birthday", member)
    };
    await sendEmailNotification("template_2q6hh6g", payload);
    console.log(`✅ Birthday email sent to ${member.name}`);
  } catch (err) {
    console.error(`❌ Failed to send birthday email to ${member.name}:`, err);
  }
}

async function autoSendBirthdayEmails() {
  try {
    const today = new Date();
    const snap = await db.collection("members")
      .where("birthMonth", "==", today.getMonth() + 1)
      .where("birthDay", "==", today.getDate())
      .get();

    console.log(`🎂 Found ${snap.size} member(s) with a birthday today.`);

    let sentCount = 0;
    let skippedCount = 0;

    for (const doc of snap.docs) {
      const member = { id: doc.id, ...doc.data() };
      const lastSent = member.lastBirthdayEmailSent?.toDate?.() || null;
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(today.getDate() - 7);

      if (lastSent && lastSent > sevenDaysAgo) {
        console.log(`⏭ Skipping ${member.name} — already emailed within last 7 days.`);
        skippedCount++;
        continue;
      }

      console.log(`📧 Preparing to send birthday email to ${member.name} (${member.email})`);

      await sendBirthdayEmail(member);
      console.log(`✅ Birthday email sent to ${member.name}`);

      await markBirthdayEmailSent(member.id);
      sentCount++;
    }

    console.log(`🎉 Birthday email run complete — ${sentCount} sent, ${skippedCount} skipped.`);
  } catch (err) {
    console.error("❌ Birthday auto-check failed:", err);
  }
}

async function sendTierUpgradeEmail(member) {
  console.log(`📧 Preparing to send tier upgrade email to ${member.name} (${member.email})`);

  const payload = {
    member_name: member.name,
    member_email: member.email,
    ...getMessagePayload("upgrade", member),
    closing_line: "Enjoy your new perks — we look forward to seeing you soon at 13e Café! ☕",
    subject_line: getSubjectForType("upgrade", member)
  };

  console.log("📦 Tier upgrade email payload:", payload);

  try {
    await sendEmailNotification("template_2q6hh6g", payload);
    console.log(`✅ Tier upgrade email sent to ${member.name}`);
  } catch (err) {
    console.error(`❌ Failed to send tier upgrade email to ${member.name}:`, err);
  }
}

async function sendTransactionSummaryEmail(member, tx) {
  // Log that we're about to send
  console.log(`📧 Preparing to send transaction summary email to ${member.name} (${member.email})`);

  const payload = {
    member_name: member.name,
    member_email: member.email,
    ...getMessagePayload("transaction_summary", member, {
      lastTransaction: tx,
      cashbackPoints: tx.cashback || 0,
      member
    }),
    closing_line: "Thank you for your continued loyalty — we’ll see you again soon! ☕",
    subject_line: getSubjectForType("transaction_summary", member)
  };

  if (tx.fileData) {
    payload.attachment_base64 = tx.fileData; // Optional: you'll add this field to your EmailJS template
  }

  // Log the payload so you can inspect exactly what’s being sent
  console.log("📦 Transaction summary email payload:", payload);

  try {
    await sendEmailNotification("template_2q6hh6g", payload);
    console.log(`✅ Transaction summary email sent to ${member.name}`);
  } catch (err) {
    console.error(`❌ Failed to send transaction summary email to ${member.name}:`, err);
  }
}

// ============================================
// 👥 Member List Rendering & Paging
// ============================================
function memberCardHTML(member) {
  const safeTier = toProperTier(member.tier);
  return `
    <div class="member-card" data-id="${member.id}">
      <span class="tier-${safeTier.toLowerCase()}">●</span>
      <strong>${member.name || "(Unnamed)"} </strong> (${safeTier})<br>
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
  if (!members?.length) { list.innerHTML = "<p>No members found.</p>"; return; }
  list.innerHTML = members.map(memberCardHTML).join("");
  list.querySelectorAll(".member-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.dataset.id;
      const memberObj = members.find(m => m.id === id);
      if (memberObj) {
        sessionStorage.setItem("selectedMember", JSON.stringify({
          data: memberObj,
          ts: Date.now()
        }));
      }
      if (id) location.href = `details.html?id=${id}`;
    });
  });
}


function renderPagerControls() {
  const pager = document.getElementById("pager");
  if (pager) {
    pager.innerHTML = `
      <button ${currentPage === 1 ? "disabled" : ""} onclick="changePage(-1)">Prev</button>
      <span>Page ${currentPage}</span>
      <button ${!hasNextPage ? "disabled" : ""} onclick="changePage(1)">Next</button>
    `;
  }
}

window.changePage = function(delta) {
  const target = currentPage + delta;
  if (target < 1 || (delta > 0 && !hasNextPage)) return;
  loadMembersPage(target);
};

function getPageSize() {
  const raw = localStorage.getItem("pageSize");
  return raw && raw !== "all" ? Number(raw) || 20 : null;
}

async function queryMembersPage(pageNum) {
  try {
    let q = db.collection("members");
    if (window.currentTier) q = q.where("tier", "==", toProperTier(window.currentTier));
    q = q.orderBy("nameLower");

    const size = getPageSize();
    if (size) q = q.limit(size);

    if (pageNum > 1 && pageCursors[pageNum - 1]) {
      q = q.startAfter(pageCursors[pageNum - 1]);
    }
    return await q.get();
  } catch (err) {
    console.warn("Fallback to __name__ order:", err);
    let q = db.collection("members");
    if (window.currentTier) q = q.where("tier", "==", toProperTier(window.currentTier));
    q = q.orderBy(firebase.firestore.FieldPath.documentId());

    const size = getPageSize();
    if (size) q = q.limit(size);

    if (pageNum > 1 && pageCursors[pageNum - 1]) {
      q = q.startAfter(pageCursors[pageNum - 1].id);
    }
    return await q.get();
  }
}

window.loadMembersPage = async function(pageNumber = 1) {
  const list = document.getElementById("memberList");
  if (list) list.innerHTML = "<p>Loading members…</p>";

  if (window.currentSearch) return handleSearch(window.currentSearch);

  const snap = await queryMembersPage(pageNumber);
  currentPageData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const size = getPageSize();
  hasNextPage = !!size && snap.size === size;

  if (snap.size > 0) pageCursors[pageNumber] = snap.docs[snap.docs.length - 1];
  currentPage = pageNumber;

  renderMembersList(currentPageData);
  renderPagerControls();
  checkUpcomingBirthdays();
};

// ==============================
// 13e-loyalty/index-details.js
// Batch 2: search, filters, UI wiring, details view, bootstrap
// ==============================

// ---------- Search Handler (old-style prefix search) ----------
window.handleSearch = async function(keyword) {
  const list = document.getElementById("memberList");
  const term = (keyword || "").trim().toLowerCase();
  window.currentSearch = term;

  if (!term) {
    pageCursors = [];
    currentPage = 1;
    return loadMembersPage(1);
  }

  if (list) list.innerHTML = "<p>Searching…</p>";

  try {
    const snap = await db.collection("members")
      .orderBy("nameLower")
      .startAt(term)
      .endAt(term + '\uf8ff')
      .get();

    const results = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    hasNextPage = false; 
    renderMembersList(results);
    try { syncPagerButtons(); } catch (_) {}
    checkUpcomingBirthdays();
  } catch (err) {
    console.error("Search error:", err);
    if (list) list.innerHTML = `<p>Error while searching: ${err.message}</p>`;
  }
};

// ---------- Tier Filter ----------
window.handleTierFilter = function(tier) {
  if (tier && tier.toLowerCase() !== "all") {
    window.currentTier = tier;
  } else {
    window.currentTier = "";
  }
  window.currentSearch = "";
  currentPage = 1;
  pageCursors = [];
  loadMembersPage(1);
};

// ---------- Pager Buttons ----------
function syncPagerButtons() {
  const prevBtn = document.getElementById("prevPage");
  const nextBtn = document.getElementById("nextPage");
  if (prevBtn) prevBtn.disabled = currentPage <= 1 || !!window.currentSearch;
  if (nextBtn) nextBtn.disabled = !hasNextPage || !!window.currentSearch;
}

(function patchRenderPagerControls() {
  if (typeof renderPagerControls === "function") {
    const _renderPagerControls = renderPagerControls;
    window.renderPagerControls = function() {
      _renderPagerControls();
      syncPagerButtons();
    };
  }
})();
(function patchChangePage() {
  if (typeof changePage === "function") {
    const _changePage = changePage;
    window.changePage = function(delta) {
      _changePage(delta);
      try { syncPagerButtons(); } catch (_) {}
    };
  }
})();

// ---------- Wire LIST UI ----------
window.wireListUI = async function() {

  // --- Admin-only backup members button ---
  const backupBtn = document.getElementById("backupMembersBtn");
  if (window.isAdmin) {
    backupBtn?.addEventListener("click", async () => {
      if (!confirm("Backup ALL member data to a JSON file now?")) return;

      const snap = await db.collection("members").get();
      const all = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `members-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(`✅ Backup complete — ${all.length} members saved`);
    });
  } else {
    if (backupBtn) backupBtn.style.display = "none";
  }

  // --- Tier filter dropdown ---
  const tierSelect = document.getElementById("tierFilter");
  if (tierSelect) {
    tierSelect.value = window.currentTier || "all";
    tierSelect.addEventListener("change", e => handleTierFilter(e.target.value));
  }

  // --- Search input ---
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.value = window.currentSearch || "";
    searchInput.addEventListener("input", e => {
      const val = e.target.value;
      clearTimeout(searchInput._timer);
      searchInput._timer = setTimeout(() => handleSearch(val), 400);
    });
  }

  // --- Page size selector ---
  const pageSizeSelect = document.getElementById("pageSizeSelect");
  if (pageSizeSelect) {
    const raw = localStorage.getItem("pageSize") || "20";
    pageSizeSelect.value = raw;
    pageSizeSelect.addEventListener("change", e => {
      localStorage.setItem("pageSize", e.target.value);
      currentPage = 1;
      pageCursors = [];
      loadMembersPage(1);
    });
  }

  // --- Mode selector ---
  const modeSelect = document.getElementById("modeSelect");
  if (modeSelect) {
    modeSelect.value = localStorage.getItem("mode") || "reader";
    modeSelect.addEventListener("change", e => {
      const newMode = e.target.value;
      localStorage.setItem("mode", newMode);
      if (newMode === "admin") {
        localStorage.setItem("isAdmin", "true");
      } else {
        localStorage.removeItem("isAdmin");
      }
      location.reload();
    });
  }

  // --- Pager buttons ---
  const prevBtn = document.getElementById("prevPage");
  if (prevBtn) prevBtn.addEventListener("click", () => changePage(-1));
  const nextBtn = document.getElementById("nextPage");
  if (nextBtn) nextBtn.addEventListener("click", () => changePage(1));

  // --- Initial load ---
  await loadTierSettingsFromCloud();
  await loadMembersPage(1);
  syncPagerButtons();
  autoSendBirthdayEmails();
};

// ---------- DETAILS VIEW ----------
// ===== OCR (v4 API with old preprocessing) =====

// Pulls the highest plausible total from OCR'd text
function extractTotalAmount(ocrText) {
  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].toLowerCase().replace(/[^a-z ]/g, "").trim();
    if (/s?g?rand[ \-]?total/.test(label)) {
      const scanLines = [lines[i], lines[i + 1]];
      for (const line of scanLines) {
        if (!line) continue;
        const matches = line.match(/[\d.,]+/g);
        if (matches) {
          for (const str of matches) {
            const num = parseInt(str.replace(/[^\d]/g, ""), 10);
            if (!isNaN(num) && num >= 1000 && num <= 10000000) {
              return num;
            }
          }
        }
      }
    }
  }

  // Fallback: take max plausible number
  const fallbackMatches = [];
  for (const line of lines) {
    const matches = line.match(/[\d.,]+/g);
    if (matches) {
      matches.forEach(str => {
        const num = parseInt(str.replace(/[^\d]/g, ""), 10);
        if (!isNaN(num) && num >= 1000 && num <= 10000000) {
          fallbackMatches.push(num);
        }
      });
    }
  }
  return fallbackMatches.length > 0 ? Math.max(...fallbackMatches) : null;
}

// Resize & grayscale to boost OCR accuracy
function resizeImage(base64, maxWidth = 750) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.filter = "grayscale(100%) contrast(130%) brightness(105%)";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.src = base64;
  });
}

// File → base64 helper
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Main OCR handler (v4 API)
async function handleReceiptOCR(file, statusEl, amountEl) {
  if (!file) return;

  try {
    if (statusEl) statusEl.textContent = "🔍 Preparing image…";
    const base64 = await fileToBase64(file);
    const prepped = await resizeImage(base64);

    if (statusEl) statusEl.textContent = "📖 Reading receipt…";

    const start = performance.now();
    const { data } = await Tesseract.recognize(prepped, 'eng', {
      logger: m => {
        if (statusEl && m.status === "recognizing text") {
          statusEl.textContent = `🔍 OCR progress: ${(m.progress * 100).toFixed(0)}%`;
        }
        console.log(m);
      }
    });
    const end = performance.now();
    const scanTime = ((end - start) / 1000).toFixed(1);

    console.log("🧾 OCR TEXT:\n", data.text);

    const extracted = extractTotalAmount(data.text);
    if (extracted !== null) {
      if (amountEl) amountEl.value = extracted;
      if (statusEl) {
        statusEl.textContent = `✅ Auto-filled: Rp${extracted.toLocaleString()} (in ${scanTime}s) — now press 'Add Transaction' to confirm.`;
      }
    } else {
      if (statusEl) statusEl.textContent = `⚠️ Couldn't detect a valid total (scanned in ${scanTime}s)`;
    }

  } catch (err) {
    console.error("❌ OCR error:", err);
    if (statusEl) statusEl.textContent = "❌ Failed to scan receipt.";
  }
}

// Re-evaluates member.tier using thresholds, with a robust "no demote if created this year" guard.
// Falls back to upgradeDate when createdAt is missing, so new members aren’t demoted prematurely.
async function updateTier(member) {
  // HARD SAFETY: never demote restored members in the same year
const restoredAt = member.tierRestoredAt
  ? (member.tierRestoredAt.toDate?.() || new Date(member.tierRestoredAt))
  : null;

const now = new Date();
const sameYearRestore =
  restoredAt && restoredAt.getFullYear() === now.getFullYear();

  // Ensure settings are loaded
  if (!window.tierSettings || !Object.keys(window.tierSettings).length) {
    await loadTierSettingsFromCloud();
  }

  // Resolve thresholds (supports {thresholds:{...}} or flat shape)
  const ts = window.tierSettings?.thresholds || window.tierSettings || {};
  const bronzeToSilverMonth = Number(ts.bronzeToSilverMonth ?? 500000);
  const bronzeToSilverYear  = Number(ts.bronzeToSilverYear  ?? 1200000);
  const silverStayYear      = Number(ts.silverStayYear      ?? 500000);
  const silverToGoldMonth   = Number(ts.silverToGoldMonth   ?? 1250000);
  const silverToGoldYear    = Number(ts.silverToGoldYear    ?? 4000000);
  const goldStayYear        = Number(ts.goldStayYear        ?? 2000000);

  // Normalize current tier
  const currentTier = toProperTier(member.tier);

  // Use the since-upgrade spend fields (recomputed elsewhere when needed)
  const monthSpend = Number(member.monthlySinceUpgrade ?? 0);
  const yearSpend  = Number(member.yearlySinceUpgrade ?? 0);

  // Robust creation-year guard: prefer createdAt; fallback to upgradeDate

  const thisYear = now.getFullYear();
  let originDate = null;

  if (member.createdAt) {
    originDate = member.createdAt.toDate ? member.createdAt.toDate() : new Date(member.createdAt);
  } else if (member.upgradeDate) {
    // Fallback ensures newly upgraded members this year aren’t demoted immediately
    originDate = new Date(member.upgradeDate);
  }
  const isNewThisYear =
    originDate instanceof Date && !isNaN(originDate) && originDate.getFullYear() === thisYear;

  let newTier = currentTier;

  // Promotions (always allowed)
  if (currentTier === "Bronze") {
    if (monthSpend >= bronzeToSilverMonth || yearSpend >= bronzeToSilverYear) {
      newTier = "Silver";
      member.monthlySinceUpgrade = 0;
      member.yearlySinceUpgrade = 0;
    }
  } else if (currentTier === "Silver") {
    if (monthSpend >= silverToGoldMonth || yearSpend >= silverToGoldYear) {
      newTier = "Gold";
      member.monthlySinceUpgrade = 0;
      member.yearlySinceUpgrade = 0;
    } else {
      // Demotion (guarded)
      if (!isNewThisYear && !sameYearRestore && yearSpend < silverStayYear) {
  newTier = "Bronze";
}
    }
  } else if (currentTier === "Gold") {
    // Demotion (guarded)
    if (!isNewThisYear && !sameYearRestore && yearSpend < goldStayYear) {
  newTier = "Silver";
}
  }

  member.tier = newTier;
  return member;
}

function isNewThisYearGuard(member) {
  const now = new Date();
  const thisYear = now.getFullYear();
  let created = null;

  if (member.createdAt) {
    created = member.createdAt.toDate ? member.createdAt.toDate() : new Date(member.createdAt);
  } else if (member.upgradeDate) {
    created = new Date(member.upgradeDate); // fallback
  }
  return created instanceof Date && !isNaN(created) && created.getFullYear() === thisYear;
}

// Recompute since-upgrade and apply "no demote if created this year"
async function updateTierNoDemoteIfNew(member) {
  if (!window.tierSettings || !Object.keys(window.tierSettings).length) {
    await loadTierSettingsFromCloud();
  }

  // Recompute monthlySinceUpgrade / yearlySinceUpgrade from transactions
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const upgradeDate = member.upgradeDate ? new Date(member.upgradeDate) : null;

  let yearlySinceUpgrade = 0;
  let monthlySinceUpgrade = 0;

  (member.transactions || []).forEach(tx => {
    const d = new Date(tx.date);
    if (d.getFullYear() === currentYear) {
      if (!upgradeDate || d > upgradeDate) {
        yearlySinceUpgrade += tx.amount;
        if (d.getMonth() === currentMonth) monthlySinceUpgrade += tx.amount;
      }
    }
  });

  member.yearlySinceUpgrade = yearlySinceUpgrade;
  member.monthlySinceUpgrade = monthlySinceUpgrade;

  // Then run the same tier rules (with creation-year demotion skip)
  await updateTier(member);
}

async function renderDetails(member) {
  const detailsEl = document.getElementById("memberDetails");
  if (!detailsEl) return;

  // Safe defaults
  if (!Array.isArray(member.roomUpgradeHistory)) member.roomUpgradeHistory = [];
  if (typeof member.yearlySinceUpgrade !== "number") member.yearlySinceUpgrade = 0;
  if (typeof member.monthlySinceUpgrade !== "number") member.monthlySinceUpgrade = 0;
  member.redeemablePoints = member.redeemablePoints || 0;

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const lastYear = thisYear - 1;

  let monthly = 0, yearly = 0, lastYearTotal = 0, full = 0, cashbackTotal = 0;
  (member.transactions || []).forEach(tx => {
    const date = new Date(tx.date);
    full += tx.amount;
    cashbackTotal += tx.cashback || 0;
    if (date.getFullYear() === thisYear) {
      yearly += tx.amount;
      if (date.getMonth() === thisMonth) monthly += tx.amount;
    }
    if (date.getFullYear() === lastYear) lastYearTotal += tx.amount;
  });

  await updateTier(member);

  // Transaction paging
  const totalTxPages = Math.ceil((member.transactions?.length || 0) / txPageSize);
  const start = (txPage - 1) * txPageSize;
  const end = start + txPageSize;
  const pagedTx = (member.transactions || []).slice().reverse().slice(start, end);

  // Helper to render perk groups
  const renderPerkGroup = (title, items) => {
    if (!items?.length) return "";
    return `<h3>${title}</h3><ul>${items.map(b => `<li>${b}</li>`).join("")}</ul>`;
  };

  detailsEl.innerHTML = `
    <div class="details-header">
      <button id="backBtn">⬅ Back</button>
      <h2>${member.name || "(Unnamed)"} <small>(${member.tier || "-"})</small></h2>
      <div class="details-actions">
        ${window.isAdmin ? `
          <button id="editMemberBtn">✏️ Edit</button>
          <button id="deleteMemberBtn">🗑 Delete</button>
          <button id="addTransactionBtn">➕ Add Transaction</button>
        ` : ""}
      </div>
    </div>

<div class="member-info">
  <p><strong>Email:</strong> ${member.email || "-"}</p>
  <p><strong>Phone:</strong> ${member.phone || "-"}</p>
  <p><strong>Birthdate:</strong> ${member.birthdate ? new Date(member.birthdate).toLocaleDateString() : "-"}</p>
  <p><strong>KTP:</strong> ${
    window.isAdmin
      ? (member.ktp || member.ktpNumber || "-")
      : `<a href="#" id="viewKtpLink">(Click to view)</a>`
  }</p>
</div>

    <div class="stats-section">
      <p><strong>Available Cashback Points:</strong> Rp${member.redeemablePoints.toLocaleString()}</p>
      <p><strong>Cashback Earned:</strong> Rp${cashbackTotal.toLocaleString()}</p>
      <p>Spending Since Upgrade (Month): Rp${(member.monthlySinceUpgrade ?? 0).toLocaleString()}</p>
      <p>Spending Since Upgrade (Year): Rp${(member.yearlySinceUpgrade ?? 0).toLocaleString()}</p>
      <p>This Month: Rp${monthly.toLocaleString()}</p>
      <p>This Year: Rp${yearly.toLocaleString()}</p>
      <p>Last Year: Rp${lastYearTotal.toLocaleString()}</p>
      <p>All Time: Rp${full.toLocaleString()}</p>
    </div>

    ${member.tier ? `
      <div class="perks-section">
        ${renderPerkGroup("Perks", tierBenefits[member.tier])}
        ${renderPerkGroup("Birthday Perks", birthdayPerks[member.tier])}
      </div>
    ` : ""}

${(member.tier || "").toLowerCase() === "gold" ? (() => {
  const rawLast = member.lastRoomUpgrade;
  const last = rawLast ? new Date(rawLast) : null;
  const validLast = last instanceof Date && !isNaN(last);

  const daysSince = validLast ? (now - last) / (1000 * 60 * 60 * 24) : Infinity;

  if (!validLast || daysSince >= 180) {
    // Never claimed or eligible again → show the claim button
    return `<button id="claimRoomUpgrade">🏨 Claim Free Room Upgrade</button>`;
  } else {
    // Claimed less than 180 days ago → show next available date
    const nextDate = new Date(last);
    nextDate.setMonth(nextDate.getMonth() + 6);
    return `<p style="color:gray;">⏳ Next upgrade available on ${nextDate.toLocaleDateString()}</p>`;
  }
})() : ""}

${(window.isAdmin || window.isKafe) ? `
  <div class="transaction-add">
    <input type="number" id="txAmount" placeholder="Amount Spent"
      ${window.isKafe && !window.isAdmin ? 'readonly title="In Kafe mode, use OCR (attach receipt) to fill amount"' : ''} />
    <input type="file" id="txFile" accept="image/*,.pdf" />
    <p id="ocrStatus" class="ocr-status"></p>

    <button id="commitTxBtn">Add Transaction</button>

    <hr>
    <input type="number" id="redeemAmount" placeholder="Redeem Rp..." />
    <button id="redeemBtn">Redeem</button>
  </div>
` : ""}

    <div class="transactions-section">
      <h3>Recent Transactions</h3>
      ${
        pagedTx.length
          ? `<table style="border-collapse:collapse;width:100%;font-size:0.9em;">
               <thead>
                 <tr>
                   <th>Date</th>
                   <th>Amount</th>
                   <th>Cashback</th>
                   ${window.isAdmin ? `<th>Delete</th>` : ""}
                 </tr>
               </thead>
               <tbody>
                 ${pagedTx.map((tx, index) => {
                   const txDate = new Date(tx.date);
                   const txDateStr = txDate.toLocaleDateString();
                   const capped = tx.note?.includes("capped")
                     ? `<br><small style="color:crimson;">🎯 ${tx.note}</small>` : "";
                   return `
                     <tr>
                       <td>${txDateStr}</td>
                       <td>Rp${tx.amount.toLocaleString()}</td>
                       <td style="color:${tx.cashback ? 'green' : '#999'};">
                         ${tx.cashback ? `+Rp${tx.cashback.toLocaleString()}` : '–'}${capped}
                       </td>
                       ${window.isAdmin ? `<td><button class="deleteTxBtn" data-index="${member.transactions.length - 1 - ((txPage - 1) * txPageSize + index)}">🗑</button></td>` : ""}
                     </tr>`;
                 }).join("")}
               </tbody>
             </table>
             ${totalTxPages > 1 ? `
               <div class="tx-pagination">
                 <button id="txPrev" ${txPage === 1 ? "disabled" : ""}>Prev</button>
                 <span>Page ${txPage} of ${totalTxPages}</span>
                 <button id="txNext" ${txPage === totalTxPages ? "disabled" : ""}>Next</button>
               </div>
             ` : ""}`
          : "<p>No transactions yet.</p>"
      }
    </div>
  `;

  // --- Bind buttons ---

  document.getElementById("backBtn")?.addEventListener("click", () => {
    window.location.href = "index.html";
  });

  if (window.isAdmin || window.isKafe) {
    if (window.isAdmin) {
      document.getElementById("editMemberBtn")?.addEventListener("click", () => {
        location.href = `edit.html?id=${member.id}`;
      });

      document.getElementById("deleteMemberBtn")?.addEventListener("click", async () => {
        if (!confirm(`Delete ${member.name}? This cannot be undone.`)) return;
        try {
          await db.collection("members").doc(member.id).delete();
          alert(`🗑️ Member ${member.name} has been deleted.`);
          location.href = "index.html";
        } catch (err) {
          console.error("❌ Failed to delete member:", err);
          alert("Failed to delete member. Please try again.");
        }
      });

      // Header "Add Transaction" button: scroll to form
      document.getElementById("addTransactionBtn")?.addEventListener("click", async () => {
        const txAmountEl = document.getElementById("txAmount");
        txAmountEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    // Commit inline transaction
    document.getElementById("commitTxBtn")?.addEventListener("click", async () => {
      await addTransactionInline(member);
    });

    // Redeem points — inline save
    document.getElementById("redeemBtn")?.addEventListener("click", async () => {
      const redeem = parseInt(document.getElementById("redeemAmount").value);
      if (isNaN(redeem) || redeem <= 0) {
        alert("Enter a valid amount.");
        return;
      }
      if (redeem > member.redeemablePoints) {
        alert("Insufficient points.");
        return;
      }
      try {
        member.redeemablePoints = Math.max(0, (member.redeemablePoints || 0) - redeem);
        await db.collection("members").doc(member.id).update({
          redeemablePoints: member.redeemablePoints
        });
        alert(`🎉 Redeemed Rp${redeem.toLocaleString()}!`);
        location.reload();
      } catch (err) {
        console.error("❌ Failed to redeem:", err);
        alert("Failed to save redemption. Please try again.");
      }
    });

    // OCR hook
    document.getElementById("txFile")?.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      handleReceiptOCR(
        file,
        document.getElementById("ocrStatus"),
        document.getElementById("txAmount")
      ).then(() => {
        e.target.value = "";
      });
    });

    // Bind KTP click-to-view for non-admins
    if (!window.isAdmin) {
      document.getElementById("viewKtpLink")?.addEventListener("click", e => {
        e.preventDefault();
        const otp = prompt("Enter one-time password from Admin:");
        if (otp === "OTP123") {
          e.target.outerHTML = member.ktp || member.ktpNumber || "-";
        } else {
          alert("❌ Incorrect OTP. Access denied.");
        }
      });
    }

    // Extra safeguard for Kafe mode – block manual entry
    if (window.isKafe && !window.isAdmin) {
      const amtInput = document.getElementById("txAmount");
      amtInput?.addEventListener("focus", e => {
        e.target.blur();
        alert("In Kafe mode, the amount must come from OCR — manual entry is disabled.");
      });
    }
  }

  // Claim room upgrade – only for Reader or Admin
  document.getElementById("claimRoomUpgrade")?.addEventListener("click", async () => {
    if (!(window.isReader || window.isAdmin)) {
      alert("❌ Only Admin or Reader can claim this upgrade.");
      return;
    }
    if (!confirm("Confirm free room upgrade for this Gold member?")) return;

    // Set the timestamp locally
    member.lastRoomUpgrade = new Date().toISOString();

    try {
      await db.collection("members")
        .doc(member.id)
        .update({ lastRoomUpgrade: member.lastRoomUpgrade });

      alert("✅ Free room upgrade recorded!");
      location.reload();
    } catch (err) {
      console.error("❌ Failed to save room upgrade:", err);
      alert("Failed to save. Please try again.");
    }
  });

  // Transaction deletion (per-row) — Admin only
  if (window.isAdmin) {
    document.querySelectorAll(".deleteTxBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const index = parseInt(btn.dataset.index, 10);
        if (Number.isNaN(index)) return;
        if (!confirm("Delete this transaction?")) return;

        try {
          const removed = member.transactions.splice(index, 1)[0] || null;
          if (removed?.cashback) {
            member.redeemablePoints = Math.max(0, (member.redeemablePoints || 0) - removed.cashback);
          }

          await db.collection("members").doc(member.id).update({
            transactions: member.transactions,
            redeemablePoints: member.redeemablePoints
          });

          alert("🗑 Transaction deleted.");
          location.reload();
        } catch (err) {
          console.error("❌ Failed to delete transaction:", err);
          alert("Failed to delete transaction. Please try again.");
        }
      });
    });
  }

  // Bind transaction table pager
  document.getElementById("txPrev")?.addEventListener("click", () => {
    if (txPage > 1) {
      txPage--;
      renderDetails(member);
    }
  });

  document.getElementById("txNext")?.addEventListener("click", () => {
    const totalTxPages = Math.ceil((member.transactions?.length || 0) / txPageSize);
    if (txPage < totalTxPages) {
      txPage++;
      renderDetails(member);
    }
  });
} // end of renderDetails()

// Inline add-transaction logic (Admin or Kafe)
async function addTransactionInline(member) {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const amountEl = document.getElementById("txAmount");
    const fileInput = document.getElementById("txFile");

    const rawAmount = amountEl?.value?.trim() || "";
    const amount = parseInt(rawAmount, 10);

    // Enforce Kafe OCR-only rule
    if (window.isKafe && !window.isAdmin) {
      if (!rawAmount || isNaN(amount) || amount <= 0) {
        alert("In Kafe mode, please attach a receipt and run OCR to fill the amount.");
        return;
      }
    } else {
      if (!rawAmount || isNaN(amount) || amount <= 0) {
        alert("Enter a valid amount.");
        return;
      }
    }

    // Cashback rates and caps
    const t = window.tierSettings || {};
    const tier = (member.tier || "Bronze").trim();
    const isBirthday = !!member.birthdate && (() => {
      const b = new Date(member.birthdate);
      return b.getMonth() === now.getMonth() && b.getDate() === now.getDate();
    })();

    const rate =
      tier === "Gold" && isBirthday ? (t.birthdayGoldCashbackRate ?? 30) :
      tier === "Gold" ? (t.goldCashbackRate ?? 5) :
      tier === "Silver" ? (t.silverCashbackRate ?? 5) : 0;

    const cap =
      tier === "Gold" ? (t.goldDailyCashbackCap ?? 30000) :
      tier === "Silver" ? (t.silverDailyCashbackCap ?? 15000) : 0;

    const todayCashback = (member.transactions || [])
      .filter(tx => tx.date && tx.date.startsWith(todayStr) && tx.cashback)
      .reduce((sum, tx) => sum + tx.cashback, 0);

    let cashback = Math.floor((amount * rate) / 100);
    if (cap > 0 && todayCashback + cashback > cap) {
      cashback = Math.max(0, cap - todayCashback);
    }

    // Build transaction object
    const tx = {
      date: now.toISOString(),
      amount,
      cashback,
      note: (cap > 0 && todayCashback + cashback === cap)
        ? `Cashback capped at Rp${cap.toLocaleString()} today`
        : ""
    };

    // If receipt present, attach Base64
    const file = fileInput?.files?.[0] || null;
    if (file) {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      tx.fileData = base64;
    }

    // Persist to member object
    member.transactions = Array.isArray(member.transactions) ? member.transactions : [];
    member.transactions.push(tx);
    member.redeemablePoints = Math.max(0, (member.redeemablePoints || 0) + cashback);

    // Store old tier before recalculation
    const oldTier = member.tier;

    // Recalculate tier with "no demotion in creation year" rule
    await updateTierNoDemoteIfNew(member);

    // Save to Firestore
    await db.collection("members").doc(member.id).update({
      transactions: member.transactions,
      redeemablePoints: member.redeemablePoints,
      tier: member.tier,
      monthlySinceUpgrade: member.monthlySinceUpgrade ?? 0,
      yearlySinceUpgrade: member.yearlySinceUpgrade ?? 0,
      ...(member.upgradeDate ? { upgradeDate: member.upgradeDate } : {})
    });

    // ✅ Send transaction summary email
    if (member.email) {
      console.log(`📧 Triggering transaction summary email for ${member.name} (${member.email})`);
      await sendTransactionSummaryEmail(member, tx);
    } else {
      console.warn(`⚠️ No email on file for ${member.name} — skipping transaction summary email.`);
    }

    // ✅ If tier changed and it's an upgrade, send tier upgrade email
    if (member.email && member.tier !== oldTier) {
      console.log(`🎉 ${member.name} upgraded from ${oldTier} to ${member.tier}`);
      await sendTierUpgradeEmail(member);
    }

    alert(`✅ Transaction added: Rp${amount.toLocaleString()}${cashback ? ` (+Rp${cashback.toLocaleString()} cashback)` : ""}`);
    location.reload();

  } catch (err) {
    console.error("❌ Failed to add transaction:", err);
    alert("Failed to add transaction. Please try again.");
  }
}

// Fetches a single member and renders their details
async function loadMemberDetails(memberId) {
  const container = document.getElementById("memberDetails");
  if (!container) return;

  let cacheHit = false;
  const cache = sessionStorage.getItem("selectedMember");
  if (cache) {
    try {
      const parsed = JSON.parse(cache);
      if (parsed.data.id === memberId && Date.now() - parsed.ts < MEMBER_CACHE_TTL) {
        await renderDetails(parsed.data);
        cacheHit = true;
      }
    } catch (err) {
      console.warn("⚠️ Session cache parse failed:", err);
    }
  }

  if (!cacheHit) {
    try {
      const doc = await db.collection("members").doc(memberId).get();
      if (!doc.exists) {
        container.innerHTML = "<p>Member not found.</p>";
        return;
      }
      const member = { id: doc.id, ...doc.data() };
      await renderDetails(member);
    } catch (err) {
      console.error("loadMemberDetails error:", err);
      if (!cacheHit) {
        container.innerHTML = `<p>Error loading details: ${err.message}</p>`;
      }
    }
  }
}



// Wire‑up for details.html
window.wireDetailsUI = function() {
  const params = new URLSearchParams(location.search);
  const memberId = params.get("id");
  const container = document.getElementById("memberDetails");
  if (!container || !memberId) {
    container.innerHTML = "<p>Member not found.</p>";
    return;
  }

  // Step 1: Try sessionStorage cache for instant paint
  const cache = sessionStorage.getItem("selectedMember");
  if (cache) {
    try {
      const parsed = JSON.parse(cache);
      if (parsed.data.id === memberId && Date.now() - parsed.ts < MEMBER_CACHE_TTL) {
        renderDetails(parsed.data);
      }
    } catch {}
  }

  // Step 2: Live Firestore listener for real-time updates
  loadTierSettingsFromCloud(); // still load settings once
  db.collection("members").doc(memberId)
    .onSnapshot(doc => {
      if (!doc.exists) {
        container.innerHTML = "<p>Member not found.</p>";
        return;
      }
      const member = { id: doc.id, ...doc.data() };
      renderDetails(member); // re-render on every change
    }, err => {
      console.error("Details live load error:", err);
      container.innerHTML = `<p>Error loading member: ${err.message}</p>`;
    });
};

// ---------- Bootstrap ----------
document.addEventListener("DOMContentLoaded", () => {
  const chooseBtn = document.getElementById("chooseModeBtn");
  const modal = document.getElementById("modeModal");
  const closeBtn = document.getElementById("closeModeModal");
  const options = Array.from(document.querySelectorAll(".modeOption") || []);

  const PASSWORDS = { admin: "123456", kafe: "kafe", reader: "mille123" };

  function hash(str) { return btoa(unescape(encodeURIComponent(str))); }

  function setModeToken(mode, tokenObj) { localStorage.setItem(`${mode}Token`, JSON.stringify(tokenObj)); }
  function getModeToken(mode) {
    try { return JSON.parse(localStorage.getItem(`${mode}Token`) || "null"); } catch (e) { return null; }
  }

  function verifyMode(mode) {
    const tok = getModeToken(mode);
    if (!tok) return false;
    if (tok.type === "server") return tok.exp && Date.now() < tok.exp;
    if (tok.type === "client") return tok.value === hash(PASSWORDS[mode]);
    return false;
  }

  // Expose verified flags
  window.isAdmin  = verifyMode("admin");
  window.isKafe   = verifyMode("kafe");
  window.isReader = verifyMode("reader");

  if (chooseBtn) chooseBtn.addEventListener("click", () => modal?.style.setProperty("display","flex"));
  if (closeBtn)  closeBtn.addEventListener("click", () => modal?.style.setProperty("display","none"));

  options.forEach(opt => {
    opt.addEventListener("click", async () => {
      const mode = opt.dataset.mode;
      ["admin","kafe","reader"].forEach(m => localStorage.removeItem(`${m}Token`));

      const pwd = prompt(`Enter ${mode} password:`);
      if (!pwd) return;

      // Try server validation first
      try {
        const res = await fetch("/.netlify/functions/validateMode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, password: pwd })
        });
        if (res.ok) {
          const data = await res.json();
          setModeToken(mode, {
            type: "server",
            value: data.token,
            exp: Date.now() + (data.ttlSeconds || 600) * 1000
          });
          localStorage.setItem("mode", mode);
          alert(`Mode set to ${mode} (server-validated)`);
          modal?.style.setProperty("display","none");
          return location.reload();
        }
      } catch (e) {
        console.warn("Server validation failed, falling back to client-side check", e);
      }

      // Fallback check
      if (pwd !== PASSWORDS[mode]) {
        alert("❌ Incorrect password. Access denied.");
        return;
      }
      setModeToken(mode, { type: "client", value: hash(pwd) });
      localStorage.setItem("mode", mode);
      alert(`Mode set to ${mode}`);
      modal?.style.setProperty("display","none");
      location.reload();
    });
  });

  // Wire page UIs
  if (document.getElementById("memberList"))  typeof wireListUI === "function"   ? wireListUI()   : console.error("wireListUI missing");
  if (document.getElementById("memberDetails")) typeof wireDetailsUI === "function"? wireDetailsUI(): console.error("wireDetailsUI missing");

  // Apply restrictions
  if (window.isKafe && !window.isAdmin) {
    document.getElementById("manualInputSection")?.style.setProperty("display","none");
    document.querySelectorAll(".deleteBtn").forEach(btn => btn.remove());
    document.getElementById("settingsLink")?.style.setProperty("display","none");
  }
  if (window.isReader) {
    document.querySelectorAll(".addTransactionBtn, .deleteBtn").forEach(btn => btn.remove());
  }
  if (window.isAdmin || window.isKafe) {
    document.getElementById("addBtn")?.addEventListener("click", () => location.href = "add.html");
    document.getElementById("settingsBtn")?.addEventListener("click", () => location.href = "settings.html");
    document.getElementById("dashboardBtn")?.addEventListener("click", () => location.href = "dashboard.html");
  }
});
