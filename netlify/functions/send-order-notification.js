const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    )
  });
}

exports.handler = async (event) => {

  const body = JSON.parse(event.body);

  const snapshot = await admin.firestore()
      .collection("staffDevices")
      .get();

  const tokens = snapshot.docs.map(d => d.data().token);

  if (!tokens.length) {
      return {
          statusCode:200,
          body:"No devices"
      };
  }

  await admin.messaging().sendEachForMulticast({

      tokens,

      notification:{
          title:body.title,
          body:body.body
      },

      android:{
          priority:"high"
      }

  });

  return {
      statusCode:200,
      body:"Sent"
  };

};