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

function normalizePhone(input) {
  return String(input || "")
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

    // Validate inputs
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Valid name is required" }),
      };
    }

    if (!email || !/^\S+@\S+\.\S+$/.test(email.trim().toLowerCase())) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Valid email is required" }),
      };
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Valid phone number is required" }),
      };
    }

    if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Valid birthdate is required" }),
      };
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Check for existing phone
    const phoneSnap = await db.collection("members").where("phone", "==", normalizedPhone).limit(1).get();
    if (!phoneSnap.empty) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "This phone number is already registered" }),
      };
    }

    // Check for existing email
    const emailSnap = await db.collection("members").where("email", "==", cleanEmail).limit(1).get();
    if (!emailSnap.empty) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "This email is already registered" }),
      };
    }

    // Generate a random ID (not predictable like Date.now())
    const newId = db.collection("members").doc().id;

    const memberDoc = {
      birthdate: birthdate,
      email: cleanEmail,
      id: newId,
      ktp: null,
      lastRoomUpgrade: null,
      monthlySinceUpgrade: 0,
      name: cleanName,
      nameLower: cleanName.toLowerCase(),
      phone: normalizedPhone,
      redeemablePoints: 0,
      roomUpgradeHistory: [],
      spendingSinceUpgrade: 0,
      tier: "Classic",
      upgradeDate: null,
      welcomed: true,
      yearlySinceUpgrade: 0,
      createdAt: FieldValue.serverTimestamp(),
      // Server-controlled values — client cannot set these
      discountRate: 0,
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
          discountRate: 0,
          taxRate: 0.10,
          displayName: cleanName,
        },
      }),
    };
  } catch (err) {
    console.error("registerMember error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to register member" }),
    };
  }
};
