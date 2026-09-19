const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { orderId, base64Image } = body;

    if (!orderId || !base64Image) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Missing orderId or image data" }),
      };
    }

    // Verify the order exists
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Order not found" }),
      };
    }

    const orderData = orderSnap.data();

    // Only allow upload if payment method is QRIS and not already successful
    if ((orderData.paymentMethod || "").toLowerCase() !== "qris") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "This order is not a QRIS payment" }),
      };
    }

    if ((orderData.paymentStatus || "").toLowerCase() === "success") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Payment already confirmed" }),
      };
    }

    // Upload to ImgBB using server-side API key (never exposed to client)
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    if (!imgbbApiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Image upload service not configured" }),
      };
    }

    const formData = new URLSearchParams();
    formData.append("image", base64Image);
    formData.append("name", `order-${orderId}`);

    const uploadResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const uploadData = await uploadResponse.json();
    if (!uploadData.success) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Image upload failed" }),
      };
    }

    const fileUrl = uploadData.data.url;

    // Update order server-side: mark as awaiting verification, NOT auto-success
    await orderRef.update({
      paymentMethod: "qris",
      paymentStatus: "awaiting-verification",
      proofUrl: fileUrl,
      proofUploadedAt: FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        proofUrl: fileUrl,
        message: "Proof uploaded. Staff will verify your payment.",
      }),
    };
  } catch (err) {
    console.error("uploadPaymentProof error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to upload payment proof" }),
    };
  }
};
