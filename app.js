// Initialize Firebase
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
const auth = firebase.auth();

// ✅ Scoped logic for staff.html
if (document.body.classList.contains("staff")) {
  // FCM setup
  // PWA install prompt
  // Order rendering
  // Any staff-only UI logic
}


if (window.location.pathname.includes("staff")) {
  // 🔐 FCM + PWA logic only for staff.html

  const messaging = firebase.messaging();

navigator.serviceWorker.register("/firebase-messaging-sw.js")
  .then(reg => {
    console.log("✅ Service Worker registered:", reg);
    // No need to call messaging.useServiceWorker(reg)
  })
  .catch(err => console.error("❌ SW registration failed:", err));

  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      messaging.getToken({ vapidKey: "YOUR_PUBLIC_VAPID_KEY" })
        .then(token => {
          console.log("📲 FCM Token:", token);
          // Optional: Save token to Firestore
        })
        .catch(err => console.error("❌ Token error:", err));
      } else if(Notification.permission === "denied") {
  alert("🔕 Notifications are blocked. Please enable them in browser settings.");
    } else {
      console.warn("🔕 Notification permission denied");
    }
  });

  messaging.onMessage(payload => {
    const { title, body } = payload.notification || {};
    if (title && body) alert(`${title}\n\n${body}`);
  });

  // Optional: PWA install prompt
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


const urlParams = new URLSearchParams(window.location.search);
const tableNumber = urlParams.get('table') || "unknown";

let currentUser = null;
let cart = [];
let sessionTimer = null;

function startSessionTimeout() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    cart = [];
    currentUser = null;
    localStorage.removeItem("currentUser");
    localStorage.removeItem("sessionStart");
    renderCart();
    document.getElementById("userStatus").textContent = "Guest";
    alert("Session expired after 1 hour of inactivity. Please sign in again.");
  }, 3600000); // 1 hour in milliseconds
}

document.addEventListener("DOMContentLoaded", () => {
  const savedUser = localStorage.getItem("currentUser");
  const sessionStart = localStorage.getItem("sessionStart");

  if (savedUser && sessionStart) {
    const elapsed = Date.now() - Number(sessionStart);
    if (elapsed < 3600000) {
      currentUser = JSON.parse(savedUser);
      document.getElementById("userStatus").textContent = currentUser.displayName;
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
    // sign-in logic here
  };
}

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
        discountRate: member.discountRate || 0.1,
        taxRate: member.taxRate || 0.05,
        displayName: member.name || "Guest"
      };

      document.getElementById("userStatus").textContent = currentUser.displayName;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      localStorage.setItem("sessionStart", Date.now().toString());
      startSessionTimeout();
      console.log("Signed in as:", currentUser.displayName, "Tier:", currentUser.tier);
    } catch (error) {
      console.error("Sign-in error:", error);
      alert("Failed to sign in. Please try again.");
    }
  };
});

function getDiscountByTier(tier) {
  switch (tier?.toLowerCase()) {
    case "silver": return 0.15;
    case "gold": return 0.2;
    case "bronze": return 0.1;
    default: return 0.1;
  }
}


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


async function fetchProducts() {
  const snapshot = await db.collection("products").get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function renderProducts(selectedCategory = "") {
  const products = (await fetchProducts()).filter(prod => prod.pos_hidden === 0);
  window.products = products;

  const grouped = {};
  products.forEach(prod => {
    const cat = prod.category?.trim() || "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(prod);
  });

  const preferredOrder = ['Snacks', 'Western', 'Ricebowl', 'Nasi', 'Nasi Goreng', 'Mie', 'Matcha', 'Coffee', 'Non coffee', 'Tea & Juices'];
const sortedCategoryNames = Object.keys(grouped).sort((a, b) => {
  const indexA = preferredOrder.indexOf(a);
  const indexB = preferredOrder.indexOf(b);
  return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
});

  const tabs = document.getElementById("categoryTabs");
  tabs.innerHTML = "";
sortedCategoryNames.forEach(cat => {
      const btn = document.createElement("button");
    btn.textContent = cat;
    btn.className = cat === selectedCategory ? "active" : "";
    btn.onclick = () => renderProducts(cat);
    tabs.appendChild(btn);
  });

  const list = document.getElementById("productList");
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

  window.products = products;
  console.log("Categories found:", Object.keys(grouped));
}

window.addToCart = function(id) {
  console.log("Clicked Add to Cart:", id);
  const prod = window.products.find(p => p.id === id);
  if (!prod) {
    console.error("Product not found:", id);
    return;
  }
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...prod, qty: 1 });
  }
  console.log("Cart updated:", cart);
  renderCart();
};

function toggleCart() {
  const cartBody = document.getElementById("cart-body");
  const toggleBtn = document.getElementById("toggleCartBtn");

  const isHidden = cartBody.classList.contains("hidden");
  if (isHidden) {
    cartBody.classList.remove("hidden");
    toggleBtn.textContent = "❌ Hide Cart";
  } else {
    cartBody.classList.add("hidden");
    toggleBtn.textContent = "🛒 Show Cart";
  }
}

function renderCart() {
  const cartBody = document.getElementById("cart-body");

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

document.getElementById("tableInfo").textContent = `Table ${tableNumber}`;

document.getElementById("checkoutBtn").onclick = async () => {
  if (cart.length === 0) {
    alert("Your cart is empty!");
    return;
  }

  // Ensure latest tier info is loaded
  if (currentUser?.phoneNumber) {
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

window.onload = () => {
  renderProducts();
  startSessionTimeout();
};

// Handle PWA install prompt
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
        if (choice.outcome === "accepted") {
          console.log("📲 PWA installed");
        } else {
          console.log("🚫 PWA install dismissed");
        }
        deferredPrompt = null;
        installBtn.style.display = "none";
      });
    };
  }
});