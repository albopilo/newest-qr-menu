/***********************
 * Firebase initialization
 ***********************/
const firebaseConfig = {
  apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
  authDomain: "e-loyalty-12563.firebaseapp.com",
  projectId: "e-loyalty-12563",
  storageBucket: "e-loyalty-12563.appspot.com",
  messagingSenderId: "3887061029",
  appId: "1:3887061029:web:f9c238731d7e6dd5fb47cc",
  measurementId: "G-966P8W06W2"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ---------------------------------
// small helpers (insert near top)
// ---------------------------------
/* === PATCH: robust normalizeDriveUrl (overwrite earlier defs) ===
    This central function handles:
    - drive.com /d/<id>/ links
    - links with ?id=<id>
    - already-direct uc?export=view&id=... and uc?id=...
    We assign to window.normalizeDriveUrl so it overrides duplicate defs.
 */
window.normalizeDriveUrl = function(raw) {
  if (!raw) return "";
  const s = String(raw).trim();

  // Already in uc?id form → just return
  if (/https:\/\/drive\.google\.com\/uc\?id=/.test(s)) {
    return s;
  }

  // Handle uc?export=view&id=...
  let m = s.match(/id=([a-zA-Z0-9_-]{10,})/);
  if (m) return `https://drive.google.com/uc?id=${m[1]}`;

  // Handle /d/<id>/
  m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return `https://drive.google.com/uc?id=${m[1]}`;

  return s;
};


/**
 * Format number to Indonesian Rupiah, safe for missing values.
 * Usage: formatRp(15000) -> "Rp15.000"
 */
 function formatRp(value) {
   return "Rp" + Number(value || 0).toLocaleString("id-ID");
 }


// app.js — minimal product rendering (compatible with firebase v8)
(function(){
  // Assumes firebase app already initialized on the page
  const db = firebase.firestore();

  const productListEl = document.getElementById("productList");
  if (!productListEl) throw new Error("#productList missing");


function renderProductCard(doc) {
  const p = doc.data ? doc.data() : doc;
  if (Number(p.pos_hidden || 0) === 1) return null;

  const card = document.createElement("div");
  card.className = "product-card";

  // --- media (image or "No Image") ---
  const rawUrl = normalizeDriveUrl((p.photo_1 || "").trim());
  let mediaEl;
  if (rawUrl) {
    const img = document.createElement("img");
    img.className = "media";
// Chrome lazy-load causes issues with Drive links, disable:
 // img.loading = "lazy";    img.alt = p.name || "Product";
    img.src = rawUrl;
    img.onerror = () => {
   console.warn("Image failed once, retrying:", img.src);
   setTimeout(() => { img.src = img.src; }, 800); // retry once
 };
    mediaEl = img;
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "media";
    placeholder.style.display = "flex";
    placeholder.style.alignItems = "center";
    placeholder.style.justifyContent = "center";
    placeholder.style.color = "#999";
    placeholder.style.fontSize = "0.9rem";
    placeholder.textContent = "No Image";
    mediaEl = placeholder;
  }
  card.appendChild(mediaEl);

  // --- content ---
  const content = document.createElement("div");
  content.className = "content";

  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = p.name || "Unnamed";
  content.appendChild(titleEl);

  if (p.description) {
if (p.variant_label || p.variant_names) {
   const descEl = document.createElement("div");
   descEl.className = "desc";
   descEl.textContent = p.variant_label || p.variant_names;
   content.appendChild(descEl);
 }
  }

  // --- price + button ---
  const priceRow = document.createElement("div");
  priceRow.className = "priceRow";

  const priceVal = p.pos_sell_price ?? p.price ?? p.basePrice ?? p.market_price ?? 0;

  const priceEl = document.createElement("div");
  priceEl.className = "price";
  priceEl.textContent = formatRp(priceVal);

  const addBtn = document.createElement("button");
  addBtn.className = "addBtn small";

  const hasVariants = (p.variants && p.variants.length > 1);
  if (hasVariants) {
    addBtn.textContent = "Select variation";
    addBtn.addEventListener("click", () => {
      openVariantModal({ id: doc.id, ...p });
    });
  } else {
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => {
      cart.add({ id: doc.id, product: p });
      const prev = addBtn.textContent;
      addBtn.textContent = "Added ✓";
      setTimeout(() => { addBtn.textContent = prev; }, 900);
    });
  }

  priceRow.appendChild(priceEl);
  priceRow.appendChild(addBtn);
  content.appendChild(priceRow);

  card.appendChild(content);
  return card;
}

  function clearProducts() {
    productListEl.innerHTML = "";
  }

  function renderProductsSnapshot(snap) {
    clearProducts();
    const grid = document.createElement("div");
    grid.className = "product-grid";
    snap.forEach(doc => {
      const card = renderProductCard(doc);
      if (card) grid.appendChild(card);
    });
    productListEl.appendChild(grid);
  }

  // listen to all products ordered by name
  db.collection("products").orderBy("name").onSnapshot(snap => {
    renderProductsSnapshot(snap);
  }, err => {
    console.error("Products listen error:", err);
    productListEl.textContent = "Failed to load products.";
  });

})();


/***********************
 * Globals
 ***********************/
let userHasInteracted = false;
["pointerdown","click","keydown","touchstart"].forEach(evt =>
  window.addEventListener(evt, () => { userHasInteracted = true; }, { once: true, passive: true })
);

const urlParams = new URLSearchParams(window.location.search);
const tableNumber = urlParams.get("table") || "unknown";

let currentUser = null;
// keep internal cart as an Array but expose .add() shorthand so existing code that
// attaches click handlers to call `cart.add(...)` (like product cards) will work.
let cart = [];

// ensure cart.add is available early; it will call addToCart() at click time.
// (addToCart is defined later; that's fine because the function is invoked on click).
cart.add = function(product) {
  try { if (typeof addToCart === "function") return addToCart(product); }
  catch (e) { console.warn("cart.add wrapper: addToCart not ready yet"); }
  // as a fallback push directly (safe minimal behavior)
  if (product && typeof product === "object") {
    cart.push({ ...product, qty: 1 });
    saveCartToStorage?.();
    renderCart?.();
  }
};
let sessionTimer = null;
let unsubscribeOrders = null;
let activePromos = [];

async function fetchActivePromos() {
  const snapshot = await db.collection("marketing_programs")
    .where("type", "==", "buy_x_get_y")
    .where("active", "==", true)
    .get();

  activePromos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log("📢 Active promos loaded:", activePromos);
}
// Load currentUser from localStorage safely
currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");

// Ensure Classic members have 0 discount
if ((currentUser.tier || "").toLowerCase() === "classic") {
  currentUser.discountRate = 0;
  localStorage.setItem("currentUser", JSON.stringify(currentUser));
}


/***********************
 * Banner helper
 ***********************/
function showBanner(msg, ms = 3000) {
  let b = document.getElementById("banner");
  if (!b) {
    b = document.createElement("div");
    b.id = "banner";
    b.className = "banner hidden";
    document.body.appendChild(b);
  }
  b.textContent = msg;
  b.classList.remove("hidden");
  clearTimeout(b.__hideTimer);
  b.__hideTimer = setTimeout(() => b.classList.add("hidden"), ms);
}

/***********************
 * Audio chime manager (gesture-gated with queue + debounce)
 ***********************/
const AudioChime = (() => {
  let unlocked = false;
  let queued = 0;
  let lastPlay = 0;
  const MIN_INTERVAL = 1200; // ms

  const getEl = () => document.getElementById("newOrderSound");

  async function tryPlay() {
    const audio = getEl();
    if (!audio) return false;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0.8;
      await audio.play();
      lastPlay = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  async function unlockByGesture() {
    if (unlocked) return;
    const audio = getEl();
    if (!audio) { unlocked = true; return; }
    try {
      audio.muted = true;
      await audio.play();
      audio.pause(); audio.currentTime = 0; audio.muted = false;
      unlocked = true;
      drainQueue();
    } catch {}
  }

  const attachGestureUnlock = () => 
    ["click","pointerdown","keydown","touchstart"].forEach(evt =>
      window.addEventListener(evt, unlockByGesture, { once: true, passive: true })
    );

  function requestChime() {
    const now = Date.now();
    if (!unlocked) { queued++; showBanner("🔔 Tap anywhere to enable sound alerts", 4000); return; }
    if (now - lastPlay < MIN_INTERVAL) return;
    tryPlay();
  }

  async function drainQueue() {
    if (!unlocked || queued === 0) return;
    queued = 0;
    await tryPlay();
  }

  async function primeMutedAutoplay() {
    const audio = getEl();
    if (!audio) { unlocked = true; return; }
    audio.muted = true;
    try {
      await audio.play();
      audio.pause(); audio.currentTime = 0; audio.muted = false;
      unlocked = true;
    } catch { attachGestureUnlock(); }
  }

  return { requestChime, primeMutedAutoplay, attachGestureUnlock, unlockByGesture, isUnlocked: () => unlocked };
})();

// ------- repeating chime manager (for staff modal) -------
// Keeps playing the chime every 5s until staff dismisses.
const RepeatingChime = (() => {
  const intervals = new Map();
  const getAudio = () => document.getElementById("newOrderSound");
  function start(id) {
    if (!id || intervals.has(id)) return;
    const audio = getAudio();
    if (!audio) return;
    // play immediately once (best-effort)
    try { audio.currentTime = 0; audio.play(); } catch {}
    const iv = setInterval(() => {
      try { audio.currentTime = 0; audio.play(); } catch {}
    }, 5000);
    intervals.set(id, iv);
  }
  function stop(id) {
    const iv = intervals.get(id);
    if (iv) { clearInterval(iv); intervals.delete(id); }
  }
  function stopAll() {
    for (const iv of intervals.values()) clearInterval(iv);
    intervals.clear();
  }
  return { start, stop, stopAll };
})();

// small helper set to avoid re-alerting same order (staff modal)
const staffShownModals = new Set();

// Create a lightweight staff modal/banner (if page doesn't have one)
function showStaffModalForOrder(orderId, data) {
  let modal = document.getElementById("staffChimeModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "staffChimeModal";
    modal.style.position = "fixed";
    modal.style.left = "12px";
    modal.style.right = "12px";
    modal.style.bottom = "12px";
    modal.style.zIndex = 2000;
    modal.style.background = "#fff";
    modal.style.border = "1px solid rgba(0,0,0,0.08)";
    modal.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
    modal.style.padding = "12px";
    modal.style.borderRadius = "8px";
    modal.style.display = "flex";
    modal.style.justifyContent = "space-between";
    modal.style.alignItems = "center";
    modal.style.gap = "12px";
    modal.innerHTML = `
      <div id="staffChimeText"></div>
      <div>
        <button id="staffStopChime" style="margin-right:8px;padding:8px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer;">Stop Alert</button>
        <button id="staffOpenOrder" style="padding:8px;border-radius:6px;border:none;background:#25D366;color:#fff;cursor:pointer;">Open</button>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("staffStopChime").addEventListener("click", () => {
      RepeatingChime.stop(orderId);
      staffShownModals.add(orderId);
      modal.remove();
    });
    document.getElementById("staffOpenOrder").addEventListener("click", () => {
      // open detail view if you have one (example summary.html?orderId=)
      window.open(`summary.html?orderId=${orderId}`, "_blank");
      RepeatingChime.stop(orderId);
      staffShownModals.add(orderId);
      modal.remove();
    });
  }
  const text = document.getElementById("staffChimeText");
  text.innerHTML = `🚨 New order <strong>${data.table || "?"}</strong> • Rp ${((data.grandTotal||data.total)||0).toLocaleString("id-ID")}`;
  modal.style.display = "flex";
}

function hideStaffModal() {
  const m = document.getElementById("staffChimeModal");
  if (m) m.remove();
  RepeatingChime.stopAll();
}

/***********************
 * Session timeout (customer pages only)
 ***********************/
function startSessionTimeout() {
  const isIndexLike = !!document.getElementById("productList");
  if (!isIndexLike) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    cart = [];
    currentUser = null;
    localStorage.removeItem("currentUser");
    localStorage.removeItem("sessionStart");
    localStorage.removeItem("cart");
    localStorage.removeItem("cartSavedAt");
    renderCart();
    const userStatus = document.getElementById("userStatus");
    if (userStatus) userStatus.textContent = "Guest";
    showBanner("Session expired after 1 hour. Please sign in again.", 5000);
    sessionTimer = null;
  }, 3600000);
}

/***********************
 * Tier helpers
 ***********************/
function getDiscountByTier(tier) {
  // Normalize carefully: handle null/undefined, trim whitespace, lowercase
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

// Normalize discount rates coming from Firestore / localStorage.
//
// Accepts either a decimal (0.1) or a percent (10) and returns a decimal [0..1].
function normalizeDiscountRate(val) {
  if (val == null) return 0;
  const n = Number(val);
  if (Number.isNaN(n)) return 0;
  // If > 1 assume percent (e.g. 10 -> 0.10). clamp to [0,1]
  const normalized = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

// Return effective discount rate for a currentUser object (decimal)
function getEffectiveDiscountRate(user) {
  if (!user) return 0;
  if (typeof user.discountRate === "number") return normalizeDiscountRate(user.discountRate);
  // fallback to tier mapping
  return getDiscountByTier(user.tier);
}



async function fetchMemberTier(phone) {
  const snapshot = await db.collection("members").where("phone", "==", phone).limit(1).get();
  if (!snapshot.empty) {
    const memberDoc = snapshot.docs[0];
    const member = memberDoc.data();
    currentUser.tier = member.tier || null;
    currentUser.memberId = memberDoc.id; // capture for loyalty linkage
    currentUser.discountRate = normalizeDiscountRate(member.discountRate ?? getDiscountByTier(member.tier));
    currentUser.taxRate = member.taxRate ?? 0.10;

    // Auto remove invalid discount for Classic
    if ((currentUser.tier || "").toLowerCase() === "classic") {
      currentUser.discountRate = 0;
    }

    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    console.log("Tier info:", currentUser.tier, "Discount:", currentUser.discountRate, "Tax:", currentUser.taxRate);
  }
}


/***********************
 * Product cache + fetch (with stale fallback)
 ***********************/
async function fetchProductsRaw() {
  const cacheKey = "productCacheV2";
  const cacheTimeKey = "productCacheTimeV2";
  const cached = localStorage.getItem(cacheKey);
  const cacheTime = Number(localStorage.getItem(cacheTimeKey));

  try {
    if (cached && cacheTime && Date.now() - cacheTime < 3600000) {
      return JSON.parse(cached);
    }
    const snapshot = await db.collection("products").get();
    const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    localStorage.setItem(cacheKey, JSON.stringify(products));
    localStorage.setItem(cacheTimeKey, Date.now().toString());
    return products;
  } catch (err) {
    console.error("Failed to fetch products, using cached if available", err);
    if (cached) return JSON.parse(cached);
    showBanner("Unable to load menu. Please check your connection.", 4000);
    return [];
  }
}

/***********************
 * Group by name and aggregate variants
 ***********************/
function buildVariantsFromDoc(p) {
  const price = p.pos_sell_price ?? p.price ?? 0;
  const variantField = p.variant || p.size || p.variant_name || p.variant_names;
  if (Array.isArray(variantField) && variantField.length > 0) {
    return variantField.map(vn => ({ id: p.id, variant: vn, price }));
  } else if (typeof variantField === "string" && variantField.trim() !== "") {
    return [{ id: p.id, variant: variantField.trim(), price }];
  }
  return [{ id: p.id, variant: null, price }];
}

async function fetchGroupedProducts() {
  // Keep original behavior but preserve the first available photo_1 for the group
  const raw = await fetchProductsRaw();
  const grouped = {};

  for (const p of raw) {
    const isHidden = Number(p.pos_hidden ?? 0) !== 0;
    const category = (p.category || "").trim();
    const nameKey = (p.name || "").trim() || "Unnamed";

    if (isHidden || !category) {
      console.warn("⏭ Skipped product (hidden or missing category):", { id: p.id, name: nameKey, category: category || "(none)" });
      continue;
    }

if (!grouped[nameKey]) {
     grouped[nameKey] = {
        id: p.id, // keep a reference to first doc
        name: nameKey,
        category: category, // guaranteed non-empty here
        basePrice: p.pos_sell_price ?? p.price ?? 0,
        variants: [],
        variant_label: p.variant_label || null,
        // store the first available photo_1 so the grouped card can show an image
        photo_1: (p.photo_1 || "").trim() || ""
      };
    } else {
      // If we haven't captured a photo for the group yet, prefer the first found photo_1
      if (!grouped[nameKey].photo_1 && (p.photo_1 || "").trim()) grouped[nameKey].photo_1 = (p.photo_1 || "").trim();
    }

    const variants = buildVariantsFromDoc(p);
    grouped[nameKey].variants.push(...variants);
    const minPrice = Math.min(grouped[nameKey].basePrice, ...variants.map(v => Number(v.price) || 0));
    grouped[nameKey].basePrice = Number.isFinite(minPrice) ? minPrice : grouped[nameKey].basePrice;
  }

  // Deduplicate & sort
  Object.values(grouped).forEach(group => {
    const unique = new Map();
    group.variants.forEach(v => {
      const keyVariant = (v.variant ?? "").toString().trim().toLowerCase();
      const k = `${keyVariant}::${Number(v.price) || 0}`;
      if (!unique.has(k)) unique.set(k, { ...v, variant: v.variant ? v.variant.toString().trim() : null });
    });
    group.variants = Array.from(unique.values()).sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  });

  window.groupedProducts = grouped;
  return grouped;
}

/***********************
 * Render products with category tabs (safe DOM creation)
 ***********************/
async function renderProducts(selectedCategory = "") {
  const grouped = await fetchGroupedProducts();

  // Map categories
  const categoryMap = {};
  Object.values(grouped).forEach(prod => {
    const cat = prod.category || "Uncategorized";
    if (!categoryMap[cat]) categoryMap[cat] = [];
    categoryMap[cat].push(prod);
  });

  // Sort categories with preferred order
  const preferredOrder = [
    'Special Today','Snacks','Western','Ricebowl','Nasi','Nasi Goreng',
    'Mie','Matcha','Coffee','Non coffee','Tea & Juices'
  ];
  const norm = s => s.toLowerCase();
  const sortedCats = Object.keys(categoryMap).sort((a, b) => {
    const ia = preferredOrder.findIndex(x => norm(x) === norm(a));
    const ib = preferredOrder.findIndex(x => norm(x) === norm(b));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // Build category tabs
  const tabs = document.getElementById("categoryTabs");
  if (tabs) {
    tabs.innerHTML = "";
    sortedCats.forEach(cat => {
      const btn = document.createElement("button");
      btn.textContent = cat;
      if (norm(cat) === norm(selectedCategory)) btn.classList.add("active");
      btn.addEventListener("click", () => {
        renderProducts(cat);
        startSessionTimeout();
      });
      tabs.appendChild(btn);
    });
  }

  // Build product list
  const list = document.getElementById("productList");
  if (list) {
    list.innerHTML = "";
    const heading = document.createElement("h4");
    heading.textContent = selectedCategory || "Select a Category";
    list.appendChild(heading);

    if (!selectedCategory || !categoryMap[selectedCategory]) return;

    const grid = document.createElement("div");
    grid.className = "product-grid";
    list.appendChild(grid);

categoryMap[selectedCategory].forEach(prod => {
      const hasVariants = prod.variants && prod.variants.length > 0 && prod.variants.some(v => v.variant);

      const card = document.createElement("div");
      card.className = "product-card";

      // image: use grouped photo_1 (we set this in fetchGroupedProducts). fallback to placeholder box.
      // Prefer photo_1, but also fallback to legacy field 'photo' if needed
 const rawPhoto = (prod.photo_1 || prod.photo || "").trim();
 const imgUrl = rawPhoto ? normalizeDriveUrl(rawPhoto) : "";
      if (imgUrl) {
        const img = document.createElement("img");
        img.className = "media";
// Chrome lazy-load causes issues with Drive links, disable:
 // img.loading = "lazy";        img.alt = prod.name || "Product";
        console.log("📷 Loading image:", prod.name, imgUrl);
        img.src = imgUrl;
        img.onerror = () => {
   console.warn("Image failed once, retrying:", img.src);
   setTimeout(() => { img.src = img.src; }, 800); // retry once
 };
        card.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "media";
        ph.style.display = "flex";
        ph.style.alignItems = "center";
        ph.style.justifyContent = "center";
        ph.style.color = "#999";
        ph.style.fontSize = "0.9rem";
        ph.textContent = "No Image";
        card.appendChild(ph);
      }

      // content
      const content = document.createElement("div");
      content.className = "content";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = prod.name;
      content.appendChild(title);

      // don't show variant_label in the list — user requested variants only when selecting
      if (prod.description) {
        const desc = document.createElement("div");
        desc.className = "desc";
        desc.textContent = prod.description;
        content.appendChild(desc);
      }

      // price + button
      const priceRow = document.createElement("div");
      priceRow.className = "priceRow";

      const price = document.createElement("div");
      price.className = "price";
      price.textContent = formatRp(prod.basePrice ?? 0);
      priceRow.appendChild(price);

      // keep a class 'add-to-cart' and data-product-name so the delegated click handler
      // already attached to #productList catches these and calls handleAddToCartByName().
      const btn = document.createElement("button");
      btn.className = "add-to-cart addBtn";
      btn.dataset.productName = prod.name;
      btn.textContent = (hasVariants ? "Select variation" : "Add to cart");
      priceRow.appendChild(btn);

      content.appendChild(priceRow);
      card.appendChild(content);
      grid.appendChild(card);
    });
  }
}

function highlightCartItemByName(name) {
  const cartList = document.querySelector(".cart-list");
  if (!cartList) return;
  const itemEl = Array.from(cartList.querySelectorAll(".cart-item-name"))
    .find(el => el.dataset.productName === name);
  if (itemEl) {
    const li = itemEl.closest("li");
    li.classList.add("highlight");
    setTimeout(() => li.classList.remove("highlight"), 1500);
  }
}

/***********************
 * Add to cart by product name
 ***********************/
window.handleAddToCartByName = function(productName) {
  const group = window.groupedProducts?.[productName];
  if (!group) return;

  const hasVariants = group.variants.length > 1 || !!group.variants[0]?.variant;

  // Choose variant for buy item before adding
const addBuyItem = (variantObj, promoLinkId = null) => {
  addToCart({
    id: variantObj.id,
    name: group.name,
    price: variantObj.price,
    variant: variantObj.variant || null,
    category: group.category || "", // ← ensure category is present
    promoLinkId
  });
};


  const chosenVariant = group.variants[0];

  // Check promos first so we can generate a shared link ID
  const triggeredPromos = activePromos.filter(promo =>
    promo.buy_product_ids.includes(chosenVariant.id)
  );
  const promoLinkId = triggeredPromos.length ? `${triggeredPromos[0].id}-${Date.now()}` : null;

  if (hasVariants) {
    // Show variant selector for buy item
    const modal = document.getElementById("variantModal");
    const options = document.getElementById("variantOptions");
    const title = document.getElementById("variantTitle");
    if (!modal || !options) return;
    options.innerHTML = "";

    // Configure the options container (scrollable + compact buttons)
    configureVariantOptionsContainer(options, group.variants.length);

    if (title) {
      title.textContent = group.variant_label
        ? `Choose ${group.variant_label} for ${group.name}`
        : `Choose option for ${group.name}`;
    }
    // remove any old freebie-note/search (defensive)
    const oldNote = options.parentNode.querySelector(".freebie-note");
    if (oldNote) oldNote.remove();
    const oldSearch = options.parentNode.querySelector(".variant-search");
    if (oldSearch) oldSearch.remove();

    group.variants.forEach(v => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "variant-option";
      btn.textContent = (v.variant && v.variant.trim())
        ? `${v.variant} — Rp${Number(v.price).toLocaleString()}`
        : `${group.name} — Rp${Number(v.price).toLocaleString()}`;
      // compact styling for variant buttons
      styleVariantButton(btn);
      btn.addEventListener("click", () => {
        addBuyItem(v, promoLinkId);
        closeModal();
        // Trigger promos after buy item is confirmed
        triggeredPromos.forEach(promo => {
          const freeGroup = Object.values(window.groupedProducts)
            .find(g => g.variants.some(vv => vv.id === promo.free_product_id));
          if (freeGroup) {
            const hasFreeVariants = freeGroup.variants.length > 1 || !!freeGroup.variants[0]?.variant;
            const qtyToAdd = Number(promo.free_qty) > 0 ? Number(promo.free_qty) : 1;
            for (let i = 0; i < qtyToAdd; i++) {
              if (hasFreeVariants) {
                showVariantSelectorForPendingFree(freeGroup, promoLinkId);
              } else {
                addToCart({
  id: freeGroup.variants[0].id,
  name: freeGroup.name,
  price: 0,
  variant: freeGroup.variants[0]?.variant || null,
  category: freeGroup.category || "",
  isPromoFree: true,
  promoLinkId
});

                highlightCartItemByName(freeGroup.name);
              }
            }
          }
        });
      });
      options.appendChild(btn);
    });
    modal.classList.remove("hidden");
  } else {
    // No variants for buy item
    addBuyItem(chosenVariant, promoLinkId);
    triggeredPromos.forEach(promo => {
      const freeGroup = Object.values(window.groupedProducts)
        .find(g => g.variants.some(vv => vv.id === promo.free_product_id));
      if (freeGroup) {
        const hasFreeVariants = freeGroup.variants.length > 1 || !!freeGroup.variants[0]?.variant;
        const qtyToAdd = Number(promo.free_qty) > 0 ? Number(promo.free_qty) : 1;
        for (let i = 0; i < qtyToAdd; i++) {
          if (hasFreeVariants) {
            showVariantSelectorForPendingFree(freeGroup, promoLinkId);
          } else {
            addToCart({
  id: freeGroup.variants[0].id,
  name: freeGroup.name,
  price: 0,
  variant: freeGroup.variants[0]?.variant || null,
  category: freeGroup.category || "",
  isPromoFree: true,
  promoLinkId
});

            highlightCartItemByName(freeGroup.name);
          }
        }
      }
    });
  }
};

/***********************
 * Utility: configure + style variant options container & buttons
 * - makes the options container scrollable + compact
 * - optionally adds a search input when there are a lot of options
 ***********************/
function configureVariantOptionsContainer(optionsEl, variantCount) {
  if (!optionsEl) return;
  // reset any inline styles
  optionsEl.style.maxHeight = "320px";
  optionsEl.style.overflowY = "auto";
  optionsEl.style.display = "flex";
  optionsEl.style.flexDirection = "column";
  optionsEl.style.gap = "6px";
  optionsEl.style.padding = "6px 0";

  // remove old search if present
  const existingSearch = optionsEl.parentNode.querySelector(".variant-search");
  if (existingSearch) existingSearch.remove();

  // add search box when there are many variants
  if (variantCount > 12) {
    const search = document.createElement("input");
    search.type = "search";
    search.className = "variant-search";
    search.placeholder = `Filter ${variantCount} options...`;
    search.style.width = "100%";
    search.style.boxSizing = "border-box";
    search.style.marginBottom = "8px";
    search.style.padding = "6px 8px";
    search.style.fontSize = "0.95rem";
    // insert before the options container
    optionsEl.parentNode.insertBefore(search, optionsEl);

    // filter behavior
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      Array.from(optionsEl.querySelectorAll("button")).forEach(btn => {
        btn.style.display = btn.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
  }
}

function styleVariantButton(btn) {
  // compact, full-width, left-aligned variant button styling (inline so no external CSS needed)
  btn.style.padding = "8px 10px";
  btn.style.fontSize = "0.92rem";
  btn.style.textAlign = "left";
  btn.style.width = "100%";
  btn.style.borderRadius = "6px";
  btn.style.border = "1px solid #e5e7eb";
  btn.style.background = "#fff";
  btn.style.color = "#111827";   // ✅ dark text for readability
  btn.style.cursor = "pointer";
  btn.style.boxSizing = "border-box";
  btn.style.transition = "background .12s, transform .06s";
  btn.addEventListener("mouseover", () => { btn.style.background = "#f8fafc"; });
  btn.addEventListener("mouseout", () => { btn.style.background = "#fff"; });
  btn.addEventListener("mousedown", () => { btn.style.transform = "translateY(1px)"; });
  btn.addEventListener("mouseup", () => { btn.style.transform = ""; });
}

/***********************
 * Show variant selector for pending free (freebie)
 ***********************/
function showVariantSelectorForPendingFree(group, promoLinkId) {
  if (!userHasInteracted) return;
  const modal = document.getElementById("variantModal");
  const options = document.getElementById("variantOptions");
  const title = document.getElementById("variantTitle");
  if (!modal || !options) return;

  // Mark modal for freebie styling
  modal.classList.add("freebie");

  // Clear old content
  options.innerHTML = "";
  // configure container + search when many variants
  configureVariantOptionsContainer(options, group.variants.length);

  if (title) {
    title.textContent = `🎁 Choose your FREE ${group.variant_label || "option"} for ${group.name}`;
    // remove any old note
    const oldNote = options.parentNode.querySelector(".freebie-note");
    if (oldNote) oldNote.remove();
    const note = document.createElement("p");
    note.className = "freebie-note";
    note.textContent = "This item is included for free with your order.";
    note.style.color = "#28a745";
    note.style.fontWeight = "500";
    note.style.marginBottom = "8px";
    options.parentNode.insertBefore(note, options);
  }

  group.variants.forEach(v => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "variant-option";
    btn.textContent = (v.variant && v.variant.trim())
      ? `${v.variant} — Rp0`
      : `${group.name} — Rp0`;
    styleVariantButton(btn);
    btn.addEventListener("click", () => {
      addToCart({
  id: v.id,
  name: group.name,
  price: 0,
  variant: v.variant || null,
  category: group.category || "",
  isPromoFree: true,
  promoLinkId
});

      highlightCartItemByName(group.name);
      closeModal();
    });
    options.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

/***********************
 * Show variant selector for item already in cart (to update)
 ***********************/
function showVariantSelectorFor(cartIndex, group, forcePriceZero = false) {
  if (!userHasInteracted) return;
  const modal = document.getElementById("variantModal");
  const options = document.getElementById("variantOptions");
  const title = document.getElementById("variantTitle");
  if (!modal || !options) return;

  // Toggle freebie styling
  if (forcePriceZero) modal.classList.add("freebie");
  else modal.classList.remove("freebie");

  // Clear and configure
  options.innerHTML = "";
  configureVariantOptionsContainer(options, group.variants.length);

  if (title) {
    if (forcePriceZero) {
      modal.classList.add("freebie");
      title.textContent = `🎁 Choose your FREE ${group.variant_label || "option"} for ${group.name}`;
      const oldNote = options.parentNode.querySelector(".freebie-note");
      if (oldNote) oldNote.remove();
      const note = document.createElement("p");
      note.className = "freebie-note";
      note.textContent = "This item is included for free with your order.";
      note.style.color = "#28a745";
      note.style.fontWeight = "500";
      note.style.marginBottom = "8px";
      options.parentNode.insertBefore(note, options);
    } else {
      modal.classList.remove("freebie");
      title.textContent = group.variant_label
        ? `Choose ${group.variant_label} for ${group.name}`
        : `Choose option for ${group.name}`;
      const oldNote = options.parentNode.querySelector(".freebie-note");
      if (oldNote) oldNote.remove();
    }
  }

  group.variants.forEach(v => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "variant-option";
    const priceText = forcePriceZero ? "Rp0" : `Rp${Number(v.price).toLocaleString()}`;
    btn.textContent = (v.variant && v.variant.trim())
      ? `${v.variant} — ${priceText}`
      : `${group.name} — ${priceText}`;
    styleVariantButton(btn);

    btn.addEventListener("click", () => {
      const idx = Number(cartIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cart.length) {
        closeModal();
        return;
      }
      cart[idx].id = v.id;
      cart[idx].name = group.name;
      cart[idx].variant = v.variant || null;
      cart[idx].price = forcePriceZero ? 0 : Number(v.price) || 0;

      saveCartToStorage();
      renderCart();
      startSessionTimeout();
      closeModal();
    });

    options.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

/***********************
 * Variant selector modal
 ***********************/
function showVariantSelector(group, forcePriceZero = false, cartIndex = null) {
  const modal = document.getElementById("variantModal");
  const options = document.getElementById("variantOptions");
  const title = document.getElementById("variantTitle");
  if (!modal || !options) return;

  // Freebie styling
  if (forcePriceZero) modal.classList.add("freebie");
  else modal.classList.remove("freebie");

  options.innerHTML = "";
  configureVariantOptionsContainer(options, group.variants.length);

  // Title and optional freebie note
  if (title) {
    const oldNote = options.parentNode.querySelector(".freebie-note");
    if (oldNote) oldNote.remove();

    if (forcePriceZero) {
      title.textContent = `🎁 Choose your FREE ${group.variant_label || "option"} for ${group.name}`;
      const note = document.createElement("p");
      note.className = "freebie-note";
      note.textContent = "This item is included for free with your order.";
      note.style.color = "#28a745";
      note.style.fontWeight = "500";
      note.style.marginBottom = "8px";
      options.parentNode.insertBefore(note, options);
    } else {
      title.textContent = group.variant_label
        ? `Choose ${group.variant_label} for ${group.name}`
        : `Choose option for ${group.name}`;
    }
  }

  // Add variant buttons
  group.variants.forEach(v => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "variant-option";
    const priceText = forcePriceZero ? "Rp0" : `Rp${Number(v.price).toLocaleString()}`;
    btn.textContent = (v.variant && v.variant.trim())
      ? `${v.variant} — ${priceText}`
      : `${group.name} — ${priceText}`;

    styleVariantButton(btn);

    btn.addEventListener("click", () => {
      if (cartIndex !== null) {
        // Updating an existing cart item
        const idx = Number(cartIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= cart.length) {
          closeModal();
          return;
        }
        cart[idx].id = v.id;
        cart[idx].name = group.name;
        cart[idx].variant = v.variant || null;
        cart[idx].price = forcePriceZero ? 0 : Number(v.price) || 0;
      } else {
        // Adding new item
        addToCart({
          id: v.id,
          name: group.name,
          price: forcePriceZero ? 0 : Number(v.price) || 0,
          variant: v.variant || null,
          category: group.category || "",
          isPromoFree: forcePriceZero,
          promoLinkId: forcePriceZero ? v.promoLinkId : null
        });
      }

      renderCart();
      startSessionTimeout();
      closeModal();
    });

    options.appendChild(btn);
  });

  modal.classList.remove("hidden");
}


function closeModal() {
  const modal = document.getElementById("variantModal");
  if (!modal) return;
  // Clean up search / notes inside modal to avoid duplicates next open
  const search = modal.querySelector(".variant-search");
  if (search) search.remove();
  const note = modal.querySelector(".freebie-note");
  if (note) note.remove();
  modal.classList.add("hidden");
}

/***********************
 * Cart storage helpers (TTL only for guests/no active session)
 ***********************/
function restoreCartFromStorage() {
  const saved = localStorage.getItem("cart");
  if (!saved) return;

  const savedAt = Number(localStorage.getItem("cartSavedAt") || 0);
  const sessionStart = Number(localStorage.getItem("sessionStart") || 0);
  const hasActiveSession = !!localStorage.getItem("currentUser") &&
    sessionStart && (Date.now() - sessionStart < 3600000);

  // Expire cart only if no active session
  if (!hasActiveSession && savedAt && Date.now() - savedAt > 3600000) {
    localStorage.removeItem("cart");
    localStorage.removeItem("cartSavedAt");
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      cart = parsed;
      renderCart();
    }
  } catch (e) {
    console.warn("Failed to parse saved cart:", e);
  }
}

function saveCartToStorage() {
  localStorage.setItem("cart", JSON.stringify(cart));
  localStorage.setItem("cartSavedAt", Date.now().toString());
}

/***********************
 * Cart operations
 ***********************/
function addToCart(product) {
  if (!product) return;

  // ✅ Keep promo-free items as distinct lines
  if (product.isPromoFree) {
    cart.push({ ...product, qty: 1 });
  } else {
    const key = product.variant || "default";
    const existing = cart.find(c =>
      c.id === product.id &&
      (c.variant || "default") === key &&
      !c.isPromoFree // only merge with other paid items
    );
    if (existing) {
      existing.qty++;
    } else {
      cart.push({ ...product, qty: 1 });
    }
  }

  saveCartToStorage();
  renderCart();
  startSessionTimeout();
  showBanner(`${product.name}${product.variant ? ` (${product.variant})` : ""} added to cart`, 2000);
}

function renderCart() {
  const list = document.querySelector(".cart-list");
  const totalEl = document.getElementById("cart-total");
  if (!list) return;
  list.innerHTML = "";
  let total = 0;

  cart.forEach((item, idx) => {
    total += item.price * item.qty;

    const li = document.createElement("li");
    li.className = "cart-item";

const nameSpan = document.createElement("span");
    nameSpan.className = "cart-item-name";
    nameSpan.dataset.productName = item.name;
    nameSpan.dataset.index = String(idx);
    nameSpan.dataset.promoFree = item.isPromoFree ? "1" : "0";
nameSpan.textContent = String(item.name || "Unnamed") + (item.variant ? ` — ${item.variant}` : "");

    // If this line is a promo free item, show a small label and allow clicking to choose variant
    if (item.isPromoFree) {
      nameSpan.style.cursor = "pointer";
      nameSpan.title = "Click to choose free item variant";
      nameSpan.addEventListener("click", () => {
        const group = window.groupedProducts?.[item.name];
        if (group) showVariantSelector(group, true, idx);
      });
    }

    li.appendChild(nameSpan);

    // 'Promo Free' badge immediately after name (light styling inline to avoid depending on external CSS)
    if (item.isPromoFree) {
      const badge = document.createElement("span");
      badge.className = "promo-free-badge";
      badge.textContent = "Promo Free";
      badge.style.marginLeft = "8px";
      badge.style.background = "#28a745";
      badge.style.color = "#fff";
      badge.style.fontSize = "11px";
      badge.style.padding = "2px 6px";
      badge.style.borderRadius = "999px";
      badge.style.verticalAlign = "middle";
      li.appendChild(badge);
    }

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "qty-adjuster";

    const decBtn = document.createElement("button");
    decBtn.className = "icon-btn dec";
    decBtn.dataset.index = String(idx);

    decBtn.textContent = "−";
    qtyWrap.appendChild(decBtn);

    const qtySpan = document.createElement("span");
    qtySpan.className = "item-qty";
    qtySpan.textContent = item.qty;
    qtyWrap.appendChild(qtySpan);

    const incBtn = document.createElement("button");
    incBtn.className = "icon-btn inc";
    incBtn.dataset.index = String(idx);

    incBtn.textContent = "+";
    qtyWrap.appendChild(incBtn);

    li.appendChild(qtyWrap);

    const priceSpan = document.createElement("span");
    priceSpan.className = "item-price";
    priceSpan.textContent = `Rp${(item.price * item.qty).toLocaleString()}`;
    li.appendChild(priceSpan);

    list.appendChild(li);
  });

  if (totalEl) totalEl.textContent = `Rp${total.toLocaleString()}`;
}

function increaseQtyByIndex(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= cart.length) return;
  cart[i].qty += 1;
  saveCartToStorage();
  renderCart();
  startSessionTimeout();
}

function removeLinkedFreebies(promoLinkId) {
  if (!promoLinkId) return;
  cart = cart.filter(item => item.promoLinkId !== promoLinkId || item.isPromoFree === false);
}

function decreaseQtyByIndex(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= cart.length) return;
  const removedItem = cart[i];
  cart[i].qty -= 1;
  if (cart[i].qty <= 0) {
    cart.splice(i, 1);
    if (!removedItem.isPromoFree && removedItem.promoLinkId) {
      removeLinkedFreebies(removedItem.promoLinkId);
    }
  }
  saveCartToStorage();
  renderCart();
  startSessionTimeout();
}

function removeFromCart(id, variant = "") {
  const removedItem = cart.find(item => item.id === id && (item.variant || "") === variant);
  cart = cart.filter(item => !(item.id === id && (item.variant || "") === variant));
  if (removedItem && !removedItem.isPromoFree && removedItem.promoLinkId) {
    removeLinkedFreebies(removedItem.promoLinkId);
  }
  saveCartToStorage();
  renderCart();
}

/***********************
 * Toggle cart visibility
 ***********************/
function toggleCart() {
  const cartBody = document.getElementById("cart-body");
  const toggleBtn = document.getElementById("toggleCartBtn");
  if (cartBody && toggleBtn) {
    const isHidden = cartBody.classList.contains("hidden");
    cartBody.classList.toggle("hidden");
    toggleBtn.textContent = isHidden ? "❌ Hide Cart" : "🛒 Show Cart";
  }
}

/***********************
 * Checkout flow
 ***********************/
const checkoutBtn = document.getElementById("checkoutBtn");
if (checkoutBtn) {
  checkoutBtn.addEventListener("click", async () => {
    if (cart.length === 0) {
      showBanner("Your cart is empty", 3000);
      return;
    }
    if (currentUser?.phoneNumber && !currentUser?.tier) {
      await fetchMemberTier(currentUser.phoneNumber);
    }
    // Calculate subtotal normally
    const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    // Delivery fee (example: apply if table = "Delivery")
const deliveryFee = (tableNumber.toLowerCase() === "delivery") ? 10000 : 0;


// Discount only applies to items NOT in "Special Today"
// Compute discountRate robustly: prefer numeric currentUser.discountRate if present,
// otherwise derive from the stored tier using the canonical helper.
const discountRate = getEffectiveDiscountRate(currentUser);


const discount = cart.reduce((sum, i) => {
  const isSpecial = (i.category || "") === "Special Today";
  if (currentUser.tier === "classic" || isSpecial) return sum;
  return sum + (Number(i.price || 0) * Number(i.qty || 0) * discountRate);
}, 0);


    // Tax (still applied to all items including Special Today)
    const taxRate = typeof currentUser?.taxRate === "number" ? currentUser.taxRate : 0.10;
    const tax = (subtotal - discount) * taxRate;

    
// Total rounded to nearest 100, including delivery fee
const total = Math.round((subtotal - discount + tax + deliveryFee) / 100) * 100;

    const items = cart.map(i => ({
      name: i.name + (i.variant ? ` (${i.variant})` : ""),
      qty: i.qty
    }));

const query = new URLSearchParams({
  subtotal: String(subtotal),
  discount: String(discount),
  tax: String(tax),
  deliveryFee: String(deliveryFee),   // ✅ add this
  total: String(total),
  table: tableNumber,
  guestName: currentUser?.displayName || "Guest",
  memberPhone: currentUser?.phoneNumber || "",
  memberId: currentUser?.memberId || "",
  tier: currentUser?.tier || "Guest",
  items: JSON.stringify(items)
}).toString();


    window.location.href = `summary.html?${query}`;
  });
}

/***********************
 * Staff page scoped logic
 ***********************/
function initStaffMessaging() {
  const messaging = firebase.messaging();
  const vapidKey = "BB46kklO696abLSqlK13UKbJh5zCJR-ZCjNa4j4NE08X7JOSJM_IpsJIjsLck4Aqx9QEnQ6Rid4gjLhk1cNjd2w";

  navigator.serviceWorker.register("/firebase-messaging-sw.js")
    .then(reg => console.log("✅ Service Worker registered:", reg))
    .catch(err => console.error("❌ SW registration failed:", err));

  // Auto-fetch token if already granted
  if ("Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker.ready.then(registration => {
      messaging.getToken({ vapidKey, serviceWorkerRegistration: registration })
        .then(token => console.log("📲 FCM Token:", token))
        .catch(err => console.error("❌ Token fetch error:", err));
    });
  }

  // Gate notification request behind a button
  const notifBtn = document.getElementById("enableNotifications");
  if (notifBtn) {
    notifBtn.addEventListener("click", () => {
      if (!("Notification" in window)) {
        alert("🔕 Notifications are not supported in this browser.");
        return;
      }
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          navigator.serviceWorker.ready.then(registration => {
            messaging.getToken({ vapidKey, serviceWorkerRegistration: registration })
              .then(token => console.log("📲 FCM Token:", token))
              .catch(err => console.error("❌ Token fetch error:", err));
          });
          AudioChime.unlockByGesture(); // unlock chime on same gesture
        } else if (permission === "denied") {
          alert("🔕 Notifications are blocked. Please enable them in browser settings.");
        }
      });
    });
  }

  // Foreground messages
  messaging.onMessage(payload => {
    const { title, body } = payload.notification || {};
    if (title && body) alert(`${title}\n\n${body}`);
    AudioChime.requestChime();
  });

  // PWA install prompt
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    const installBtn = document.getElementById("installBtn");
    if (installBtn) {
      installBtn.style.display = "block";
      installBtn.onclick = () => {
        e.prompt();
        e.userChoice.then(choice => {
          console.log("📲 PWA install:", choice.outcome);
          installBtn.style.display = "none";
        });
      };
    }
  });
}

/***********************
 * Order filtering + listen by date (staff)
 ***********************/
let currentFilter = "all";
function filterOrders(status) {
  currentFilter = status;
  document.querySelectorAll(".order").forEach(el => {
    // use kitchenStatus if available, otherwise fall back to mille/order status
    const orderStatus = ((el.dataset.kitchenStatus || el.dataset.status) || "").toLowerCase();
    const isIncoming = status === "incoming" && ["pending", "preparing"].includes(orderStatus);
    el.style.display = (status === "all" || isIncoming || orderStatus === status) ? "" : "none";
  });
}
window.filterOrders = filterOrders;


/***********************
 * Persistent chime repeater
***********************/
let chimeRepeatTimer = null;
let repeatOrderIds = new Set();

function startRepeatingChimes() {
  if (chimeRepeatTimer) return; // already running
  chimeRepeatTimer = setInterval(() => {
    if (repeatOrderIds.size > 0) {
      console.log("🔁 Repeating chime for pending orders:", [...repeatOrderIds]);
      AudioChime.requestChime();
    }
  }, 7000);
}

function stopRepeatingChimes() {
  if (chimeRepeatTimer) {
    clearInterval(chimeRepeatTimer);
    chimeRepeatTimer = null;
  }
  repeatOrderIds.clear();
}

/***********************
 * Order card styling
 ***********************/
function styleOrderBox(el, status) {
  const s = (status || "").toLowerCase();
  const palette = {
    pending:   { bg: "#ffffff", border: "#e5e7eb", text: "#111827" },
    preparing: { bg: "#fff7ed", border: "#f59e0b", text: "#7c2d12" },
    served:    { bg: "#ecfdf5", border: "#10b981", text: "#064e3b" },
    cancelled: { bg: "#f3f4f6", border: "#9ca3af", text: "#374151" },
    default:   { bg: "#f9fafb", border: "#e5e7eb", text: "#111827" }
  };
  const c = palette[s] || palette.default;
  el.style.backgroundColor = c.bg;
  el.style.border = `1px solid ${c.border}`;
  el.style.borderRadius = "8px";
  el.style.padding = "10px";
  el.style.marginBottom = "10px";
  el.style.color = c.text;
}

/***********************
 * Loyalty helpers — strict, idempotent
 ***********************/
function calculatePoints(total) {
  const RATE_RP_PER_POINT = 10000;
  return Math.floor((Number(total) || 0) / RATE_RP_PER_POINT);
}

/***********************
 * Loyalty + order updates
 ***********************/
async function updateOrderStatusAndMaybeRecordLoyalty(orderId, targetKitchenStatus) {
  const orderRef = db.collection("orders").doc(orderId);
  const ratesDocRef = db.collection("settings").doc("cashbackRates");
  const tierSettingsRef = db.collection("settings").doc("tierThresholds");

  await db.runTransaction(async (t) => {
    const orderSnap = await t.get(orderRef);
    if (!orderSnap.exists) throw new Error("Order not found");
    const order = orderSnap.data();

    const memberId = order.memberId || null;
    const memberPhone = order.memberPhone || null;
    const memberRef = memberId ? db.collection("members").doc(memberId) : null;
    const memberSnap = memberRef ? await t.get(memberRef) : null;

    let ratesDoc = null;
    try { ratesDoc = await t.get(ratesDocRef); } catch (_) {}
    const rates = ratesDoc?.exists ? (ratesDoc.data() || {}) : {};

    let thresholdsDoc = null;
    try { thresholdsDoc = await t.get(tierSettingsRef); } catch (_) {}
    const tierSettings = thresholdsDoc?.exists ? (thresholdsDoc.data() || {}) : {};

    const alreadyRecorded = !!order.loyaltyRecorded;
    const total = Number(order.total) || 0;
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // 🔴 CANCELLED case
    if (targetKitchenStatus === "cancelled" && alreadyRecorded && order.loyaltyTxId && memberRef && memberSnap?.exists) {
      const member = memberSnap.data();
      const txList = Array.isArray(member.transactions) ? member.transactions : [];

      const filteredTxs = txList.filter(tx =>
        !(tx.date?.startsWith(todayStr) && tx.amount === total && tx.note?.includes("POS: Served order"))
      );

      const cashbackToRemove = txList
        .filter(tx => tx.date?.startsWith(todayStr) && tx.amount === total && tx.cashback)
        .reduce((sum, tx) => sum + Number(tx.cashback || 0), 0);

      const spendingToRemove = txList
        .filter(tx => tx.date?.startsWith(todayStr) && tx.amount === total)
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

      const { monthlySinceUpgrade, yearlySinceUpgrade } = recalcSinceUpgrade(filteredTxs, member.upgradeDate);

      // 🔹 Inline tier recalculation
      const updatedMember = { ...member, transactions: filteredTxs, monthlySinceUpgrade, yearlySinceUpgrade };
      recalcTier(updatedMember, tierSettings);

      t.update(memberRef, {
        transactions: filteredTxs,
        redeemablePoints: Math.max(0, (member.redeemablePoints || 0) - cashbackToRemove),
        spendingSinceUpgrade: Math.max(0, (member.spendingSinceUpgrade || 0) - spendingToRemove),
        monthlySinceUpgrade,
        yearlySinceUpgrade,
        tier: updatedMember.tier
      });

      const txRef = db.collection("loyalty_transactions").doc(order.loyaltyTxId);
      t.delete(txRef);

      t.update(orderRef, {
        kitchenStatus: targetKitchenStatus,
        loyaltyRecorded: false,
        loyaltyTxId: null
      });
      return;
    }

    // 🟢 SERVED case
    if (targetKitchenStatus === "served" && !alreadyRecorded && (memberId || memberPhone)) {
      const member = memberSnap?.data() || {};
      const tierRaw = (member.tier || "Bronze").toString().trim();
      const tier = tierRaw.charAt(0).toUpperCase() + tierRaw.slice(1).toLowerCase();

      const isBirthday = !!member.birthdate && (() => {
        const b = new Date(member.birthdate);
        return b.getMonth() === now.getMonth() && b.getDate() === now.getDate();
      })();

      const goldRate = Number(rates.goldCashbackRate ?? 5);
      const silverRate = Number(rates.silverCashbackRate ?? 5);
      const birthdayGoldRate = Number(rates.birthdayGoldCashbackRate ?? 30);
      const goldCap = Number(rates.goldDailyCashbackCap ?? 30000);
      const silverCap = Number(rates.silverDailyCashbackCap ?? 15000);

      const rate =
        tier === "Gold" && isBirthday ? birthdayGoldRate :
        tier === "Gold" ? goldRate :
        tier === "Silver" ? silverRate : 0;

      const cap = tier === "Gold" ? goldCap : tier === "Silver" ? silverCap : 0;

      const txList = Array.isArray(member.transactions) ? member.transactions : [];
      const todayCashback = txList
        .filter(tx => tx.date?.startsWith(todayStr) && tx.cashback)
        .reduce((sum, tx) => sum + Number(tx.cashback || 0), 0);

      let cashback = Math.floor((total * rate) / 100);
      if (cap > 0 && todayCashback + cashback > cap) {
        cashback = Math.max(0, cap - todayCashback);
      }

      const memberTx = {
        date: now.toISOString(),
        amount: total,
        cashback,
        note: (cap > 0 && todayCashback + cashback === cap)
          ? `Cashback capped at Rp${cap.toLocaleString()} today`
          : "Recorded from POS: Served order"
      };

      const txRef = db.collection("loyalty_transactions").doc();
      const loyaltyTx = {
        txId: txRef.id,
        orderId: orderRef.id,
        memberPhone: memberPhone || null,
        memberId: memberRef ? memberRef.id : null,
        memberName: order.guestName || null,
        date: order.date || todayStr,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        total,
        pointsEarned: Math.floor(total / 10000),
        source: "staff-served",
        table: order.table || null
      };
      t.set(txRef, loyaltyTx);

      if (memberRef && memberSnap?.exists) {
        const updatedTxs = txList.concat(memberTx);
        const newRedeemable = Math.max(0, (member.redeemablePoints || 0) + cashback);
        const newSpending = Math.max(0, (member.spendingSinceUpgrade || 0) + total);

        const { monthlySinceUpgrade, yearlySinceUpgrade } = recalcSinceUpgrade(updatedTxs, member.upgradeDate);

        // 🔹 Inline tier recalculation
        const updatedMember = { ...member, transactions: updatedTxs, monthlySinceUpgrade, yearlySinceUpgrade };
        recalcTier(updatedMember, tierSettings);

        t.update(memberRef, {
          transactions: updatedTxs,
          redeemablePoints: newRedeemable,
          spendingSinceUpgrade: newSpending,
          monthlySinceUpgrade,
          yearlySinceUpgrade,
          tier: updatedMember.tier
        });
      }

      t.update(orderRef, {
        kitchenStatus: targetKitchenStatus,
        loyaltyRecorded: true,
        loyaltyTxId: txRef.id
      });
      return;
    }

    // Default: just update kitchenStatus
    t.update(orderRef, { kitchenStatus: targetKitchenStatus });
  });
}

// 🔹 Helper to recalc monthly/yearly since upgrade
function recalcSinceUpgrade(transactions, upgradeDate) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const upgradeDt = upgradeDate ? new Date(upgradeDate) : null;

  let yearlySinceUpgrade = 0;
  let monthlySinceUpgrade = 0;

  (transactions || []).forEach(tx => {
    const d = new Date(tx.date);
    if (d.getFullYear() === currentYear) {
      if (!upgradeDt || d > upgradeDt) {
        yearlySinceUpgrade += tx.amount;
        if (d.getMonth() === currentMonth) monthlySinceUpgrade += tx.amount;
      }
    }
  });

  return { monthlySinceUpgrade, yearlySinceUpgrade };
}

// 🔹 Inline tier recalculation logic
function recalcTier(member, t) {
  const thresholds = t?.thresholds || t || {};
  const bronzeToSilverMonth = thresholds.bronzeToSilverMonth ?? 500000;
  const bronzeToSilverYear  = thresholds.bronzeToSilverYear  ?? 1200000;
  const silverStayYear      = thresholds.silverStayYear      ?? 500000;
  const silverToGoldMonth   = thresholds.silverToGoldMonth   ?? 1250000;
  const silverToGoldYear    = thresholds.silverToGoldYear    ?? 4000000;
  const goldStayYear        = thresholds.goldStayYear        ?? 2000000;

  const currentTier = toProperTier(member.tier);
  const monthSpend  = member.monthlySinceUpgrade ?? 0;
  const yearSpend   = member.yearlySinceUpgrade ?? 0;

  // Creation-year check
  let createdYear = null;
  if (member.createdAt) {
    const createdDate = member.createdAt.toDate ? member.createdAt.toDate() : new Date(member.createdAt);
    if (createdDate instanceof Date && !isNaN(createdDate)) {
      createdYear = createdDate.getFullYear();
    }
  }
  const thisYear = new Date().getFullYear();
  const isNewThisYear = createdYear === thisYear;

  let newTier = currentTier;

  if (currentTier === "Bronze") {
    if (monthSpend >= bronzeToSilverMonth || yearSpend >= bronzeToSilverYear) {
      newTier = "Silver";
      member.monthlySinceUpgrade = 0;
      member.yearlySinceUpgrade = 0;
    }
  }
  else if (currentTier === "Silver") {
    if (monthSpend >= silverToGoldMonth || yearSpend >= silverToGoldYear) {
      newTier = "Gold";
      member.monthlySinceUpgrade = 0;
      member.yearlySinceUpgrade = 0;
    }
    else if (!isNewThisYear && yearSpend < silverStayYear) {
      newTier = "Bronze";
    }
  }
  else if (currentTier === "Gold") {
    if (!isNewThisYear && yearSpend < goldStayYear) {
      newTier = "Silver";
    }
  }

  member.tier = newTier;
  return member;
}

// 🔹 Helper to normalise tier string
function toProperTier(tier) {
  if (!tier) return "Bronze";
  const str = tier.toString().trim().toLowerCase();
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/***********************
 * Listen and render orders (staff)
 ***********************/
function listenForOrders(selectedDate) {
  if (typeof unsubscribeOrders === "function") {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  stopRepeatingChimes();

  const ordersContainer = document.getElementById("orderList");
  if (!ordersContainer) return;

  const prevStatuses = new Map();
  // consider a broader set of statuses as "incoming" for staff chime/filter
  const INCOMING_STATUSES = ["pending","incoming","preparing","awaiting","awaiting-proof","awaiting_proof"];
  let initialProcessed = false;

  unsubscribeOrders = db.collection("orders")
    .where("date", "==", selectedDate)
    .orderBy("timestamp", "desc")
    .onSnapshot(snapshot => {
      ordersContainer.innerHTML = "";

      snapshot.forEach(docSnap => {
        const order = docSnap.data();
        const rawStatus = (order.kitchenStatus || "pending").toLowerCase();

        const div = document.createElement("div");
        div.className = "order";
        div.dataset.kitchenStatus = rawStatus;
        styleOrderBox(div, rawStatus);

        // Table + item count
        const tableLine = document.createElement("div");
        const tableStrong = document.createElement("strong");
        tableStrong.textContent = `Table ${order.table}`;
        tableLine.appendChild(tableStrong);
        tableLine.appendChild(document.createTextNode(` - ${(order.items || []).length} items`));
        div.appendChild(tableLine);

        // Status line
        const statusLine = document.createElement("div");
        statusLine.className = "status";
        statusLine.textContent = rawStatus;
        div.appendChild(statusLine);

        // Controls
        const statusControls = document.createElement("div");
        statusControls.className = "status-controls";
// derive protective flags (disable kitchen controls for two cases)
        const tableText = String(order.table || "").toLowerCase();
        const isMilleTable = /mille\s*[123]/i.test(tableText); // true for "Mille 1/2/3"
        const isQrisAwaiting = ((order.paymentMethod||"").toLowerCase().includes("qris"))
                              && ((order.paymentStatus||"").toLowerCase() === "awaiting-proof");

        ["preparing","served","cancelled"].forEach(newStatus => {
          const btn = document.createElement("button");
          btn.textContent = newStatus;
          btn.className = "btn minimal";

          // If this is a Mille table OR QRIS awaiting-proof, disable kitchen action buttons
          if (isMilleTable || isQrisAwaiting) {
            btn.disabled = true;
            btn.title = isQrisAwaiting
              ? "Disabled while waiting for QRIS proof"
              : "Disabled for Mille tables on this view";
            btn.style.opacity = "0.6";
          }

          btn.addEventListener("click", async () => {
            if (statusControls.dataset.busy === "1") return;
            // double-check server-side rules (optimistic guard)
            if (btn.disabled) return;
            statusControls.dataset.busy = "1";
            const buttons = statusControls.querySelectorAll("button");
            const originalTexts = [];
            buttons.forEach(b => { originalTexts.push(b.textContent); b.disabled = true; b.textContent = "…"; });
            try {
              await updateOrderStatusAndMaybeRecordLoyalty(docSnap.id, newStatus);
            } catch (err) {
              console.error("❌ Status update error:", err);
              alert("Failed to update order status.");
            } finally {
              statusControls.dataset.busy = "0";
              buttons.forEach((b,i) => { b.disabled = false; b.textContent = originalTexts[i]; });
            }
          });
          statusControls.appendChild(btn);
        // Debug visibility
        console.debug("Staff order controls:", order.table, newStatus, "-> disabled?", btn.disabled);
        });
        div.appendChild(statusControls);

        ordersContainer.appendChild(div);
      });

      // 🔔 Chime tracking
      repeatOrderIds.clear();
      snapshot.forEach(docSnap => {
        const s = (docSnap.data().kitchenStatus || "").toLowerCase();
        if (INCOMING_STATUSES.includes(s)) repeatOrderIds.add(docSnap.id);
      });
      if (repeatOrderIds.size > 0) startRepeatingChimes();
      else stopRepeatingChimes();

      // Auto-correct if new order arrives with wrong status
      if (initialProcessed) {
        snapshot.docChanges().forEach(async change => {
          if (change.type !== "added") return;
          const now = (change.doc.data().kitchenStatus || "").toLowerCase();
          if (now === "preparing") {
            try {
              await db.collection("orders").doc(change.doc.id).update({ kitchenStatus: "pending" });
            } catch (err) {
              console.warn("Failed to correct to pending:", err);
            }
          }
        });
      }

      // Chime decision
      let shouldChime = false;
      if (!initialProcessed) {
        const hasPending = snapshot.docs.some(d =>
          INCOMING_STATUSES.includes((d.data().kitchenStatus || "").toLowerCase())
        );
        shouldChime = hasPending;
        initialProcessed = true;
      } else {
        snapshot.docChanges().forEach(change => {
          const now = (change.doc.data().kitchenStatus || "").toLowerCase();
          if (!INCOMING_STATUSES.includes(now)) return;
          if (change.type === "added") shouldChime = true;
          else if (change.type === "modified") {
            const before = prevStatuses.get(change.doc.id);
            if (!INCOMING_STATUSES.includes(before)) shouldChime = true;
          }
        });
      }
      if (shouldChime) {
        // prefer first unseen incoming order to target repeating chime & modal
        const candidate = snapshot.docs.find(d => {
          const doc = d.data();
          const now = ((doc.kitchenStatus || doc.status || doc.milleStatus || "")).toLowerCase();
          return INCOMING_STATUSES.includes(now) && !staffShownModals.has(d.id);
        });
        if (candidate) {
          const id = candidate.id;
          const doc = candidate.data();
          // if QRIS awaiting-proof: play a single notification but do NOT start repeating chime
          const method = (doc.paymentMethod || "").toLowerCase();
          const paymentStatus = (doc.paymentStatus || "").toLowerCase();
          if (method.includes("qris") && paymentStatus === "awaiting-proof") {
            // single play (foreground)
            AudioChime.requestChime();
            // still show a non-repeating banner/modal so staff sees it
            showStaffModalForOrder(id, doc);
            staffShownModals.add(id);
          } else {
            // normal case: start repeating chime until staff stops it
            RepeatingChime.start(id);
            showStaffModalForOrder(id, doc);
            staffShownModals.add(id);
          }
        } else {
          // fallback: single chime
          AudioChime.requestChime();
        }
      }

      // Update prevStatuses
      snapshot.forEach(docSnap => {
        prevStatuses.set(docSnap.id, (docSnap.data().kitchenStatus || "").toLowerCase());
      });

      // Apply filter
      filterOrders(currentFilter);
    });
}

/***********************
 * Staff DOM bootstrap
 ***********************/
function initStaffUI() {
  AudioChime.primeMutedAutoplay();
  AudioChime.attachGestureUnlock();

  const dateInput = document.getElementById("orderDate");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.value = today;
    listenForOrders(today);
    filterOrders("incoming");
    dateInput.addEventListener("change", () => {
      listenForOrders(dateInput.value);
      filterOrders("incoming");
    });
  }

  setTimeout(() => {
    if (!AudioChime.isUnlocked()) {
      showBanner("🔔 Tap anywhere to enable sound alerts", 4000);
    }
  }, 2000);
}

function initStaff() {
  initStaffMessaging();
  initStaffUI();
}

/***********************
 * Customer DOM bootstrap
 ***********************/
async function initCustomer() {
  if (!document.getElementById("banner")) {
    const banner = document.createElement("div");
    banner.id = "banner";
    banner.className = "banner hidden";
    document.body.appendChild(banner);
  }

  // Restore session + cart
  const savedUser = localStorage.getItem("currentUser");
  const sessionStart = localStorage.getItem("sessionStart");
if (savedUser && sessionStart) {
  const elapsed = Date.now() - Number(sessionStart);
  if (elapsed < 3600000) {
    currentUser = JSON.parse(savedUser);
    // Ensure persisted discountRate is normalized
    currentUser.discountRate = normalizeDiscountRate(currentUser.discountRate ?? getDiscountByTier(currentUser.tier));
    const userStatus = document.getElementById("userStatus");
    if (userStatus) userStatus.textContent = currentUser.displayName || "Guest";
    startSessionTimeout();
  } else {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("sessionStart");
      localStorage.removeItem("cart");
      localStorage.removeItem("cartSavedAt");
      showBanner("Session expired. Please sign in again.", 5000);
    }
  }
  restoreCartFromStorage();

  // Set table label
  const tableInfo = document.getElementById("tableInfo");
  if (tableInfo) tableInfo.textContent = `Table ${tableNumber}`;

  /*************************
   * Auth modal (Sign In / Sign Up) bindings
   *************************/
  const signInBtn = document.getElementById("signInBtn");
  const authModal = document.getElementById("authModal");
  const authSignIn = document.getElementById("authSignIn");
  const authSignUp = document.getElementById("authSignUp");
  const authClose = document.getElementById("closeAuth");

  // Utility: update header sign-in button to show member name if signed in
  function updateHeaderSigninButton() {
    const btn = document.getElementById("signInBtn");
    if (!btn) return;
    if (currentUser && currentUser.displayName) {
      btn.textContent = currentUser.displayName;
      btn.dataset.memberId = currentUser.memberId || "";
      btn.classList.add("signed-in");
      btn.setAttribute("aria-label", `Signed in as ${currentUser.displayName}`);
    } else {
      btn.textContent = "Member Sign In";
      btn.removeAttribute("data-member-id");
      btn.classList.remove("signed-in");
      btn.setAttribute("aria-label", "Member Login");
    }
  }

  // Ensure header button reflects persisted session on load
  updateHeaderSigninButton();

  // Open the auth modal
  if (signInBtn && authModal) {
    signInBtn.addEventListener("click", () => {
      authModal.classList.remove("hidden");
      // optional: focus an input if you add one later
    });
  }

  // Close handler
  if (authClose && authModal) {
    authClose.addEventListener("click", () => authModal.classList.add("hidden"));
  }
  if (authModal) {
    authModal.addEventListener("click", (e) => {
      if (e.target === authModal) authModal.classList.add("hidden");
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (authModal && !authModal.classList.contains("hidden")) authModal.classList.add("hidden");
      closeModal();
    }
  });

  // Helper to normalize phone numbers
  const normalizePhone = (input) => {
    return input
      .replace(/[^\d+]/g, "")
      .replace(/^\+?62/, "0")
      .replace(/^0+/, "0");
  };

  // Sign-in logic (using modal -> prompt for phone)
  if (authSignIn) {
    authSignIn.addEventListener("click", async () => {
      const input = prompt("Enter your phone number (e.g. 081234567890):");
      if (!input) return;
      const phone = normalizePhone(input);

      try {
        const snapshot = await db.collection("members").where("phone", "==", phone).limit(1).get();
        if (snapshot.empty) {
          showBanner("Phone number not found. Please sign up.", 4000);
          return;
        }
        const memberDoc = snapshot.docs[0];
        const member = memberDoc.data();
        currentUser = {
          phoneNumber: phone,
          memberId: memberDoc.id,
          tier: member.tier,
          discountRate: member.discountRate ?? getDiscountByTier(member.tier),
          taxRate: member.taxRate ?? 0.10,
          displayName: member.name || "Guest"
        };
        localStorage.setItem("currentUser", JSON.stringify(currentUser));
        localStorage.setItem("sessionStart", Date.now().toString());
        // update header button text to member name
        updateHeaderSigninButton();
        const userStatus = document.getElementById("userStatus");
        if (userStatus) userStatus.textContent = currentUser.displayName;
        startSessionTimeout();
        showBanner(`Signed in as ${currentUser.displayName}`, 3000);
        if (authModal) authModal.classList.add("hidden");
      } catch (error) {
        console.error("Sign-in error:", error);
        showBanner("Failed to sign in. Please try again.", 4000);
      }
    });
  }

  // Sign-up logic: navigate to register.html page (preserves return path)
  if (authSignUp) {
    authSignUp.addEventListener("click", () => {
      // Go to dedicated registration page. Add return param so user can come back.
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `register.html?return=${encodeURIComponent(returnTo)}`;
    });
  }


  // Modal close binding for variant modal
  const modal = document.getElementById("variantModal");
  function bindModalCloseHandlers() {
    setTimeout(() => {
      const cancelBtn = document.getElementById("cancelVariant");
      if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    }, 100);
    if (modal) {
      modal.addEventListener("click", e => {
        if (e.target === modal) closeModal();
      });
    }
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeModal();
    });
  }
  bindModalCloseHandlers();

  // Product list delegation
  const productList = document.getElementById("productList");
  if (productList) {
    await fetchActivePromos();                 // ✅ promos first
    await renderProducts();                    // render tabs and list
    productList.addEventListener("click", e => {
      const t = e.target;
      if (t.classList?.contains("add-to-cart")) {
        const productName = t.dataset.productName;
        if (productName) window.handleAddToCartByName(productName);
      }
    });
  }

  // Cart controls
  const cartList = document.querySelector(".cart-list");
  if (cartList) {
    cartList.addEventListener("click", e => {
      const t = e.target;
      if (!t.classList) return;

      // Quantity handlers (existing)
      if (t.classList.contains("inc")) {
        increaseQtyByIndex(t.dataset.index);
        return;
      }
      if (t.classList.contains("dec")) {
        decreaseQtyByIndex(t.dataset.index);
        return;
      }

      // New: click on free item name to choose variant
      if (t.classList.contains("cart-item-name")) {
        const idx = Number(t.dataset.index);
        const item = cart[idx];
        if (!item) return;
        const group = window.groupedProducts?.[item.name];
        if (!group) return;
        showVariantSelectorFor(idx, group, item.isPromoFree);
      }
    });
  }

  renderCart();
}

/***********************
 * Variant modal logic
 ***********************/
function openVariantModal(prod) {
  const modal = document.getElementById("variantModal");
  const optionsEl = document.getElementById("variantOptions");
  if (!modal || !optionsEl) return;

  optionsEl.innerHTML = "";

  // build variant buttons
  if (prod.variants && prod.variants.length > 0) {
    prod.variants.forEach(v => {
      const btn = document.createElement("button");
      btn.textContent = v.variant ? `${v.variant} – ${formatRp(v.price)}` : formatRp(v.price);
      btn.style.display = "block";
      btn.style.margin = "6px auto";
      btn.addEventListener("click", () => {
        cart.add({ id: prod.id, product: prod, variant: v.variant, price: v.price });
        closeVariantModal();
        showBanner(`${prod.name} (${v.variant || "Default"}) added ✓`, 2000);
      });
      optionsEl.appendChild(btn);
    });
  } else {
    const msg = document.createElement("p");
    msg.textContent = "No variants available.";
    optionsEl.appendChild(msg);
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeVariantModal() {
  const modal = document.getElementById("variantModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

// Cancel button
const cancelBtn = document.getElementById("cancelVariant");
if (cancelBtn) cancelBtn.addEventListener("click", closeVariantModal);


/***********************
 * Unified DOMContentLoaded bootstrap
 ***********************/
document.addEventListener("DOMContentLoaded", async () => {
  const modal = document.getElementById("variantModal");
  if (modal) modal.classList.add("hidden");

  if (!document.getElementById("banner")) {
    const banner = document.createElement("div");
    banner.id = "banner";
    banner.className = "banner hidden";
    document.body.appendChild(banner);
  }

  if (document.body.classList.contains("staff")) {
    initStaff();
  } else {
    await initCustomer();
  }
});
