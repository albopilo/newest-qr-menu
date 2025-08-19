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
["pointerdown", "click", "keydown", "touchstart"].forEach(evt =>
  window.addEventListener(evt, () => { userHasInteracted = true; }, { once: true })
);

const urlParams = new URLSearchParams(window.location.search);
const tableNumber = urlParams.get("table") || "unknown";

let currentUser = null;
let cart = [];
let sessionTimer = null;
let unsubscribeOrders = null;
let ordersFirstSnapshot = true;

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
    const member = snapshot.docs[0].data();
    currentUser.tier = member.tier || null;
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
  const raw = (await fetchProductsRaw()).filter(p => Number(p.pos_hidden ?? 0) === 0);
  const grouped = {};
  for (const p of raw) {
    const nameKey = (p.name || "").trim() || "Unnamed";
    if (!grouped[nameKey]) {
      grouped[nameKey] = {
        name: nameKey,
        category: p.category?.trim() || "Uncategorized",
        basePrice: p.pos_sell_price ?? p.price ?? 0,
        variants: [],
        variant_label: p.variant_label || null
      };
    }
    const variants = buildVariantsFromDoc(p);
    grouped[nameKey].variants.push(...variants);
    const minPrice = Math.min(grouped[nameKey].basePrice, ...variants.map(v => v.price));
    grouped[nameKey].basePrice = isFinite(minPrice) ? minPrice : grouped[nameKey].basePrice;
  }
  // Deduplicate (normalized) + sort variants
  Object.values(grouped).forEach(group => {
    const unique = new Map();
    group.variants.forEach(v => {
      const keyVariant = (v.variant ?? "").trim().toLowerCase();
      const k = `${keyVariant}::${Number(v.price) || 0}`;
      if (!unique.has(k)) unique.set(k, { ...v, variant: v.variant?.trim() || v.variant });
    });
    group.variants = Array.from(unique.values()).sort((a, b) => a.price - b.price);
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
  const preferredOrder = ['Snacks', 'Western', 'Ricebowl', 'Nasi', 'Nasi Goreng', 'Mie', 'Matcha', 'Coffee', 'Non coffee', 'Tea & Juices'];
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

  // Build product list for chosen category
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

/***********************
 * Add to cart by product name (opens modal if needed)
 ***********************/
window.handleAddToCartByName = function(productName) {
  const group = window.groupedProducts?.[productName];
  if (!group) return;
  const hasVariants = group.variants.length > 1 || !!group.variants[0]?.variant;
  if (hasVariants) {
    showVariantSelector(group);
  } else {
    const v = group.variants[0];
    addToCart({ id: v.id, name: group.name, price: v.price, variant: v.variant || null });
  }
};

/***********************
 * Variant selector modal
 ***********************/
function showVariantSelector(group) {
  if (!userHasInteracted) return;

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

// Always hide modal on load
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("variantModal");
  if (modal) modal.classList.add("hidden");
});

/***********************
 * Cart storage helpers (TTL only for guests/no active session)
 ***********************/
function restoreCartFromStorage() {
  const saved = localStorage.getItem("cart");
  if (!saved) return;

  const savedAt = Number(localStorage.getItem("cartSavedAt") || 0);
  const sessionStart = Number(localStorage.getItem("sessionStart") || 0);
  const hasActiveSession = !!localStorage.getItem("currentUser") && sessionStart && (Date.now() - sessionStart < 3600000);

  // Expire cart only if no active session (guest or expired)
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
  const key = product.variant || "default";
  const existing = cart.find(c => c.id === product.id && (c.variant || "default") === key);
  if (existing) existing.qty++;
  else cart.push({ ...product, qty: 1 });

  saveCartToStorage();
  renderCart();
  startSessionTimeout();
  showBanner(`${product.name}${product.variant ? ` (${product.variant})` : ""} added to cart`, 2000);
}

/***********************
 * Safe cart rendering
 ***********************/
function renderCart() {
  const list = document.querySelector(".cart-list");
  const totalEl = document.getElementById("cart-total");
  if (!list) return;
  list.innerHTML = "";
  let total = 0;

  cart.forEach(item => {
    total += item.price * item.qty;

    const li = document.createElement("li");
    li.className = "cart-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = item.name + (item.variant ? ` — ${item.variant}` : "");
    li.appendChild(nameSpan);

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "qty-adjuster";

    const decBtn = document.createElement("button");
    decBtn.className = "icon-btn dec";
    decBtn.dataset.id = item.id;
    decBtn.dataset.variant = item.variant || "";
    decBtn.textContent = "−";
    qtyWrap.appendChild(decBtn);

    const qtySpan = document.createElement("span");
    qtySpan.className = "item-qty";
    qtySpan.textContent = item.qty;
    qtyWrap.appendChild(qtySpan);

    const incBtn = document.createElement("button");
    incBtn.className = "icon-btn inc";
    incBtn.dataset.id = item.id;
    incBtn.dataset.variant = item.variant || "";
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

function increaseQty(id, variant = "") {
  const item = cart.find(i => i.id === id && (i.variant || "") === variant);
  if (item) {
    item.qty += 1;
    saveCartToStorage();
    renderCart();
    startSessionTimeout();
  }
}
function decreaseQty(id, variant = "") {
  const item = cart.find(i => i.id === id && (i.variant || "") === variant);
  if (item) {
    item.qty -= 1;
    if (item.qty <= 0) {
      cart = cart.filter(i => !(i.id === id && (i.variant || "") === variant));
    }
    saveCartToStorage();
    renderCart();
    startSessionTimeout();
  }
}
function removeFromCart(id, variant = "") {
  cart = cart.filter(item => !(item.id === id && (item.variant || "") === variant));
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
      items: JSON.stringify(items)
    }).toString();

    window.location.href = `summary.html?${query}`;
  });
}

/***********************
 * Staff page scoped logic
 ***********************/
if (document.body.classList.contains("staff")) {
  const messaging = firebase.messaging();
  const vapidKey = "BB46kklO696abLSqlK13UKbJh5zCJR-ZCjNa4j4NE08X7JOSJM_IpsJIjsLck4Aqx9QEnQ6Rid4gjLhk1cNjd2w";

  navigator.serviceWorker.register("/firebase-messaging-sw.js")
    .then(reg => console.log("✅ Service Worker registered:", reg))
    .catch(err => console.error("❌ SW registration failed:", err));

  // Auto-fetch token if already granted
  if (Notification.permission === "granted") {
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
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          navigator.serviceWorker.ready.then(registration => {
            messaging.getToken({ vapidKey, serviceWorkerRegistration: registration })
              .then(token => console.log("📲 FCM Token:", token))
              .catch(err => console.error("❌ Token fetch error:", err));
          });
        } else if (Notification.permission === "denied") {
          alert("🔕 Notifications are blocked. Please enable them in browser settings.");
        } else {
          console.warn("🔕 Notification permission denied");
        }
      });
    });
  }

  messaging.onMessage(payload => {
    const { title, body } = payload.notification || {};
    if (title && body) alert(`${title}\n\n${body}`);
  });

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
    el.style.display = (status === "all" || orderStatus === status) ? "" : "none";
  });
}
window.filterOrders = filterOrders;

function listenForOrders(selectedDate) {
  // Stop any existing listener before starting a new one
  if (typeof unsubscribeOrders === "function") {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }

  const ordersContainer = document.getElementById("orderList");
  if (!ordersContainer) return;

  console.log("📅 Listening for orders on:", selectedDate);

  // Track last known status to detect transitions into incoming
  const prevStatuses = new Map();
  const INCOMING_STATUSES = ["pending", "preparing", "incoming"];
  let initialProcessed = false;

  unsubscribeOrders = db.collection("orders")
    .where("date", "==", selectedDate)
    .orderBy("timestamp", "desc")
    .onSnapshot(snapshot => {
      ordersContainer.innerHTML = "";

      // Render orders
      snapshot.forEach(docSnap => {
        const order = docSnap.data();
        const rawStatus = (order.status || "pending").toLowerCase();
        const normalizedStatus = INCOMING_STATUSES.includes(rawStatus) ? "incoming" : rawStatus;

        const div = document.createElement("div");
        div.className = "order";
        div.dataset.status = normalizedStatus;

        const time = order.timestamp?.toDate().toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' }) || "—";
        const date = order.date || "—";

        const tableLine = document.createElement("div");
        const tableStrong = document.createElement("strong");
        tableStrong.textContent = `Table ${order.table}`;
        tableLine.appendChild(tableStrong);
        tableLine.appendChild(document.createTextNode(` - ${(order.items || []).length} items`));
        div.appendChild(tableLine);

        const statusLine = document.createElement("div");
        statusLine.className = "status";
        statusLine.textContent = rawStatus;
        div.appendChild(statusLine);

        const nameLine = document.createElement("div");
        const nameStrong = document.createElement("strong");
        nameStrong.textContent = "Name:";
        nameLine.appendChild(nameStrong);
        nameLine.appendChild(document.createTextNode(` ${order.guestName || "—"}`));
        div.appendChild(nameLine);

        const timeLine = document.createElement("div");
        const timeStrong = document.createElement("strong");
        timeStrong.textContent = "Time:";
        timeLine.appendChild(timeStrong);
        timeLine.appendChild(document.createTextNode(` ${time} | `));
        const dateStrong = document.createElement("strong");
        dateStrong.textContent = "Date:";
        timeLine.appendChild(dateStrong);
        timeLine.appendChild(document.createTextNode(` ${date}`));
        div.appendChild(timeLine);

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

        const statusControls = document.createElement("div");
        statusControls.className = "status-controls";
        ["preparing", "served", "cancelled"].forEach(newStatus => {
          const btn = document.createElement("button");
          btn.textContent = newStatus;
          btn.className = "btn minimal";
          btn.addEventListener("click", async () => {
            try {
              await db.collection("orders").doc(docSnap.id).update({ status: newStatus });
              console.log(`✅ Order ${docSnap.id} updated to ${newStatus}`);
            } catch (err) {
              console.error("❌ Failed to update status:", err);
              alert("Failed to update order status.");
            }
          });
          statusControls.appendChild(btn);
        });
        div.appendChild(statusControls);

        ordersContainer.appendChild(div);
      });

      // Debug: show incoming changes
      const changes = snapshot.docChanges();
      if (changes.length) {
        console.groupCollapsed(`Δ ${changes.length} change(s)`);
        changes.forEach(ch => {
          const s = (ch.doc.data().status || "").toLowerCase();
          console.log(ch.type, ch.doc.id, "status:", s);
        });
        console.groupEnd();
      }

      // Decide whether to chime
      let shouldChime = false;

      if (!initialProcessed) {
        // First snapshot: chime if there is any incoming order already present
        const hasIncoming = snapshot.docs.some(d =>
          INCOMING_STATUSES.includes((d.data().status || "").toLowerCase())
        );
        shouldChime = hasIncoming;
        initialProcessed = true;
      } else {
        // Subsequent snapshots: chime for new docs that are incoming or docs that became incoming
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

      console.log("New incoming order?", shouldChime);

      if (shouldChime) {
        const audio = document.getElementById("newOrderSound");
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 0.8;
          audio.play()
            .then(() => console.log("🔔 Chime played"))
            .catch(err => console.warn("🔇 Sound blocked:", err));
        }
      }

      // Update prevStatuses AFTER detection to compare against the previous state next time
      snapshot.forEach(docSnap => {
        prevStatuses.set(docSnap.id, (docSnap.data().status || "").toLowerCase());
      });

      filterOrders(currentFilter);
    });
}

let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked) return;
  const audio = document.getElementById("newOrderSound");
  if (audio) {
    audio.muted = true;
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audioUnlocked = true;
      console.log("🎯 Audio unlocked by gesture");
    }).catch(err => {
      console.warn("🔇 Unlock failed:", err);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const audio = document.getElementById("newOrderSound");
  if (audio) {
    // Try to autoplay muted right away
    audio.muted = true;
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false; // unmute for real use
      console.log("🎯 Audio primed at load — ready for chimes");
    }).catch(err => {
      console.warn("🔇 Auto‑prime failed:", err);
    });
  }
});

/***********************
 * Staff DOM bootstrap
 ***********************/
document.addEventListener("DOMContentLoaded", () => {
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
});

/***********************
 * Customer DOM bootstrap
 ***********************/
document.addEventListener("DOMContentLoaded", () => {
  // Ensure banner exists
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
        .replace(/[^\d+]/g, "")   // keep digits and '+'
        .replace(/^\+?62/, "0")   // +62… or 62… -> 0…
        .replace(/^0+/, "0");     // collapse leading zeros
      try {
        const snapshot = await db.collection("members").where("phone", "==", phone).limit(1).get();
        if (snapshot.empty) {
          showBanner("Phone number not found. Please check and try again.", 4000);
          return;
        }
        const member = snapshot.docs[0].data();
        currentUser = {
          phoneNumber: phone,
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

  // Bind modal close
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

  // Product list: attach delegation for add-to-cart
  const productList = document.getElementById("productList");
  if (productList) {
    productList.addEventListener("click", e => {
      const t = e.target;
      if (t.classList && t.classList.contains("add-to-cart")) {
        const productName = t.dataset.productName;
        if (productName) window.handleAddToCartByName(productName);
      }
    });
    renderProducts();
  }

  // Cart list: attach delegation for qty controls (scoped)
  const cartList = document.querySelector(".cart-list");
  if (cartList) {
    cartList.addEventListener("click", e => {
      const t = e.target;
      if (!t.classList) return;
      if (t.classList.contains("inc")) {
        increaseQty(t.dataset.id, t.dataset.variant || "");
      } else if (t.classList.contains("dec")) {
        decreaseQty(t.dataset.id, t.dataset.variant || "");
      }
    });
  }

  // Initial cart render
  renderCart();
});