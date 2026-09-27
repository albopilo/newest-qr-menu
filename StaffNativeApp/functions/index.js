const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

exports.notifyNewOrder = functions.firestore.onDocumentCreated(
  {
    document: "orders/{orderId}",
    region: "asia-southeast2",
  },
  async () => {
    const message = {
      topic: "staff",

      notification: {
        title: "🆕 New Order",
        body: "A new order has been placed",
      },

      android: {
  priority: "high",
  notification: {
    channelId: "orders",
    sound: "sound",
    ongoing: true
  }
},
    };

    await admin.messaging().send(message);
  }
);
