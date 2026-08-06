const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}

const db = admin.firestore();

exports.handler = async function (event) {
  try {

    const body = JSON.parse(event.body || "{}");

    const snapshot = await db.collection("fcmTokens").get();

    const tokens = [];

    snapshot.forEach(doc => {
      tokens.push(doc.id);
    });

    if (tokens.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          message: "No registered devices"
        })
      };
    }

    const message = {
      tokens,

      notification: {
        title: body.title || "🍽️ New Order",
        body: body.body || "A new order has arrived."
      },

      data: {
        orderId: body.orderId || "",
        click_action: "OPEN_ORDER"
      },

      android: {
        priority: "high",
        notification: {
          channelId: "orders"
        }
      }
    };

    const result = await admin.messaging().sendEachForMulticast(message);

    console.log(result);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        sent: result.successCount,
        failed: result.failureCount
      })
    };

  } catch (err) {

    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: err.message
      })
    };

  }
};