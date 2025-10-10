import fetch from "node-fetch";

export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const { title, message } = body;

    const ONE_SIGNAL_APP_ID = "9d4e981e-3184-4ebb-9ac1-cdb4644b1ccd";
    const ONE_SIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY; // ✅ Secure env variable

    if (!ONE_SIGNAL_REST_KEY) {
      console.error("❌ Missing OneSignal REST key in environment variables.");
      return {
        statusCode: 500,
        body: "Missing OneSignal REST API key",
      };
    }

    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${ONE_SIGNAL_REST_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: ONE_SIGNAL_APP_ID,
        included_segments: ["All"],
        headings: { en: title },
        contents: { en: message },
        url: "https://13e-menu.netlify.app/staff.html",
      }),
    });

    const data = await res.json();
    console.log("✅ OneSignal push sent:", data);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, data }),
    };
  } catch (err) {
    console.error("❌ Push send error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
