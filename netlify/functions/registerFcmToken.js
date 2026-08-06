const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

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