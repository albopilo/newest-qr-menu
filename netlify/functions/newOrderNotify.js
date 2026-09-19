// netlify/functions/newOrderNotify.js
import fetch from "node-fetch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const title = body.title || "🍽️ New Order Received!";
    const message = body.message || "A new order has just arrived in the system.";
    const url = body.url || "https://13e-menu.netlify.app/staff.html";

    const ONE_SIGNAL_APP_ID = "9d4e981e-3184-4ebb-9ac1-cdb4644b1ccd";
    const ONE_SIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

    if (!ONE_SIGNAL_REST_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "OneSignal key not configured" }),
      };
    }

    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Basic ${ONE_SIGNAL_REST_KEY}`,
      },
      body: JSON.stringify({
        app_id: ONE_SIGNAL_APP_ID,
        included_segments: ["All"],
        headings: { en: title },
        contents: { en: message },
        url,
      }),
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data }),
    };
  } catch (err) {
    console.error("❌ Error sending OneSignal notification:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to send notification" }),
    };
  }
}
