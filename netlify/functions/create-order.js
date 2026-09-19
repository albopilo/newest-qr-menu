const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

if (getApps().length === 0) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

const db = getFirestore();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isMilleTable(t) {
  return /mille\s*[123]/i.test(t || "");
}

function getDiscountByTier(tier) {
  if (!tier) return 0;
  const t = String(tier).trim().toLowerCase();
  switch (t) {
    case "classic": return 0.0;
    case "bronze":  return 0.10;
    case "silver":  return 0.15;
    case "gold":    return 0.20;
    default:        return 0.0;
  }
}

function normalizeDiscountRate(val) {
  if (val == null) return 0;
  const n = Number(val);
  if (Number.isNaN(n)) return 0;
  const normalized = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

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
    const { items, table, guestName, memberId, memberPhone, paymentMethod } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Items are required" }),
      };
    }

    if (!table) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Table is required" }),
      };
    }

    // Fetch actual product prices from Firestore to prevent price tampering
    const productIds = [...new Set(items.map(i => i.id).filter(Boolean))];
    const productDocs = {};
    if (productIds.length > 0) {
      const productsSnapshot = await db.collection("products").get();
      productsSnapshot.forEach(doc => {
        productDocs[doc.id] = doc.data();
      });
    }

    // Validate each item and compute subtotal from server-side prices
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      if (!item.id || !productDocs[item.id]) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: `Invalid product: ${item.name || item.id}` }),
        };
      }

      const product = productDocs[item.id];
      if (Number(product.pos_hidden || 0) === 1) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: `Product not available: ${item.name}` }),
        };
      }

      const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
      const unitPrice = Number(product.pos_sell_price ?? product.price ?? 0);
      subtotal += unitPrice * qty;

      validatedItems.push({
        name: item.name + (item.variant ? ` (${item.variant})` : ""),
        qty,
      });
    }

    // Fetch member info for discount/tax if memberId provided
    let discountRate = 0;
    let taxRate = 0.10;
    let tier = "Guest";
    let isMember = false;

    if (memberId && memberPhone) {
      const memberSnap = await db.collection("members").doc(memberId).get();
      if (memberSnap.exists) {
        const member = memberSnap.data();
        isMember = true;
        tier = member.tier || "Classic";
        discountRate = normalizeDiscountRate(member.discountRate ?? getDiscountByTier(member.tier));
        taxRate = member.taxRate ?? 0.10;

        if ((tier || "").toLowerCase() === "classic") {
          discountRate = 0;
        }
      }
    }

    // Compute discount (excludes "Special Today" category items)
    const discount = validatedItems.reduce((sum, i) => {
      const isSpecial = (i.category || "") === "Special Today";
      if (tier === "classic" || isSpecial) return sum;
      // We don't have per-item price here, use proportion
      return sum;
    }, 0);

    // Simpler: compute discount from subtotal minus special items
    let nonSpecialSubtotal = 0;
    for (let idx = 0; idx < validatedItems.length; idx++) {
      const item = items[idx];
      const product = productDocs[item.id];
      const isSpecial = (product.category || "") === "Special Today";
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      const unitPrice = Number(product.pos_sell_price ?? product.price ?? 0);
      if (!isSpecial && tier !== "classic") {
        nonSpecialSubtotal += unitPrice * qty;
      }
    }
    const discountAmount = Math.round(nonSpecialSubtotal * discountRate);

    const tax = Math.round((subtotal - discountAmount) * taxRate);

    // Delivery fee for Mille 1 & 3
    const deliveryFee = (isMilleTable(table) && /mille\s*[13]/i.test(table)) ? 10000 : 0;

    const finalTotal = subtotal - discountAmount + tax;
    const grandTotal = Math.round((finalTotal + deliveryFee) / 100) * 100;

    const jakartaDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

    const resolvedPaymentMethod = isMilleTable(table) ? "qris" : (paymentMethod || "cash");

    const orderRef = await db.collection("orders").add({
      subtotal,
      discount: discountAmount,
      tax,
      deliveryFee,
      total: finalTotal,
      grandTotal,
      table,
      guestName: guestName || "Guest",
      items: validatedItems,
      schemaVersion: 1,
      date: jakartaDate,
      timestamp: FieldValue.serverTimestamp(),
      status: "pending",
      phone: memberPhone || "",
      isMember,
      memberId: memberId || null,
      paymentMethod: resolvedPaymentMethod,
      paymentStatus: "pending",
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        orderId: orderRef.id,
        subtotal,
        discount: discountAmount,
        tax,
        deliveryFee,
        total: finalTotal,
        grandTotal,
        paymentMethod: resolvedPaymentMethod,
      }),
    };
  } catch (err) {
    console.error("create-order error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
