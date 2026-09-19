const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();
const auth = getAuth();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const authHeader = event.headers.authorization || "";
    const idToken = authHeader.replace("Bearer ", "");
    if (idToken) {
      try { await auth.verifyIdToken(idToken); } catch {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Invalid auth token" }) };
      }
    }

    const body = JSON.parse(event.body || "{}");

    if (!body.token) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Missing token",
        }),
      };
    }

    await db.collection("fcmTokens").doc(body.token).set({
      token: body.token,
      platform: "android",
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
      }),
    };
  } catch (err) {
    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: err.message,
      }),
    };
  }
};