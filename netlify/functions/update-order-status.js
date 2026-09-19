const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

if (getApps().length === 0) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

const db = getFirestore();
const auth = getAuth();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function verifyAdmin(idToken) {
  if (!idToken) return false;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    const snap = await db.collection("admins").doc(decoded.uid).get();
    return snap.exists;
  } catch {
    return false;
  }
}

function getDiscountByTier(tier) {
  if (!tier) return 0;
  const t = String(tier).trim().toLowerCase();
  switch (t) {
    case "classic": return 0.0;
    case "bronze":  return 0.10;
    case "silver":  return 0.15;
    case "gold":    return 0.20;
    default:        return 0.0;
  }
}

function normalizeDiscountRate(val) {
  if (val == null) return 0;
  const n = Number(val);
  if (Number.isNaN(n)) return 0;
  const normalized = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

function toProperTier(tier) {
  if (!tier) return "Bronze";
  const str = tier.toString().trim().toLowerCase();
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function recalcSinceUpgrade(transactions, upgradeDate) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const upgradeDt = upgradeDate ? new Date(upgradeDate) : null;

  let yearlySinceUpgrade = 0;
  let monthlySinceUpgrade = 0;

  (transactions || []).forEach(tx => {
    const d = new Date(tx.date);
    if (d.getFullYear() === currentYear) {
      if (!upgradeDt || d > upgradeDt) {
        yearlySinceUpgrade += tx.amount;
        if (d.getMonth() === currentMonth) monthlySinceUpgrade += tx.amount;
      }
    }
  });

  return { monthlySinceUpgrade, yearlySinceUpgrade };
}

function recalcTier(member, t) {
  const thresholds = t?.thresholds || t || {};
  const bronzeToSilverMonth = thresholds.bronzeToSilverMonth ?? 500000;
  const bronzeToSilverYear  = thresholds.bronzeToSilverYear  ?? 1200000;
  const silverStayYear      = thresholds.silverStayYear      ?? 500000;
  const silverToGoldMonth   = thresholds.silverToGoldMonth   ?? 1250000;
  const silverToGoldYear    = thresholds.silverToGoldYear    ?? 4000000;
  const goldStayYear        = thresholds.goldStayYear        ?? 2000000;

  const currentTier = toProperTier(member.tier);
  const monthSpend  = member.monthlySinceUpgrade ?? 0;
  const yearSpend   = member.yearlySinceUpgrade ?? 0;

  let createdYear = null;
  if (member.createdAt) {
    const createdDate = member.createdAt.toDate ? member.createdAt.toDate() : new Date(member.createdAt);
    if (createdDate instanceof Date && !isNaN(createdDate)) {
      createdYear = createdDate.getFullYear();
    }
  }
  const thisYear = new Date().getFullYear();
  const isNewThisYear = createdYear === thisYear;

  let newTier = currentTier;

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
    } else if (!isNewThisYear && yearSpend < silverStayYear) {
      newTier = "Bronze";
    }
  } else if (currentTier === "Gold") {
    if (!isNewThisYear && yearSpend < goldStayYear) {
      newTier = "Silver";
    }
  }

  member.tier = newTier;
  return member;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  try {
    const authHeader = event.headers.authorization || "";
    const idToken = authHeader.replace("Bearer ", "");

    const isAdmin = await verifyAdmin(idToken);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Unauthorized: admin access required" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { orderId, targetKitchenStatus } = body;

    if (!orderId || !targetKitchenStatus) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "orderId and targetKitchenStatus are required" }),
      };
    }

    const validStatuses = ["preparing", "served", "cancelled"];
    if (!validStatuses.includes(targetKitchenStatus)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Invalid status" }),
      };
    }

    const orderRef = db.collection("orders").doc(orderId);
    const ratesDocRef = db.collection("settings").doc("cashbackRates");
    const tierSettingsRef = db.collection("settings").doc("tierThresholds");

    await db.runTransaction(async (t) => {
      const orderSnap = await t.get(orderRef);
      if (!orderSnap.exists) throw new Error("Order not found");
      const order = orderSnap.data();

      const memberId = order.memberId || null;
      const memberPhone = order.memberPhone || null;
      const memberRef = memberId ? db.collection("members").doc(memberId) : null;
      const memberSnap = memberRef ? await t.get(memberRef) : null;

      let ratesDoc = null;
      try { ratesDoc = await t.get(ratesDocRef); } catch (_) {}
      const rates = ratesDoc?.exists ? (ratesDoc.data() || {}) : {};

      let thresholdsDoc = null;
      try { thresholdsDoc = await t.get(tierSettingsRef); } catch (_) {}
      const tierSettings = thresholdsDoc?.exists ? (thresholdsDoc.data() || {}) : {};

      const alreadyRecorded = !!order.loyaltyRecorded;
      const total = Number(order.total) || 0;
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];

      // CANCELLED case
      if (targetKitchenStatus === "cancelled" && alreadyRecorded && order.loyaltyTxId && memberRef && memberSnap?.exists) {
        const member = memberSnap.data();
        const txList = Array.isArray(member.transactions) ? member.transactions : [];

        const filteredTxs = txList.filter(tx =>
          !(tx.date?.startsWith(todayStr) && tx.amount === total && tx.note?.includes("POS: Served order"))
        );

        const cashbackToRemove = txList
          .filter(tx => tx.date?.startsWith(todayStr) && tx.amount === total && tx.cashback)
          .reduce((sum, tx) => sum + Number(tx.cashback || 0), 0);

        const spendingToRemove = txList
          .filter(tx => tx.date?.startsWith(todayStr) && tx.amount === total)
          .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

        const { monthlySinceUpgrade, yearlySinceUpgrade } = recalcSinceUpgrade(filteredTxs, member.upgradeDate);
        const updatedMember = { ...member, transactions: filteredTxs, monthlySinceUpgrade, yearlySinceUpgrade };
        recalcTier(updatedMember, tierSettings);

        t.update(memberRef, {
          transactions: filteredTxs,
          redeemablePoints: Math.max(0, (member.redeemablePoints || 0) - cashbackToRemove),
          spendingSinceUpgrade: Math.max(0, (member.spendingSinceUpgrade || 0) - spendingToRemove),
          monthlySinceUpgrade,
          yearlySinceUpgrade,
          tier: updatedMember.tier,
        });

        const txRef = db.collection("loyalty_transactions").doc(order.loyaltyTxId);
        t.delete(txRef);

        t.update(orderRef, {
          kitchenStatus: targetKitchenStatus,
          loyaltyRecorded: false,
          loyaltyTxId: null,
        });
        return;
      }

      // SERVED case
      if (targetKitchenStatus === "served" && !alreadyRecorded && (memberId || memberPhone)) {
        const member = memberSnap?.data() || {};
        const tierRaw = (member.tier || "Bronze").toString().trim();
        const tier = tierRaw.charAt(0).toUpperCase() + tierRaw.slice(1).toLowerCase();

        const isBirthday = !!member.birthdate && (() => {
          const b = new Date(member.birthdate);
          return b.getMonth() === now.getMonth() && b.getDate() === now.getDate();
        })();

        const goldRate = Number(rates.goldCashbackRate ?? 5);
        const silverRate = Number(rates.silverCashbackRate ?? 5);
        const birthdayGoldRate = Number(rates.birthdayGoldCashbackRate ?? 30);
        const goldCap = Number(rates.goldDailyCashbackCap ?? 30000);
        const silverCap = Number(rates.silverDailyCashbackCap ?? 15000);

        const rate =
          tier === "Gold" && isBirthday ? birthdayGoldRate :
          tier === "Gold" ? goldRate :
          tier === "Silver" ? silverRate : 0;

        const cap = tier === "Gold" ? goldCap : tier === "Silver" ? silverCap : 0;

        const txList = Array.isArray(member.transactions) ? member.transactions : [];
        const todayCashback = txList
          .filter(tx => tx.date?.startsWith(todayStr) && tx.cashback)
          .reduce((sum, tx) => sum + Number(tx.cashback || 0), 0);

        let cashback = Math.floor((total * rate) / 100);
        if (cap > 0 && todayCashback + cashback > cap) {
          cashback = Math.max(0, cap - todayCashback);
        }

        const memberTx = {
          date: now.toISOString(),
          amount: total,
          cashback,
          note: (cap > 0 && todayCashback + cashback === cap)
            ? `Cashback capped at Rp${cap.toLocaleString()} today`
            : "Recorded from POS: Served order",
        };

        const txRef = db.collection("loyalty_transactions").doc();
        const loyaltyTx = {
          txId: txRef.id,
          orderId: orderRef.id,
          memberPhone: memberPhone || null,
          memberId: memberRef ? memberRef.id : null,
          memberName: order.guestName || null,
          date: order.date || todayStr,
          timestamp: FieldValue.serverTimestamp(),
          total,
          pointsEarned: Math.floor(total / 10000),
          source: "staff-served",
          table: order.table || null,
        };
        t.set(txRef, loyaltyTx);

        if (memberRef && memberSnap?.exists) {
          const updatedTxs = txList.concat(memberTx);
          const newRedeemable = Math.max(0, (member.redeemablePoints || 0) + cashback);
          const newSpending = Math.max(0, (member.spendingSinceUpgrade || 0) + total);

          const { monthlySinceUpgrade, yearlySinceUpgrade } = recalcSinceUpgrade(updatedTxs, member.upgradeDate);
          const updatedMember = { ...member, transactions: updatedTxs, monthlySinceUpgrade, yearlySinceUpgrade };
          recalcTier(updatedMember, tierSettings);

          t.update(memberRef, {
            transactions: updatedTxs,
            redeemablePoints: newRedeemable,
            spendingSinceUpgrade: newSpending,
            monthlySinceUpgrade,
            yearlySinceUpgrade,
            tier: updatedMember.tier,
          });
        }

        t.update(orderRef, {
          kitchenStatus: targetKitchenStatus,
          loyaltyRecorded: true,
          loyaltyTxId: txRef.id,
        });
        return;
      }

      // Default: just update kitchenStatus
      t.update(orderRef, { kitchenStatus: targetKitchenStatus });
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error("update-order-status error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
