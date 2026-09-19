const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
    const body = JSON.parse(event.body || "{}");
    const { orderId, targetStatus, idToken } = body;

    if (!orderId || !targetStatus) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Missing orderId or targetStatus" }),
      };
    }

    const validStatuses = ["preparing", "served", "cancelled", "paid", "received"];
    if (!validStatuses.includes(targetStatus)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Invalid status" }),
      };
    }

    // Verify caller is admin using Firebase Admin
    const admin = require("firebase-admin");
    let callerUid = null;
    if (idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        callerUid = decoded.uid;
      } catch (e) {
        // Token invalid — continue as anonymous (will be rejected if not admin)
      }
    }

    let isAuthorized = false;
    if (callerUid) {
      const adminSnap = await db.collection("admins").doc(callerUid).get();
      isAuthorized = adminSnap.exists;
    }

    // For "paid" and "received" (Mille staff), also check admin
    if (!isAuthorized) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Not authorized" }),
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
      if (targetStatus === "cancelled" && alreadyRecorded && order.loyaltyTxId && memberRef && memberSnap?.exists) {
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
          kitchenStatus: targetStatus,
          loyaltyRecorded: false,
          loyaltyTxId: null,
        });
        return;
      }

      // SERVED case
      if (targetStatus === "served" && !alreadyRecorded && (memberId || memberPhone)) {
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
          kitchenStatus: targetStatus,
          loyaltyRecorded: true,
          loyaltyTxId: txRef.id,
        });
        return;
      }

      // PAID case (Mille staff marking as paid)
      if (targetStatus === "paid") {
        t.update(orderRef, {
          milleStatus: "paid",
          paymentStatus: "success",
          kitchenStatus: order.kitchenStatus || "pending",
        });
        return;
      }

      // RECEIVED case (Mille staff marking as received)
      if (targetStatus === "received") {
        t.update(orderRef, {
          milleStatus: "received",
        });
        return;
      }

      // Default: just update kitchenStatus
      t.update(orderRef, { kitchenStatus: targetStatus });
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, message: `Order updated to ${targetStatus}` }),
    };
  } catch (err) {
    console.error("updateOrderStatus error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to update order status" }),
    };
  }
};
