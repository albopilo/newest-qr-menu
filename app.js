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
let cart = [];
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
  switch (tier?.toLowerCase()) {
    case "silver": return 0.15;
    case "gold": return 0.20;
    case "bronze": return 0.10;
    default: return 0.10;
  }
}

async function fetchMemberTier(phone) {
  const snapshot = await db.collection("members").where("phone", "==", phone).limit(1).get();
  if (!snapshot.empty) {
    const memberDoc = snapshot.docs[0];
    const member = memberDoc.data();
    currentUser.tier = member.tier || null;
    currentUser.memberId = memberDoc.id; // capture for loyalty linkage
    currentUser.discountRate = member.discountRate ?? getDiscountByTier(member.tier);
    currentUser.taxRate = member.taxRate ?? 0.10;
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
  const raw = await fetchProductsRaw();
  const grouped = {};

  for (const p of raw) {
    const isHidden = Number(p.pos_hidden ?? 0) !== 0; // handles 0, "0", 1, "1"
    const category = (p.category || "").trim();
    const nameKey = (p.name || "").trim() || "Unnamed";

    // Skip hidden or uncategorized products, but log them for auditing
    if (isHidden || !category) {
      console.warn("⏭ Skipped product (hidden or missing category):", {
        id: p.id,
        name: nameKey,
        category: category || "(none)",
        pos_hidden: p.pos_hidden
      });
      continue;
    }

    // Initialize group by product name
    if (!grouped[nameKey]) {
      grouped[nameKey] = {
        name: nameKey,
        category: category, // guaranteed non-empty here
        basePrice: p.pos_sell_price ?? p.price ?? 0,
        variants: [],
        variant_label: p.variant_label || null
      };
    }

    // Build variants and update basePrice to the minimum
    const variants = buildVariantsFromDoc(p);
    grouped[nameKey].variants.push(...variants);
    const minPrice = Math.min(grouped[nameKey].basePrice, ...variants.map(v => Number(v.price) || 0));
    grouped[nameKey].basePrice = isFinite(minPrice) ? minPrice : grouped[nameKey].basePrice;
  }

  // Deduplicate and sort variants within each group
  Object.values(grouped).forEach(group => {
    const unique = new Map();
    group.variants.forEach(v => {
      const keyVariant = (v.variant ?? "").trim().toLowerCase();
      const k = `${keyVariant}::${Number(v.price) || 0}`;
      if (!unique.has(k)) unique.set(k, { ...v, variant: v.variant?.trim() || v.variant || null });
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

  // Sort with case-insensitive match to preferred order
  const preferredOrder = [
    'Special Today', 'Snacks','Western','Ricebowl','Nasi','Nasi Goreng',
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
    const heading = document.createElement("h3");
    heading.textContent = selectedCategory || "Select a Category";
    list.appendChild(heading);

    if (!selectedCategory || !categoryMap[selectedCategory]) return;
    categoryMap[selectedCategory].forEach(prod => {
      const hasVariants = prod.variants.length > 1 || !!prod.variants[0]?.variant;
      const div = document.createElement("div");
      div.style.marginBottom = "1em";

      const nameEl = document.createElement("strong");
      nameEl.textContent = prod.name;
      div.appendChild(nameEl);
      div.appendChild(document.createElement("br"));

      const priceEl = document.createTextNode(`Rp${Number(prod.basePrice).toLocaleString()}`);
      div.appendChild(priceEl);
      div.appendChild(document.createElement("br"));

      const btn = document.createElement("button");
      btn.className = "add-to-cart";
      btn.dataset.productName = prod.name;
      btn.textContent = hasVariants ? "Select variation" : "Add to cart";
      div.appendChild(btn);

      list.appendChild(div);
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
    if (title) {
      title.textContent = group.variant_label
        ? `Choose ${group.variant_label} for ${group.name}`
        : `Choose option for ${group.name}`;
    }
    group.variants.forEach(v => {
      const btn = document.createElement("button");
      btn.textContent = (v.variant && v.variant.trim())
        ? `${v.variant} — Rp${Number(v.price).toLocaleString()}`
        : `${group.name} — Rp${Number(v.price).toLocaleString()}`;
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
    btn.textContent = (v.variant && v.variant.trim())
      ? `${v.variant} — Rp0`
      : `${group.name} — Rp0`;
    btn.addEventListener("click", () => {
      addToCart({
        id: v.id,
        name: group.name,
        price: 0,
        variant: v.variant || null,
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

function showVariantSelectorFor(cartIndex, group, forcePriceZero = false) {
  if (!userHasInteracted) return;
  const modal = document.getElementById("variantModal");
  const options = document.getElementById("variantOptions");
  const title = document.getElementById("variantTitle");
  if (!modal || !options) return;

  // Toggle freebie styling
  if (forcePriceZero) {
    modal.classList.add("freebie");
  } else {
    modal.classList.remove("freebie");
  }

  options.innerHTML = "";
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
}
  }

  group.variants.forEach(v => {
    const btn = document.createElement("button");
    const priceText = forcePriceZero ? "Rp0" : `Rp${Number(v.price).toLocaleString()}`;
    btn.textContent = (v.variant && v.variant.trim())
      ? `${v.variant} — ${priceText}`
      : `${group.name} — ${priceText}`;

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
function showVariantSelector(group) {
  if (!userHasInteracted) return;
  const modal = document.getElementById("variantModal");
  const options = document.getElementById("variantOptions");
  const title = document.getElementById("variantTitle");
  if (!modal || !options) return;

  // Ensure no freebie styling
  modal.classList.remove("freebie");

  options.innerHTML = "";
  if (title) {
    title.textContent = group.variant_label
      ? `Choose ${group.variant_label} for ${group.name}`
      : `Choose option for ${group.name}`;
  }

  group.variants.forEach(v => {
    const btn = document.createElement("button");
    btn.textContent = (v.variant && v.variant.trim())
      ? `${v.variant} — Rp${Number(v.price).toLocaleString()}`
      : `${group.name} — Rp${Number(v.price).toLocaleString()}`;
    btn.addEventListener("click", () => {
      addToCart({ id: v.id, name: group.name, price: v.price, variant: v.variant || null });
      closeModal();
    });
    options.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

function closeModal() {
  const modal = document.getElementById("variantModal");
  if (modal) modal.classList.add("hidden");
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
  nameSpan.dataset.index = String(idx);          // <-- index for in-place update
  nameSpan.dataset.promoFree = item.isPromoFree ? "1" : "0";
  nameSpan.textContent = item.name + (item.variant ? ` — ${item.variant}` : "");
  if (item.isPromoFree) {
    nameSpan.style.cursor = "pointer";
    nameSpan.title = "Click to choose free item variant";
  }
  li.appendChild(nameSpan);

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
    const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    const discountRate = currentUser?.discountRate || 0;
    const discount = subtotal * discountRate;
    const taxRate = typeof currentUser?.taxRate === "number" ? currentUser.taxRate : 0.10;
    const tax = (subtotal - discount) * taxRate;
    const total = Math.round((subtotal - discount + tax) / 100) * 100;

    const items = cart.map(i => ({
      name: i.name + (i.variant ? ` (${i.variant})` : ""),
      qty: i.qty
    }));

    const query = new URLSearchParams({
      subtotal: String(subtotal),
      discount: String(discount),
      tax: String(tax),
      total: String(total),
      table: tableNumber,
      guestName: currentUser?.displayName || "Guest",
      memberPhone: currentUser?.phoneNumber || "",
      memberId: currentUser?.memberId || "", // propagate for loyalty link
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
    const orderStatus = (el.dataset.status || "").toLowerCase();
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

async function updateOrderStatusAndMaybeRecordLoyalty(orderId, targetStatus) {
  const orderRef = db.collection("orders").doc(orderId);
  const ratesDocRef = db.collection("settings").doc("cashbackRates");
  const tierSettingsRef = db.collection("settings").doc("tierThresholds");

  await db.runTransaction(async (t) => {
    // 1️⃣ READS FIRST
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

    // 2️⃣ CANCELLED: reverse loyalty effects
    if (targetStatus === "cancelled" && alreadyRecorded && order.loyaltyTxId && memberRef && memberSnap?.exists) {
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
        status: targetStatus,
        loyaltyRecorded: false,
        loyaltyTxId: null
      });

      return;
    }

    // 3️⃣ SERVED: record loyalty
    if (targetStatus === "served" && !alreadyRecorded && (memberId || memberPhone)) {
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
        status: targetStatus,
        loyaltyRecorded: true,
        loyaltyTxId: txRef.id
      });

      return;
    }

    // 4️⃣ DEFAULT: just update status
    t.update(orderRef, { status: targetStatus });
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
  // Stop any existing listener and chime loops before starting new
  if (typeof unsubscribeOrders === "function") {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  stopRepeatingChimes();

  const ordersContainer = document.getElementById("orderList");
  if (!ordersContainer) return;

  const prevStatuses = new Map();
  const INCOMING_STATUSES = ["pending"];
  let initialProcessed = false;

  unsubscribeOrders = db.collection("orders")
    .where("date", "==", selectedDate)
    .orderBy("timestamp", "desc")
    .onSnapshot(snapshot => {
      ordersContainer.innerHTML = "";

      snapshot.forEach(docSnap => {
        const order = docSnap.data();
        const rawStatus = (order.status || "pending").toLowerCase();

        const div = document.createElement("div");
        div.className = "order";
        div.dataset.status = rawStatus;
        styleOrderBox(div, rawStatus);

        // Table + item count
        const tableLine = document.createElement("div");
        const tableStrong = document.createElement("strong");
        tableStrong.textContent = `Table ${order.table}`;
        tableLine.appendChild(tableStrong);
        tableLine.appendChild(document.createTextNode(` - ${(order.items || []).length} items`));
        div.appendChild(tableLine);

        // Status
        const statusLine = document.createElement("div");
        statusLine.className = "status";
        statusLine.textContent = rawStatus;
        div.appendChild(statusLine);

        // Name
        const nameLine = document.createElement("div");
        nameLine.innerHTML = `<strong>Name:</strong> ${order.guestName || "—"}`;
        div.appendChild(nameLine);

        // Time/date
        const timeLine = document.createElement("div");
        const time = order.timestamp?.toDate?.().toLocaleTimeString?.("id-ID", { hour: '2-digit', minute: '2-digit' }) || "—";
        const date = order.date || "—";
        timeLine.innerHTML = `<strong>Time:</strong> ${time} | <strong>Date:</strong> ${date}`;
        div.appendChild(timeLine);

        // Items list
        if (order.items?.length) {
          const ul = document.createElement("ul");
          ul.style.marginTop = "6px";
          ul.style.paddingLeft = "16px";
          order.items.forEach(i => {
            const li = document.createElement("li");
            li.textContent = `${i.qty} × ${i.name}`;
            ul.appendChild(li);
          });
          div.appendChild(ul);
        }

        // Status controls — disable whole group during update
        const statusControls = document.createElement("div");
        statusControls.className = "status-controls";
        ["preparing","served","cancelled"].forEach(newStatus => {
          const btn = document.createElement("button");
          btn.textContent = newStatus;
          btn.className = "btn minimal";
          btn.addEventListener("click", async () => {
            if (statusControls.dataset.busy === "1") return;
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
        });
        div.appendChild(statusControls);

        ordersContainer.appendChild(div);
      });

      // Maintain repeat set for chimes
      repeatOrderIds.clear();
      snapshot.forEach(docSnap => {
        const s = (docSnap.data().status || "").toLowerCase();
        if (INCOMING_STATUSES.includes(s)) repeatOrderIds.add(docSnap.id);
      });
      if (repeatOrderIds.size > 0) startRepeatingChimes();
      else stopRepeatingChimes();

      // Changes for chime decisions and autocorrect
      const changes = snapshot.docChanges();

      // Auto-correct: if a brand-new order arrives already "preparing", flip it to "pending"
      if (initialProcessed) {
        changes.forEach(async change => {
          if (change.type !== "added") return;
          const now = (change.doc.data().status || "").toLowerCase();
          if (now === "preparing") {
            try {
              await db.collection("orders").doc(change.doc.id).update({ status: "pending" });
              console.log(`↩️ Auto-corrected new order ${change.doc.id} from "preparing" to "pending"`);
            } catch (err) {
              console.warn("Failed to correct status to pending:", err);
            }
          }
        });
      }

      // Decide whether to chime
      let shouldChime = false;

      if (!initialProcessed) {
        // First snapshot: chime if any pending already present
        const hasPending = snapshot.docs.some(d =>
          INCOMING_STATUSES.includes((d.data().status || "").toLowerCase())
        );
        shouldChime = hasPending;
        initialProcessed = true;
      } else {
        // Subsequent snapshots: chime for new pending or became-pending
        changes.forEach(change => {
          const now = (change.doc.data().status || "").toLowerCase();
          if (!INCOMING_STATUSES.includes(now)) return;
          if (change.type === "added") {
            shouldChime = true;
          } else if (change.type === "modified") {
            const before = prevStatuses.get(change.doc.id);
            if (!INCOMING_STATUSES.includes(before)) shouldChime = true;
          }
        });
      }

      if (shouldChime) {
        AudioChime.requestChime();
      }

      // Update prevStatuses AFTER detection
      snapshot.forEach(docSnap => {
        prevStatuses.set(docSnap.id, (docSnap.data().status || "").toLowerCase());
      });

      // Apply current filter
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

  // Sign-in flow
  const signInBtn = document.getElementById("signInBtn");
  if (signInBtn) {
    signInBtn.addEventListener("click", async () => {
      const input = prompt("Enter your phone number (e.g. 081234567890):");
      if (!input) return;

      const phone = input
        .replace(/[^\d+]/g, "")
        .replace(/^\+?62/, "0")
        .replace(/^0+/, "0");

      try {
        const snapshot = await db.collection("members").where("phone", "==", phone).limit(1).get();
        if (snapshot.empty) {
          showBanner("Phone number not found. Please check and try again.", 4000);
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
        const userStatus = document.getElementById("userStatus");
        if (userStatus) userStatus.textContent = currentUser.displayName;
        startSessionTimeout();
        showBanner(`Signed in as ${currentUser.displayName}`, 3000);
      } catch (error) {
        console.error("Sign-in error:", error);
        showBanner("Failed to sign in. Please try again.", 4000);
      }
    });
  }

  // Modal close binding
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