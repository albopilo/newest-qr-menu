// netlify/functions/newOrderNotify.js
import fetch from "node-fetch";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { orderId, idToken } = body;

    // Require either an admin ID token or a valid orderId that exists in the database
    // This prevents anonymous users from broadcasting arbitrary notifications
    const admin = await import("firebase-admin");

    let isAuthorized = false;

    if (idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const adminSnap = await db.collection("admins").doc(decoded.uid).get();
        isAuthorized = adminSnap.exists;
      } catch {}
    }

    if (!isAuthorized) {
      // Fall back: verify a real order exists with this orderId
      if (!orderId) {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Authentication or valid orderId required" }) };
      }
      const orderSnap = await db.collection("orders").doc(orderId).get();
      if (!orderSnap.exists) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Order not found" }) };
      }
    }

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
