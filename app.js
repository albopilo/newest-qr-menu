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

const urlParams = new URLSearchParams(window.location.search);
const tableNumber = urlParams.get('table') || "unknown";

let currentUser = null;
let cart = [];

document.addEventListener("DOMContentLoaded", () => {
  const signInBtn = document.getElementById("signInBtn");

  if (!signInBtn) {
    console.error("signInBtn not found");
    return;
  }

  signInBtn.onclick = async () => {
    const input = prompt("Enter your phone number (e.g. 081234567890):");
    if (!input) return;

    const phone = input.startsWith("0") ? "+62" + input.slice(1) : input;

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
      console.log("Signed in as:", currentUser.displayName, "Tier:", currentUser.tier);
    } catch (error) {
      console.error("Sign-in error:", error);
      alert("Failed to sign in. Please try again.");
    }
  };
});

async function fetchMemberTier(phone) {
  const snapshot = await db.collection("members")
    .where("phone", "==", phone)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const member = snapshot.docs[0].data();
    currentUser.tier = member.tier;
    currentUser.discountRate = member.discountRate || 0.1;
    currentUser.taxRate = member.taxRate || 0.05;
    console.log("Tier info:", currentUser.tier);
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

  const tabs = document.getElementById("categoryTabs");
  tabs.innerHTML = "";
  Object.keys(grouped).forEach(cat => {
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

document.getElementById("checkoutBtn").onclick = () => {
  if (cart.length === 0) {
    alert("Your cart is empty!");
    return;
  }

  const subtotal = cart.reduce((sum, i) => sum + i.pos_sell_price * i.qty, 0);
  const discount = currentUser?.discountRate ? subtotal * currentUser.discountRate : 0;
  const tax = (subtotal - discount) * 0.10;
  const total = Math.round((subtotal - discount + tax) * 100) / 100;

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
    }))))
  }).toString();

  window.location.href = `summary.html?${query}`;
};

window.onload = () => {
  renderProducts();
};