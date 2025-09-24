// --- Firebase init ---
const firebaseConfig = {
  apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
  authDomain: "e-loyalty-12563.firebaseapp.com",
  projectId: "e-loyalty-12563",
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const loginBtn = document.getElementById("loginBtn");
const loginMsg = document.getElementById("loginMsg");

loginBtn.addEventListener("click", async () => {
  const email = document.getElementById("adminEmail").value;
  const password = document.getElementById("adminPassword").value;
  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
    loginMsg.style.color = "green";
    loginMsg.textContent = "✅ Logged in successfully!";
  } catch (err) {
    console.error("Login error:", err);
    loginMsg.style.color = "red";
    loginMsg.textContent = "❌ Login failed.";
  }
});


document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("createVoucherBtn");
  const msg = document.getElementById("msg");

  btn.addEventListener("click", async () => {
    if (!firebase.auth().currentUser) {
      msg.style.color = "red";
      msg.textContent = "⚠️ Please login as admin first.";
      return;
    }

    const code = document.getElementById("code").value.trim().toUpperCase();
    const type = document.getElementById("type").value;
    const value = parseInt(document.getElementById("value").value, 10) || 0;
    const limit = parseInt(document.getElementById("limit").value, 10) || 0;

    if (!code || !value) {
      msg.style.color = "red";
      msg.textContent = "⚠️ Please fill all fields.";
      return;
    }

    try {
      const snap = await db.collection("vouchers").where("code", "==", code).limit(1).get();
      if (!snap.empty) {
        msg.style.color = "red";
        msg.textContent = "❌ Voucher code already exists.";
        return;
      }

      await db.collection("vouchers").add({
        code,
        type,
        value,
        used: "unlimited",
        limitPerDay: limit,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      msg.style.color = "green";
      msg.textContent = `✅ Voucher ${code} created successfully!`;

      document.getElementById("code").value = "";
      document.getElementById("value").value = "";
      document.getElementById("limit").value = "0";
    } catch (err) {
      console.error("Error creating voucher:", err);
      msg.style.color = "red";
      msg.textContent = "❌ Failed to create voucher.";
    }
  });
});
