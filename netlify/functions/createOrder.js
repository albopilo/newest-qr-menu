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

function isMilleTable(t) {
  return /mille\s*[123]/i.test(t || "");
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
    const { items, table, guestName, memberId, memberPhone, paymentMethod, previewOnly } = body;

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Items are required" }),
      };
    }

    for (const i of items) {
      if (!i || typeof i.name !== "string" || typeof i.qty !== "number" || i.qty < 1 || i.qty > 999) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: "Invalid item data" }),
        };
      }
    }

    if (!table || typeof table !== "string") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Table is required" }),
      };
    }

    // Look up product prices from Firestore server-side
    const productsSnap = await db.collection("products").get();
    const productMap = {};
    productsSnap.forEach(doc => {
      const p = doc.data();
      const key = `${p.name || ""}|${p.variant_names || p.variant || ""}`.toLowerCase();
      productMap[key] = {
        id: doc.id,
        price: Number(p.pos_sell_price ?? p.price ?? 0),
        category: p.category || "",
        name: p.name || "",
        variant: p.variant_names || p.variant || null,
      };
    });

    // Rebuild items with server-side prices
    const validatedItems = [];
    let subtotal = 0;

    for (const i of items) {
      // Parse "Name (Variant)" format from the summary page
      let name = i.name;
      let variant = null;
      const match = i.name.match(/^(.+?)\s*\((.+)\)$/);
      if (match) {
        name = match[1];
        variant = match[2];
      }

      // Find the product in the map
      const key = `${name}|${variant || ""}`.toLowerCase();
      const product = productMap[key] || Object.values(productMap).find(p =>
        p.name.toLowerCase() === name.toLowerCase() &&
        (!variant || (p.variant || "").toLowerCase() === variant.toLowerCase())
      );

      if (!product) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: `Product not found: ${i.name}` }),
        };
      }

      const itemPrice = product.price;
      subtotal += itemPrice * i.qty;
      validatedItems.push({
        name: i.name,
        qty: i.qty,
        unitPrice: itemPrice,
      });
    }

    // Look up member if provided
    let member = null;
    let tier = "Guest";
    let discountRate = 0;
    let taxRate = 0.10;

    if (memberId) {
      const memberSnap = await db.collection("members").doc(memberId).get();
      if (memberSnap.exists) {
        member = memberSnap.data();
        tier = member.tier || "Classic";
        discountRate = normalizeDiscountRate(member.discountRate ?? getDiscountByTier(tier));
        taxRate = typeof member.taxRate === "number" ? member.taxRate : 0.10;
        if (tier.toLowerCase() === "classic") discountRate = 0;
      }
    }

    // Calculate discount (excludes "Special Today" items)
    let discount = 0;
    for (const i of validatedItems) {
      const product = Object.values(productMap).find(p =>
        i.name.toLowerCase().startsWith(p.name.toLowerCase())
      );
      const isSpecial = product && product.category === "Special Today";
      if (tier.toLowerCase() === "classic" || isSpecial) continue;
      discount += i.unitPrice * i.qty * discountRate;
    }

    const tax = (subtotal - discount) * taxRate;

    // Delivery fee for Mille 1 & 3
    let deliveryFee = 0;
    if (/mille\s*1/i.test(table) || /mille\s*3/i.test(table)) {
      deliveryFee = 10000;
    } else if (table.toLowerCase() === "delivery") {
      deliveryFee = 10000;
    }

    const total = Math.round((subtotal - discount + tax) / 100) * 100;
    const grandTotal = total + deliveryFee;

    // Determine payment method server-side
    let finalPaymentMethod = paymentMethod || "cash";
    if (isMilleTable(table)) {
      finalPaymentMethod = "qris";
    }

    // Jakarta date
    const jakartaDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

    // If previewOnly, return calculated values without writing to Firestore
    if (previewOnly) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          preview: true,
          subtotal,
          discount,
          tax,
          deliveryFee,
          total,
          grandTotal,
          paymentMethod: finalPaymentMethod,
          items: validatedItems.map(i => ({ name: i.name, qty: i.qty })),
        }),
      };
    }

    const orderDoc = {
      subtotal,
      discount,
      tax,
      deliveryFee,
      total,
      grandTotal,
      table,
      guestName: guestName || "Guest",
      items: validatedItems.map(i => ({ name: i.name, qty: i.qty })),
      schemaVersion: 1,
      date: jakartaDate,
      timestamp: FieldValue.serverTimestamp(),
      status: "pending",
      kitchenStatus: "pending",
      phone: memberPhone || body.phone || null,
      isMember: !!memberId,
      memberId: memberId || null,
      memberPhone: memberPhone || null,
      paymentMethod: finalPaymentMethod,
      paymentStatus: "pending",
    };

    const orderRef = await db.collection("orders").add(orderDoc);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        orderId: orderRef.id,
        subtotal,
        discount,
        tax,
        deliveryFee,
        total,
        grandTotal,
        paymentMethod: finalPaymentMethod,
      }),
    };
  } catch (err) {
    console.error("createOrder error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Failed to create order" }),
    };
  }
};
