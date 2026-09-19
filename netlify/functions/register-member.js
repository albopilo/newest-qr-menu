const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

if (getApps().length === 0) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

const db = getFirestore();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function normalizePhone(input) {
  if (!input) return "";
  return String(input)
    .replace(/[^\d+]/g, "")
    .replace(/^\+?62/, "0")
    .replace(/^0+/, "0");
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
    const { name, email, phone, birthdate } = body;

    if (!name || !email || !phone || !birthdate) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "All fields are required" }),
      };
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Invalid email address" }),
      };
    }

    const normalizedPhone = normalizePhone(phone);

    // Check for duplicates
    const phoneSnap = await db.collection("members").where("phone", "==", normalizedPhone).limit(1).get();
    if (!phoneSnap.empty) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "This phone number is already registered" }),
      };
    }

    const emailSnap = await db.collection("members").where("email", "==", email.toLowerCase()).limit(1).get();
    if (!emailSnap.empty) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "This email address is already registered" }),
      };
    }

    // Use a random ID instead of Date.now() for unpredictability
    const newId = db.collection("members").doc().id;

    const memberDoc = {
      birthdate,
      email: email.toLowerCase(),
      id: newId,
      ktp: null,
      lastRoomUpgrade: null,
      monthlySinceUpgrade: 0,
      name,
      nameLower: name.toLowerCase(),
      phone: normalizedPhone,
      redeemablePoints: 0,
      roomUpgradeHistory: [],
      spendingSinceUpgrade: 0,
      tier: "Classic",
      upgradeDate: null,
      welcomed: true,
      yearlySinceUpgrade: 0,
      createdAt: FieldValue.serverTimestamp(),
      discountRate: 0.10,
      taxRate: 0.10,
    };

    await db.collection("members").doc(newId).set(memberDoc);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        memberId: newId,
        member: {
          phoneNumber: normalizedPhone,
          memberId: newId,
          tier: "Classic",
          discountRate: 0.10,
          taxRate: 0.10,
          displayName: name,
        },
      }),
    };
  } catch (err) {
    console.error("register-member error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
