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
    const { voucherCode, orderId, subtotal } = body;

    if (!voucherCode || !orderId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Voucher code and orderId are required" }),
      };
    }

    const code = voucherCode.trim().toUpperCase();

    // Find voucher
    const voucherSnap = await db.collection("vouchers").where("code", "==", code).limit(1).get();
    if (voucherSnap.empty) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Invalid voucher code" }),
      };
    }

    const voucherDoc = voucherSnap.docs[0];
    const voucherRef = db.collection("vouchers").doc(voucherDoc.id);
    const voucherData = voucherDoc.data();

    // Get order
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Order not found" }),
      };
    }

    const orderData = orderSnap.data();

    // Check if voucher already applied
    if (orderData.voucherId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "A voucher is already applied to this order" }),
      };
    }

    // Use server-side subtotal from the order, not from the client
    const orderSubtotal = Number(orderData.subtotal) || 0;

    // Check daily limit atomically
    await db.runTransaction(async (tx) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const redemptionSnap = await tx.get(
        voucherRef.collection("redemptions")
          .where("timestamp", ">=", today)
          .where("timestamp", "<", tomorrow)
      );

      if (voucherData.limitPerDay && redemptionSnap.size >= voucherData.limitPerDay) {
        throw new Error("DAILY_LIMIT_REACHED");
      }

      // Calculate discount server-side
      let orderDiscount = 0;
      if (voucherData.type === "percent") {
        orderDiscount = Math.floor(orderSubtotal * (Number(voucherData.value) / 100));
      } else if (voucherData.type === "fixed") {
        orderDiscount = Number(voucherData.value);
      }

      // Cap discount at subtotal
      orderDiscount = Math.min(orderDiscount, orderSubtotal);

      const redemptionDocRef = voucherRef.collection("redemptions").doc(orderId);
      tx.set(redemptionDocRef, {
        timestamp: FieldValue.serverTimestamp(),
        table: orderData.table || "",
        guestName: orderData.guestName || "",
        orderId,
      });

      // Recalculate totals
      const tax = Number(orderData.tax) || 0;
      const deliveryFee = Number(orderData.deliveryFee) || 0;
      const newTotal = orderSubtotal - orderDiscount + tax;
      const newGrandTotal = newTotal + deliveryFee;

      tx.update(orderRef, {
        voucherId: voucherDoc.id,
        discount: orderDiscount,
        total: newTotal,
        grandTotal: newGrandTotal,
      });
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: `Voucher ${code} applied`,
      }),
    };
  } catch (err) {
    if (err.message === "DAILY_LIMIT_REACHED") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Voucher daily limit reached" }),
      };
    }
    console.error("redeemVoucher error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to apply voucher" }),
    };
  }
};
