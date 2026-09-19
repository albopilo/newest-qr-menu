const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

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
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { orderId, idToken } = body;

    // Require either admin auth or a valid orderId that exists in the database
    const admin = require("firebase-admin");

    let isAuthorized = false;

    if (idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const adminSnap = await db.collection("admins").doc(decoded.uid).get();
        isAuthorized = adminSnap.exists;
      } catch {}
    }

    if (!isAuthorized) {
      if (!orderId) {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Authentication or valid orderId required" }) };
      }
      const orderSnap = await db.collection("orders").doc(orderId).get();
      if (!orderSnap.exists) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Order not found" }) };
      }
    }

    const snapshot = await admin.firestore()
      .collection("staffDevices")
      .get();

    const tokens = snapshot.docs.map(d => d.data().token).filter(Boolean);

    if (!tokens.length) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: "No devices" }),
      };
    }

    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: body.title || "New Order",
        body: body.body || "A new order has arrived.",
      },
      android: { priority: "high" },
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error("send-order-notification error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to send notification" }),
    };
  }
};
