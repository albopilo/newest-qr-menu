// netlify/functions/newOrderPush.js
const fetch = require("node-fetch");

exports.handler = async function (event) {
  try {
    const data = JSON.parse(event.body);
    const { orderId, table, total, date } = data;

    // 🔐 Load your OneSignal credentials from environment variables
    const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
    const ONE_SIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

    if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_KEY) {
      console.error("❌ Missing OneSignal environment keys");
      return { statusCode: 500, body: "Missing OneSignal keys" };
    }

    const message = `🆕 New order from table ${table || "?"} — Rp${(total || 0).toLocaleString("id-ID")}`;

// example payload change in netlify function
const payload = {
  app_id: process.env.ONESIGNAL_APP_ID,
  included_segments: ["All"],
  headings: { en: "New Order Received" },
  contents: { en: `Table ${table || "?"} • Rp${(total||0).toLocaleString("id-ID")}` },
  url: "https://13e-menu.netlify.app/staff.html", // <--- staff page
  data: { orderId }, // optional
  priority: 10
};


    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Basic ${ONE_SIGNAL_REST_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    console.log("✅ OneSignal sent:", result);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, result }),
    };
  } catch (err) {
    console.error("🔥 Error sending OneSignal push:", err);
    return { statusCode: 500, body: "Failed to send push" };
  }
};
