const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
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
    const { orderId } = body;

    // Verify the order actually exists before sending push notifications
    // This prevents anyone from triggering push notifications without placing a real order
    if (!orderId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Missing orderId" }) };
    }

    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Order not found" }) };
    }

    const snapshot = await db.collection("fcmTokens").get();

    const tokens = snapshot.docs.map((doc) => doc.id);

    if (tokens.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: "No registered devices",
        }),
      };
    }

    const result = await getMessaging().sendEachForMulticast({
      tokens,

      notification: {
        title: body.title || "🍽️ New Order",
        body: body.body || "A new order has arrived.",
      },

      data: {
        orderId: body.orderId || "",
      },

      android: {
        priority: "high",
      },
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        sent: result.successCount,
        failed: result.failureCount,
      }),
    };
  } catch (err) {
    console.error(err);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: "Failed to send notification",
      }),
    };
  }
};
