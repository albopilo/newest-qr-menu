// netlify/functions/newOrderNotify.js
import fetch from "node-fetch";

export async function handler(event, context) {
  try {
    const body = JSON.parse(event.body || "{}");

    // You’ll send title/body when calling this endpoint
    const title = body.title || "🍽️ New Order Received!";
    const message = body.message || "A new order has just arrived in the system.";
    const url = body.url || "https://13e-menu.netlify.app/staff.html";

    // ✅ Replace these with your actual OneSignal App ID and REST API key
    const ONE_SIGNAL_APP_ID = "9d4e981e-3184-4ebb-9ac1-cdb4644b1ccd";
    const ONE_SIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Basic ${os_v2_app_tvhjqhrrqrhlxgwbzw2gisy4zwcl73fy2ote7kegksxm6l3t24mihp7abvadd2f5zyazd7oc3byxhvq4wrfomimojwskwjkemy5eh3y}`,
      },
      body: JSON.stringify({
        app_id: ONE_SIGNAL_APP_ID,
        included_segments: ["All"], // send to all subscribers
        headings: { en: title },
        contents: { en: message },
        url,
      }),
    });

    const data = await response.json();
    console.log("✅ OneSignal response:", data);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, data }),
    };
  } catch (err) {
    console.error("❌ Error sending OneSignal notification:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
}
