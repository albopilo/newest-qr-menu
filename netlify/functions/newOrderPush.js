import fetch from "node-fetch";

export async function handler(event, context) {
  try {
    const body = JSON.parse(event.body || "{}");
    const { title, message } = body;

    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Authorization": "Basic YOUR_ONESIGNAL_REST_API_KEY",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: "9d4e981e-3184-4ebb-9ac1-cdb4644b1ccd",
        included_segments: ["All"],
        headings: { en: title },
        contents: { en: message },
        url: "https://13e-menu.netlify.app/staff.html",
      }),
    });

    const data = await res.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, data }),
    };
  } catch (err) {
    console.error("❌ Push send error:", err);
    return { statusCode: 500, body: "Error sending push" };
  }
}
