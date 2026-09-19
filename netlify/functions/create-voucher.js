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
    const { code, type, value, limitPerDay } = body;

    if (!code || !value) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Code and value are required" }),
      };
    }

    const validType = type === "percent" || type === "fixed" ? type : "percent";
    const numValue = Math.max(0, Math.floor(Number(value) || 0));
    const numLimit = Math.max(0, Math.floor(Number(limitPerDay) || 0));

    const snap = await db.collection("vouchers").where("code", "==", code).limit(1).get();
    if (!snap.empty) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Voucher code already exists" }),
      };
    }

    await db.collection("vouchers").add({
      code,
      type: validType,
      value: numValue,
      used: "unlimited",
      limitPerDay: numLimit,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, message: `Voucher ${code} created` }),
    };
  } catch (err) {
    console.error("create-voucher error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
