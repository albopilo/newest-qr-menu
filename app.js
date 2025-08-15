// Initialize Firebase (see firebase.js for config)
let currentUser = null;

document.getElementById("signInBtn").onclick = () => {
  // Show sign-in modal (phone number or mobile login)
  // Implement Firebase Auth with phone number
};

const products = [
  { id: "p1", name: "Café Latte", price: 35000 },
  { id: "p2", name: "Cappuccino", price: 33000 },
  { id: "p3", name: "Espresso", price: 25000 },
  { id: "p4", name: "Croissant", price: 22000 }
];

let cart = [];

function renderProducts() {
  const list = document.getElementById("productList");
  list.innerHTML = "<h3>Menu</h3>";
  products.forEach(prod => {
    const item = document.createElement("div");
    item.style.marginBottom = "1em";
    item.innerHTML = `
      <strong>${prod.name}</strong><br>
      Rp${prod.price.toLocaleString()}<br>
      <button onclick="addToCart('${prod.id}')">Add to Cart</button>
    `;
    list.appendChild(item);
  });
}

window.addToCart = function(id) {
  const prod = products.find(p => p.id === id);
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...prod, qty: 1 });
  }
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
    html += `<li>${item.name} x${item.qty} - Rp${(item.price * item.qty).toLocaleString()}
      <button onclick="removeFromCart('${item.id}')">Remove</button></li>`;
  });
  html += "</ul>";
  html += `<strong>Total: Rp${cart.reduce((sum, i) => sum + i.price * i.qty, 0).toLocaleString()}</strong>`;
  cartDiv.innerHTML = html;
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
  renderProducts();
  renderCart();
  // Update #userStatus based on login
};
