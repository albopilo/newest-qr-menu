// ✅ Firebase Initialization
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

let userHasInteracted = false;

window.addEventListener("click", () => {
  userHasInteracted = true;
});

const urlParams = new URLSearchParams(window.location.search);
const tableNumber = urlParams.get("table") || "unknown";

let currentUser = null;
let cart = [];
let sessionTimer = null;

// ✅ Session Timeout Logic
function startSessionTimeout() {
  if (!window.location.pathname.includes("index")) return;

  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    cart = [];
    currentUser = null;
    localStorage.removeItem("currentUser");
    localStorage.removeItem("sessionStart");
    renderCart();
    const userStatus = document.getElementById("userStatus");
    if (userStatus) userStatus.textContent = "Guest";
    alert("Session expired after 1 hour of inactivity. Please sign in again.");
  }, 3600000); // 1 hour
}

// ✅ DOM Ready: Restore Session + Sign-In
document.addEventListener("DOMContentLoaded", () => {
  const savedUser = localStorage.getItem("currentUser");
  const sessionStart = localStorage.getItem("sessionStart");

  if (savedUser && sessionStart) {
    const elapsed = Date.now() - Number(sessionStart);
    if (elapsed < 3600000) {
      currentUser = JSON.parse(savedUser);
      const userStatus = document.getElementById("userStatus");
      if (userStatus) userStatus.textContent = currentUser.displayName;
      startSessionTimeout();
    } else {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("sessionStart");
      alert("Session expired. Please sign in again.");
    }
  }

  const signInBtn = document.getElementById("signInBtn");
  if (signInBtn) {
    signInBtn.onclick = async () => {
      const input = prompt("Enter your phone number (e.g. 081234567890):");
      if (!input) return;

      const phone = input.trim();
      try {
        const snapshot = await db.collection("members")
          .where("phone", "==", phone)
          .limit(1)
          .get();

        if (snapshot.empty) {
          alert("Phone number not found. Please check and try again.");
          return;
        }

        const member = snapshot.docs[0].data();
        currentUser = {
          phoneNumber: phone,
          tier: member.tier,
          discountRate: member.discountRate || getDiscountByTier(member.tier),
          taxRate: member.taxRate || 0.05,
          displayName: member.name || "Guest"
        };

        localStorage.setItem("currentUser", JSON.stringify(currentUser));
        localStorage.setItem("sessionStart", Date.now().toString());
        const userStatus = document.getElementById("userStatus");
        if (userStatus) userStatus.textContent = currentUser.displayName;
        startSessionTimeout();
        console.log("Signed in as:", currentUser.displayName, "Tier:", currentUser.tier);
      } catch (error) {
        console.error("Sign-in error:", error);
        alert("Failed to sign in. Please try again.");
      }
    };
  }

  const tableInfo = document.getElementById("tableInfo");
  if (tableInfo) tableInfo.textContent = `Table ${tableNumber}`;
});

// ✅ Tier Discount Helper
function getDiscountByTier(tier) {
  switch (tier?.toLowerCase()) {
    case "silver": return 0.15;
    case "gold": return 0.2;
    case "bronze": return 0.1;
    default: return 0.1;
  }
}

// ✅ Fetch Member Tier (fallback)
async function fetchMemberTier(phone) {
  const snapshot = await db.collection("members")
    .where("phone", "==", phone)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const member = snapshot.docs[0].data();
    currentUser.tier = member.tier;
    currentUser.discountRate = member.discountRate ?? getDiscountByTier(member.tier);
    currentUser.taxRate = member.taxRate ?? 0.05;
    console.log("Tier info:", currentUser.tier, "Discount:", currentUser.discountRate);
  }
}

// ✅ Fetch Products with Caching
async function fetchProducts() {
  const cached = localStorage.getItem("productCache");
  const cacheTime = localStorage.getItem("productCacheTime");

  if (cached && cacheTime && Date.now() - cacheTime < 3600000) {
    return JSON.parse(cached);
  }

  const snapshot = await db.collection("products").get();
  const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  localStorage.setItem("productCache", JSON.stringify(products));
  localStorage.setItem("productCacheTime", Date.now().toString());
  return products;
}

// ✅ Render Products by Category
async function renderProducts(selectedCategory = "") {
  const products = (await fetchProducts()).filter(p => p.pos_hidden === 0);
  window.products = products;

  const grouped = {};
  products.forEach(p => {
    const cat = p.category?.trim() || "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  });

  const preferredOrder = ['Snacks', 'Western', 'Ricebowl', 'Nasi', 'Nasi Goreng', 'Mie', 'Matcha', 'Coffee', 'Non coffee', 'Tea & Juices'];
  const sortedCategoryNames = Object.keys(grouped).sort((a, b) => {
    const indexA = preferredOrder.indexOf(a);
    const indexB = preferredOrder.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  const tabs = document.getElementById("categoryTabs");
  if (tabs) {
    tabs.innerHTML = "";
    sortedCategoryNames.forEach(cat => {
      const btn = document.createElement("button");
      btn.textContent = cat;
      btn.className = cat === selectedCategory ? "active" : "";
      btn.onclick = () => renderProducts(cat);
      tabs.appendChild(btn);
    });
  }

  const list = document.getElementById("productList");
  if (list) {
    list.innerHTML = `<h3>${selectedCategory || "Select a Category"}</h3>`;
    if (!selectedCategory || !grouped[selectedCategory]) return;

    grouped[selectedCategory].forEach(prod => {
      const price = prod.pos_sell_price ?? prod.price ?? 0;
      const item = document.createElement("div");
      item.style.marginBottom = "1em";
      item.innerHTML = `
        <strong>${prod.name}</strong><br>
        Rp${Number(price).toLocaleString()}<br>
        <button onclick="addToCart('${prod.id}')">Add to Cart</button>
      `;
      list.appendChild(item);
    });
  }

  console.log("Categories found:", Object.keys(grouped));
}

// ✅ Add to Cart
window.addToCart = function(id) {
  if (!window.products) return;

  const prod = window.products.find(p => p.id === id);
  if (!prod) return;

  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...prod, qty: 1 });
  }

  renderCart();
};

// ✅ Cart Rendering
function renderCart() {
  const cartBody = document.getElementById("cart-body");
  if (!cartBody) return;

  if (cart.length === 0) {
    cartBody.innerHTML = "<p>Your cart is empty.</p>";
    return;
  }

  let html = "<ul>";
  cart.forEach(item => {
    html += `
      <li>
        <span>${item.name}</span>
        <div style="display: inline-flex; align-items: center; gap: 6px; margin-left: 10px;">
          <button class="icon-btn" onclick="decreaseQty('${item.id}')">➖</button>
          <span>${item.qty}</span>
          <button class="icon-btn" onclick="increaseQty('${item.id}')">➕</button>
        </div>
        <span style="float: right;">Rp${(item.pos_sell_price * item.qty).toLocaleString()}</span>
      </li>
    `;
  });
  html += "</ul>";
  html += `<strong>Total: Rp${cart.reduce((sum, i) => sum + i.pos_sell_price * i.qty, 0).toLocaleString()}</strong>`;
  cartBody.innerHTML = html;
}

// ✅ Quantity Controls
function increaseQty(id) {
  const item = cart.find(i => i.id === id);
  if (item) {
    item.qty += 1;
    renderCart();
  }
}

function decreaseQty(id) {
  const item = cart.find(i => i.id === id);
  if (item) {
    item.qty -= 1;
    if (item.qty <= 0) {
      cart = cart.filter(i => i.id !== id);
    }
    renderCart();
  }
}

window.removeFromCart = function(id) {
  cart = cart.filter(item => item.id !== id);
  renderCart();
};

// ✅ Toggle Cart Visibility
function toggleCart() {
  const cartBody = document.getElementById("cart-body");
  const toggleBtn = document.getElementById("toggleCartBtn");

  if (cartBody && toggleBtn) {
    const isHidden = cartBody.classList.contains("hidden");
    cartBody.classList.toggle("hidden");
    toggleBtn.textContent = isHidden ? "❌ Hide Cart" : "🛒 Show Cart";
  }
}

// ✅ Checkout Flow
const checkoutBtn = document.getElementById("checkoutBtn");
if (checkoutBtn) {
  checkoutBtn.onclick = async () => {
    if (cart.length === 0) {
      alert("Your cart is empty!");
      return;
    }

    if (currentUser?.phoneNumber && !currentUser?.tier) {
      await fetchMemberTier(currentUser.phoneNumber);
    }

    const subtotal = cart.reduce((sum, i) => sum + i.pos_sell_price * i.qty, 0);
    const discount = currentUser?.discountRate ? subtotal * currentUser.discountRate : 0;
    const tax = (subtotal - discount) * 0.10;
    const total = (Math.round((subtotal - discount + tax) / 100) * 100).toFixed(2);

    const query = new URLSearchParams({
      subtotal,
      discount,
      tax,
      total,
      table: tableNumber,
      guestName: currentUser?.displayName || "Guest",
      items: encodeURIComponent(JSON.stringify(cart.map(i => ({
        name: i.name,
        qty: i.qty
      })))),
    }).toString();

    window.location.href = `summary.html?${query}`;
  };
}

// ✅ Scoped logic for staff.html
if (document.body.classList.contains("staff")) {
  const messaging = firebase.messaging();

  navigator.serviceWorker.register("/firebase-messaging-sw.js")
    .then(reg => console.log("✅ Service Worker registered:", reg))
    .catch(err => console.error("❌ SW registration failed:", err));

  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      const vapidKey = "BB46kklO696abLSqlK13UKbJh5zCJR-ZCjNa4j4NE08X7JOSJM_IpsJIjsLck4Aqx9QEnQ6Rid4gjLhk1cNjd2w";
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

// ✅ Order Filtering Logic
let currentFilter = "all";

function filterOrders(status) {
  currentFilter = status;

  document.querySelectorAll(".order").forEach(el => {
    const orderStatus = (el.dataset.status || "").toLowerCase();
    el.style.display = (status === "all" || orderStatus === status) ? "block" : "none";
  });
}

window.filterOrders = filterOrders;

// ✅ Listen for Orders by Date
function listenForOrders(selectedDate) {
  const ordersContainer = document.getElementById("orderList");
  if (!ordersContainer) return;

  console.log("📅 Listening for orders on:", selectedDate);
db.collection("orders")
  .where("date", "==", selectedDate)
  .orderBy("timestamp", "desc")
  .onSnapshot(snapshot => {
    console.log("📡 Snapshot received:", snapshot.size);
    if (snapshot.empty) {
      console.warn("⚠️ No orders found for", selectedDate);
    }
    // ...rest of your rendering logic
      ordersContainer.innerHTML = "";

      snapshot.forEach(doc => {
        const order = doc.data();
        const rawStatus = order.status || "pending";
        const normalizedStatus = ["pending", "preparing"].includes(rawStatus) ? "incoming" : rawStatus;

        const div = document.createElement("div");
        div.className = "order";
        div.setAttribute("data-status", normalizedStatus);

        // ✅ Format timestamp
        const time = order.timestamp?.toDate().toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' });
        const date = order.date || "—";

        // ✅ Render item list
        const itemList = order.items.map(i => `<li>${i.qty} × ${i.name}</li>`).join("");

        div.innerHTML = `
          <div><strong>Table ${order.table}</strong> - ${order.items.length} items</div>
          <div class="status">${rawStatus}</div>
          <div><strong>Name:</strong> ${order.guestName || "—"}</div>
          <div><strong>Time:</strong> ${time || "—"} | <strong>Date:</strong> ${date}</div>
          <ul style="margin-top: 6px; padding-left: 16px;">${itemList}</ul>
        `;

        // ✅ Minimalistic status buttons
        const statusControls = document.createElement("div");
        statusControls.className = "status-controls";

        ["preparing", "served", "cancelled"].forEach(newStatus => {
          const btn = document.createElement("button");
          btn.textContent = newStatus;
          btn.className = "btn minimal";
          btn.onclick = async () => {
            try {
              await db.collection("orders").doc(doc.id).update({ status: newStatus });
              console.log(`✅ Order ${doc.id} updated to ${newStatus}`);
            } catch (err) {
              console.error("❌ Failed to update status:", err);
              alert("Failed to update order status.");
            }
          };
          statusControls.appendChild(btn);
        });

        div.appendChild(statusControls);
        ordersContainer.appendChild(div);

        if (normalizedStatus === "incoming" && userHasInteracted) {
  const audio = document.getElementById("newOrderSound");
  if (audio) {
    audio.pause();              // Reset any previous playback
    audio.currentTime = 0;      // Start from beginning
    audio.volume = 0.8;         // Optional: set volume

    audio.play().catch(err => {
      console.warn("🔇 Sound blocked:", err);
      console.log("User interaction status:", userHasInteracted);
    });
  } else {
    console.warn("🎧 Audio element not found");
  }
}
      });

      filterOrders(currentFilter);
    });
}

// ✅ DOM Ready for Staff Page
document.addEventListener("DOMContentLoaded", () => {
  const savedUser = localStorage.getItem("currentUser");
  const sessionStart = localStorage.getItem("sessionStart");

  if (savedUser && sessionStart) {
    const elapsed = Date.now() - Number(sessionStart);
    if (elapsed < 3600000) {
      currentUser = JSON.parse(savedUser);
      const userStatus = document.getElementById("userStatus");
      if (userStatus) userStatus.textContent = currentUser.displayName;
      startSessionTimeout();
    } else {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("sessionStart");
      alert("Session expired. Please sign in again.");
    }
  }

  const tableInfo = document.getElementById("tableInfo");
  if (tableInfo) tableInfo.textContent = `Table ${tableNumber}`;

  renderProducts(); // ✅ Already present

  // ✅ Add this block to activate order listener
  const dateInput = document.getElementById("orderDate");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.value = today;
    listenForOrders(today);
    filterOrders("incoming");

    dateInput.onchange = () => {
      listenForOrders(dateInput.value);
      filterOrders("incoming");
    };
  } else {
    console.warn("⚠️ No #orderDate input found — listener not triggered");
  }
});

// ✅ PWA Install Fallback
let deferredPrompt;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById("installBtn");
  if (installBtn) {
    installBtn.style.display = "block";
    installBtn.onclick = () => {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(choice => {
        console.log(choice.outcome === "accepted" ? "📲 PWA installed" : "🚫 PWA install dismissed");
        deferredPrompt = null;
        installBtn.style.display = "none";
      });
    };
  }
});