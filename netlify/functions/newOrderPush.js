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

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    const snapshot = await db.collection("fcmTokens").get();

    const tokens = snapshot.docs.map((doc) => doc.id);

    if (tokens.length === 0) {
      return {
        statusCode: 200,
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
      body: JSON.stringify({
        success: false,
        error: err.message,
      }),
    };
  }
};