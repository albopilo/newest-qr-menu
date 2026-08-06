const admin = require("firebase-admin");

console.log("firebase-admin loaded:", !!admin);
console.log("apps:", admin.apps);

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccount) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env variable");
}

if (!admin.apps || admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccount)
        )
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