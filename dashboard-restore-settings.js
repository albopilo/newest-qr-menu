// ==============================
// dashboard-restore-settings.js
// Powers: settings.html, dashboard.html, restore section
// ==============================

// --- Firebase init ---
(function initFirebase() {
  const cfg = {
    apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
    authDomain: "e-loyalty-12563.firebaseapp.com",
    projectId: "e-loyalty-12563",
    storageBucket: "e-loyalty-12563.appspot.com",
    messagingSenderId: "3887061029",
    appId: "1:3887061029:web:f9c238731d7e6dd5fb47cc",
    measurementId: "G-966P8W06W2"
  };
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  window.db = window.db || firebase.firestore();
})();

// --- Firestore refs ---
const thresholdsRef = db.collection("settings").doc("tierThresholds");
const cashbackRef   = db.collection("settings").doc("cashbackRates");

// ================= SETTINGS PAGE =================
async function loadTierSettings() {
  const msg = document.getElementById("tierSaveMsg");
  msg.textContent = "Loading…";
  try {
    const snap = await thresholdsRef.get();
    if (snap.exists) {
      const t = snap.data() || {};
      document.getElementById("monthlyThreshold").value   = t.bronzeToSilverMonth ?? 500000;
      document.getElementById("yearlyThreshold").value    = t.bronzeToSilverYear  ?? 1200000;
      document.getElementById("maintainSilver").value     = t.silverStayYear      ?? 500000;
      document.getElementById("silverToGoldMonth").value  = t.silverToGoldMonth   ?? 1250000;
      document.getElementById("silverToGoldYear").value   = t.silverToGoldYear    ?? 4000000;
      document.getElementById("maintainGoldYear").value   = t.goldStayYear        ?? 2000000;
      msg.textContent = "Loaded.";
    } else {
      msg.textContent = "No saved thresholds.";
    }
  } catch (err) {
    console.error("Tier load error:", err);
    msg.textContent = "⚠ Failed to load";
  }
}

async function loadCashbackSettings() {
  const msg = document.getElementById("cashbackSaveMsg");
  msg.textContent = "Loading…";
  try {
    const snap = await cashbackRef.get();
    if (snap.exists) {
      const c = snap.data() || {};
      document.getElementById("silverRate").value   = c.silverCashbackRate       ?? 5;
      document.getElementById("goldRate").value     = c.goldCashbackRate         ?? 5;
      document.getElementById("birthdayGold").value = c.birthdayGoldCashbackRate ?? 30;
      document.getElementById("silverCap").value    = c.silverDailyCashbackCap   ?? 15000;
      document.getElementById("goldCap").value      = c.goldDailyCashbackCap     ?? 30000;
      msg.textContent = "Loaded.";
    } else {
      msg.textContent = "No saved cashback.";
    }
  } catch (err) {
    console.error("Cashback load error:", err);
    msg.textContent = "⚠ Failed to load";
  }
}

async function saveTierSettings() {
  const msg = document.getElementById("tierSaveMsg");
  msg.textContent = "Saving…";
  const payload = {
    bronzeToSilverMonth: parseInt(document.getElementById("monthlyThreshold").value)   || 0,
    bronzeToSilverYear:  parseInt(document.getElementById("yearlyThreshold").value)    || 0,
    silverStayYear:      parseInt(document.getElementById("maintainSilver").value)     || 0,
    silverToGoldMonth:   parseInt(document.getElementById("silverToGoldMonth").value)  || 0,
    silverToGoldYear:    parseInt(document.getElementById("silverToGoldYear").value)   || 0,
    goldStayYear:        parseInt(document.getElementById("maintainGoldYear").value)   || 0
  };
  try {
    await thresholdsRef.set(payload, { merge: true });
    msg.textContent = "✅ Saved.";
  } catch (err) {
    console.error("Tier save error:", err);
    msg.textContent = "⚠ Failed to save";
  }
}

async function saveCashbackSettings() {
  const msg = document.getElementById("cashbackSaveMsg");
  msg.textContent = "Saving…";
  const payload = {
    silverCashbackRate:       parseInt(document.getElementById("silverRate").value)   || 0,
    goldCashbackRate:         parseInt(document.getElementById("goldRate").value)     || 0,
    birthdayGoldCashbackRate: parseInt(document.getElementById("birthdayGold").value) || 0,
    silverDailyCashbackCap:   parseInt(document.getElementById("silverCap").value)    || 0,
    goldDailyCashbackCap:     parseInt(document.getElementById("goldCap").value)      || 0
  };
  try {
    await cashbackRef.set(payload, { merge: true });
    msg.textContent = "✅ Saved.";
  } catch (err) {
    console.error("Cashback save error:", err);
    msg.textContent = "⚠ Failed to save";
  }
}

// ================= RECALC TIERS =================
async function recalcAllTiers() {
  const msg = document.getElementById("recalcMsg");
  msg.textContent = "Preparing…";

  const thrSnap = await thresholdsRef.get();
  const t = thrSnap.exists ? thrSnap.data() : {};
  const thresholds = {
    bronzeToSilverMonth: t.bronzeToSilverMonth ?? 500000,
    bronzeToSilverYear:  t.bronzeToSilverYear  ?? 1200000,
    silverStayYear:      t.silverStayYear      ?? 500000,
    silverToGoldMonth:   t.silverToGoldMonth   ?? 1250000,
    silverToGoldYear:    t.silverToGoldYear    ?? 4000000,
    goldStayYear:        t.goldStayYear        ?? 2000000
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let processed = 0;
  let lastDoc = null;
  msg.textContent = "Recalculating…";

  while (true) {
    let q = db.collection("members").orderBy("nameLower").limit(400);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach(doc => {
      const m = doc.data() || {};
      const id = doc.id;
      const txs = Array.isArray(m.transactions) ? m.transactions : [];
      let monthlySinceUpgrade = 0;
      let yearlySinceUpgrade = 0;
      const upgradeDate = m.upgradeDate ? new Date(m.upgradeDate) : null;

      txs.forEach(tx => {
        const d = new Date(tx.date);
        if (d.getFullYear() === currentYear) {
          if (!upgradeDate || d > upgradeDate) {
            yearlySinceUpgrade += tx.amount || 0;
            if (d.getMonth() === currentMonth) monthlySinceUpgrade += tx.amount || 0;
          }
        }
      });

      let createdYear = null;
      if (m.createdAt) {
        const cd = m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt);
        if (cd instanceof Date && !isNaN(cd)) createdYear = cd.getFullYear();
      }
      const isNewThisYear = createdYear === currentYear;

      const currentTier = ((m.tier || "Bronze") + "").trim().toLowerCase();
      let newTier = currentTier;

      if (currentTier === "bronze") {
        if (monthlySinceUpgrade >= thresholds.bronzeToSilverMonth || yearlySinceUpgrade >= thresholds.bronzeToSilverYear) {
          newTier = "silver";
        }
      } else if (currentTier === "silver") {
        if (monthlySinceUpgrade >= thresholds.silverToGoldMonth || yearlySinceUpgrade >= thresholds.silverToGoldYear) {
          newTier = "gold";
        } else if (!isNewThisYear && yearlySinceUpgrade < thresholds.silverStayYear) {
          newTier = "bronze";
        }
      } else if (currentTier === "gold") {
        if (!isNewThisYear && yearlySinceUpgrade < thresholds.goldStayYear) {
          newTier = "silver";
        }
      }

      const properTier = newTier.charAt(0).toUpperCase() + newTier.slice(1).toLowerCase();
      const update = {
        monthlySinceUpgrade,
        yearlySinceUpgrade,
        tier: properTier
      };

      // Reset counters on upgrade
      if (newTier !== currentTier && (currentTier === "bronze" || currentTier === "silver")) {
        update.upgradeDate = now.toISOString();
        update.monthlySinceUpgrade = 0;
        update.yearlySinceUpgrade = 0;
      }

      batch.update(db.collection("members").doc(id), update);
    });

    await batch.commit();
    processed += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];
    msg.textContent = `Processed ${processed} members…`;
  }

  msg.textContent = `✅ Done. Recalculated ${processed} members.`;
  alert(`✅ Recalculated ${processed} members.`);
}

// ================= BACKUP / RESTORE =================
async function backupMembers() {
  const msg = document.getElementById("backupRestoreMsg");
  msg.textContent = "Building backup…";
  try {
    const snap = await db.collection("members").get();
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    msg.textContent = "✅ Backup ready.";
  } catch (err) {
    console.error("Backup failed:", err);
    msg.textContent = "⚠ Backup failed";
  }
}

async function restoreMembersFromFile(file) {
  const msg = document.getElementById("backupRestoreMsg");
  msg.textContent = "Restoring…";
  try {
    const text = await file.text();
    const members = JSON.parse(text);
    if (!Array.isArray(members)) throw new Error("Invalid backup format.");

    const chunk = (arr, size) => {
      const res = [];
      for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
      return res;
    };
    const chunks = chunk(members, 400);
    let done = 0;
    for (const part of chunks) {
      const batch = db.batch();
      part.forEach(m => {
        if (!m.id) return;
        batch.set(db.collection("members").doc(m.id), m, { merge: true });
      });
      await batch.commit();
      done += part.length;
      msg.textContent = `Restored ${done}/${members.length}…`;
    }
    msg.textContent = `✅ Restore complete (${members.length}).`;
    alert(`✅ Restored ${members.length} members.`);
  } catch (err) {
    console.error("Restore failed:", err);
    msg.textContent = "⚠ Restore failed";
  }
}

// ================= DASHBOARD PAGE =================
const fmtRp = n => "Rp" + (Number(n || 0)).toLocaleString("id-ID");
const by = key => (a,b) => (a[key] > b[key] ? -1 : a[key] < b[key] ? 1 : 0);

async function fetchMembers() {
  const snap = await db.collection("members").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function computeYearSpend(member, year) {
  const txs = Array.isArray(member.transactions) ? member.transactions : [];
  return txs.reduce((sum, tx) => {
    const d = new Date(tx.date);
    return d.getFullYear() === year ? sum + (tx.amount || 0) : sum;
  }, 0);
}

let tierChartInstance = null;
function renderTierChart(counts) {
  const ctx = document.getElementById("tierChart").getContext("2d");
  if (tierChartInstance) tierChartInstance.destroy();
  tierChartInstance = new Chart(ctx, {
    type: "pie",
    data: {
      labels: ["Bronze", "Silver", "Gold"],
      datasets: [{
        data: [counts.Bronze || 0, counts.Silver || 0, counts.Gold || 0],
        backgroundColor: ["#cd7f32", "#c0c0c0", "#ffd700"],
        borderColor: "#0b1220",
        borderWidth: 2
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });
  document.getElementById("tierChartLegend").innerHTML = `
    <span class="tier-dot tier-bronze"></span> Bronze: ${counts.Bronze || 0} &nbsp;&nbsp;
    <span class="tier-dot tier-silver"></span> Silver: ${counts.Silver || 0} &nbsp;&nbsp;
    <span class="tier-dot tier-gold"></span> Gold: ${counts.Gold || 0}
  `;
}

function renderTopMembers(members, year, topN = 5) {
  const ranked = members.map(m => ({
    id: m.id,
    name: m.name || "(Unnamed)",
    tier: (m.tier || "Bronze").trim(),
    spend: computeYearSpend(m, year)
  })).sort(by("spend")).slice(0, topN);

  const root = document.getElementById("topMembers");
  if (!ranked.length) {
    root.innerHTML = '<div class="muted">No data yet.</div>';
    return;
  }

  root.innerHTML = ranked.map((m, i) => {
    const tierClass = "tier-" + m.tier.toLowerCase();
    return `
      <div class="item">
        <div>
          <span class="tier-dot ${tierClass}"></span>
          <a class="name" href="details.html?id=${m.id}">${i + 1}. ${m.name}</a>
          <span class="meta">(${m.tier})</span>
        </div>
        <div class="mono">${fmtRp(m.spend)}</div>
      </div>
    `;
  }).join("");
}

function renderActivityFeed(members, limit = 20) {
  const events = [];
  for (const m of members) {
    const txs = Array.isArray(m.transactions) ? m.transactions : [];
    for (const tx of txs) {
      if (!tx?.date || !tx?.amount) continue;
      const d = new Date(tx.date);
      if (isNaN(d)) continue;
      events.push({ name: m.name || "(Unnamed)", date: d, amount: tx.amount });
    }
  }
  events.sort((a, b) => b.date - a.date);
  const recent = events.slice(0, limit);

  const root = document.getElementById("activityFeed");
  if (!recent.length) {
    root.innerHTML = '<div class="muted">No recent activity.</div>';
    return;
  }

  root.innerHTML = recent.map(e => `
    <div class="item">
      <div>
        <span class="name">${e.name}</span>
        <span class="meta"> • ${e.date.toLocaleString()}</span>
      </div>
      <div class="mono">${fmtRp(e.amount)}</div>
    </div>
  `).join("");
}

async function loadDashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const tsEl = document.getElementById("lastUpdated");
  tsEl.textContent = "Loading…";

  try {
    const members = await fetchMembers();

    const counts = { Bronze: 0, Silver: 0, Gold: 0 };
    for (const m of members) {
      const t = (m.tier || "Bronze").trim();
      if (counts[t] !== undefined) counts[t]++;
    }

    renderTierChart(counts);
    renderTopMembers(members, year, 5);
    renderActivityFeed(members, 20);

    tsEl.textContent = "Updated " + now.toLocaleTimeString();
  } catch (err) {
    console.error("Dashboard load failed:", err);
    tsEl.textContent = "Failed to load.";
    document.getElementById("topMembers").innerHTML = '<div class="muted">Failed to load.</div>';
    document.getElementById("activityFeed").innerHTML = '<div class="muted">Failed to load.</div>';
  }
}

// ================= PAGE DETECTION & WIRE-UP =================
document.addEventListener("DOMContentLoaded", () => {
  // SETTINGS page
  if (document.getElementById("tierSaveMsg")) {
    loadTierSettings();
    loadCashbackSettings();

    document.getElementById("saveTierBtn")
      .addEventListener("click", saveTierSettings);
    document.getElementById("saveCashbackBtn")
      .addEventListener("click", saveCashbackSettings);

    document.getElementById("recalcTiersBtn")
      .addEventListener("click", () => {
        if (confirm("Recalculate tiers for ALL members now?")) {
          recalcAllTiers();
        }
      });

    document.getElementById("backupMembersBtn")
      .addEventListener("click", backupMembers);

    const restoreInput = document.getElementById("restoreFileInput");
    document.getElementById("restoreBtn")
      .addEventListener("click", () => restoreInput.click());
    restoreInput.addEventListener("change", e => {
      const f = e.target.files?.[0];
      if (f) restoreMembersFromFile(f);
      e.target.value = "";
    });
  }

  // DASHBOARD page
  if (document.getElementById("tierChart")) {
    document.getElementById("refreshBtn")
      .addEventListener("click", loadDashboard);
    loadDashboard();
  }
});