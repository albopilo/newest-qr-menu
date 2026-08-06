const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const db = admin.firestore();

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || "{}");

    if (!body.token) {
      return {
        statusCode: 400,
        body: "Missing token",
      };
    }

    await db.collection("fcmTokens").doc(body.token).set({
      token: body.token,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      platform: "android",
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
      body: err.message,
    };
  }
};