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
    const user = firebase.auth().currentUser;
    if (!user) {
      msg.style.color = "red";
      msg.textContent = "⚠️ Please login as admin first.";
      return;
    }

    // Verify admin status via admins collection
    try {
      const adminSnap = await db.collection("admins").doc(user.uid).get();
      if (!adminSnap.exists) {
        msg.style.color = "red";
        msg.textContent = "❌ Access denied. Not an admin account.";
        return;
      }
    } catch (e) {
      msg.style.color = "red";
      msg.textContent = "❌ Failed to verify admin status.";
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
      const idToken = await user.getIdToken();
      const response = await fetch("/.netlify/functions/create-voucher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + idToken
        },
        body: JSON.stringify({ code, type, value, limitPerDay: limit })
      });
      const result = await response.json();

      if (!result.success) {
        msg.style.color = "red";
        msg.textContent = "❌ " + (result.error || "Failed to create voucher.");
        return;
      }

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
