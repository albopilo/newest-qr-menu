// netlify/functions/newOrderPush.js
const fetch = require("node-fetch");

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || "{}");
    // expected body: { orderId, table, total, url, title, message }
    const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
    const ONE_SIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

    if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_KEY) {
      console.error("Missing OneSignal keys in environment");
      return { statusCode: 500, body: "Missing OneSignal keys" };
    }

    const payload = {
      app_id: ONE_SIGNAL_APP_ID,
      headings: { en: body.title || "New order" },
      contents: { en: body.message || `New order from ${body.table || "Unknown"}` },
      included_segments: ["Subscribed Users"],
      url: body.url || (body.orderId ? `https://13e-menu.netlify.app/staff.html?orderId=${body.orderId}` : "https://13e-menu.netlify.app/staff.html"),
      data: {
        orderId: body.orderId || null,
      },
      // use a stable icon (prefer https)
      large_icon: body.icon || "https://albopilo.github.io/newest-qr-menu/assets/icon.png"
    };

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${ONE_SIGNAL_REST_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (!res.ok) {
      console.error("OneSignal error:", result);
      return { statusCode: 500, body: JSON.stringify(result) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, result }) };
  } catch (err) {
    console.error("Error in newOrderPush:", err);
    return { statusCode: 500, body: "Internal error" };
  }
};
