const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!getApps().length) {
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

exports.handler = async () => {

    try {

        const snapshot = await db.collection("fcmTokens").get();

        const tokens = snapshot.docs.map(doc => doc.id);

        if (!tokens.length) {
            return {
                statusCode: 200,
                body: "No devices registered"
            };
        }

        const result = await getMessaging().sendEachForMulticast({

            tokens,

            data: {
                title: "New Order",
                body: "A new order has arrived.",
                orderId: "123"
            },

            android: {
                priority: "high"
            }

        });

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (err) {

        console.error(err);

        return {
            statusCode: 500,
            body: err.message
        };
    }

};