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
    const { code, type, value, limitPerDay, idToken } = body;

    if (!idToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Authentication required" }),
      };
    }

    // Verify caller is admin
    const admin = require("firebase-admin");
    let callerUid = null;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      callerUid = decoded.uid;
    } catch (e) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Invalid authentication" }),
      };
    }

    const adminSnap = await db.collection("admins").doc(callerUid).get();
    if (!adminSnap.exists) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Not authorized as admin" }),
      };
    }

    // Validate inputs
    const voucherCode = (code || "").trim().toUpperCase();
    if (!voucherCode) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Voucher code is required" }),
      };
    }

    if (!["percent", "fixed"].includes(type)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Invalid voucher type" }),
      };
    }

    const voucherValue = parseInt(value, 10);
    if (!voucherValue || voucherValue <= 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Value must be a positive number" }),
      };
    }

    if (type === "percent" && voucherValue > 100) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Percent value cannot exceed 100" }),
      };
    }

    const limit = parseInt(limitPerDay, 10) || 0;

    // Check for duplicate code
    const existingSnap = await db.collection("vouchers").where("code", "==", voucherCode).limit(1).get();
    if (!existingSnap.empty) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Voucher code already exists" }),
      };
    }

    await db.collection("vouchers").add({
      code: voucherCode,
      type,
      value: voucherValue,
      used: "unlimited",
      limitPerDay: limit,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, message: `Voucher ${voucherCode} created` }),
    };
  } catch (err) {
    console.error("createVoucher error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to create voucher" }),
    };
  }
};
