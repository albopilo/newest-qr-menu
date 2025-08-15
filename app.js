// Initialize Firebase (see firebase.js for config)
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

let currentUser = null;

document.getElementById("signInBtn").onclick = () => {
  // Show sign-in modal (phone number or mobile login)
  // Implement Firebase Auth with phone number
};

let cart = [];

async function fetchProducts() {
  const snapshot = await db.collection("products").get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function renderProducts(selectedCategory = "") {
  const products = (await fetchProducts()).filter(prod => prod.pos_hidden === 0);
  window.products = products;

  // Group products by category
  const grouped = {};
  products.forEach(prod => {
    const cat = prod.category?.trim() || "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(prod);
  });

  // Render category tabs
  const tabs = document.getElementById("categoryTabs");
  tabs.innerHTML = "";
  Object.keys(grouped).forEach(cat => {
  const btn = document.createElement("button");
  btn.textContent = cat;
  btn.className = cat === selectedCategory ? "active" : "";
  btn.onclick = () => renderProducts(cat);
  tabs.appendChild(btn);
});

  // Render selected category
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
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...prod, qty: 1 });
  }
  console.log("Cart updated:", cart);
  renderCart();
};

function renderCart() {
  const cartDiv = document.getElementById("cart");
  if (cart.length === 0) {
    cartDiv.innerHTML = "<h3>Cart</h3><p>Your cart is empty.</p>";
    return;
  }
  let html = "<h3>Cart</h3><ul>";
  cart.forEach(item => {
    html += `<li>${item.name} x${item.qty} - Rp${(item.pos_sell_price * item.qty).toLocaleString()}
      <button onclick="removeFromCart('${item.id}')">Remove</button></li>`;
  });
  html += "</ul>";
  html += `<strong>Total: Rp${cart.reduce((sum, i) => sum + i.pos_sell_price * i.qty, 0).toLocaleString()}</strong>`;
  cartDiv.innerHTML = html;

  const total = cart.reduce((sum, item) => {
  const price = Number(item.pos_sell_price);
  const qty = Number(item.qty);
  if (isNaN(price) || isNaN(qty)) {
    console.warn("Invalid price or qty:", item);
    return sum;
  }
  return sum + price * qty;
}, 0);
console.log("Cart contents:", cart);
  console.log("Cart total:", total);
}

window.removeFromCart = function(id) {
  cart = cart.filter(item => item.id !== id);
  renderCart();
};

document.getElementById("checkoutBtn").onclick = () => {
  if (cart.length === 0) {
    alert("Your cart is empty!");
    return;
  }
  alert("Order placed!\n" + cart.map(i => `${i.name} x${i.qty}`).join("\n"));
  cart = [];
  renderCart();
};

window.onload = () => {
  renderProducts(); // No category selected initially
  renderCart();
};
