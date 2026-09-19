const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    )
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

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
