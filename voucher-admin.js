// voucher-admin.js — server-side voucher creation via Netlify function
const firebaseConfig = {
  apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
  authDomain: "e-loyalty-12563.firebaseapp.com",
  projectId: "e-loyalty-12563",
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const loginBtn = document.getElementById("loginBtn");
const loginMsg = document.getElementById("loginMsg");
const createVoucherBtn = document.getElementById("createVoucherBtn");
const msg = document.getElementById("msg");

let adminVerified = false;

loginBtn.addEventListener("click", async () => {
  const email = document.getElementById("adminEmail").value;
  const password = document.getElementById("adminPassword").value;
  try {
    const cred = await firebase.auth().signInWithEmailAndPassword(email, password);

    // Verify the user is actually an admin
    const adminSnap = await db.collection("admins").doc(cred.user.uid).get();
    if (!adminSnap.exists) {
      loginMsg.style.color = "red";
      loginMsg.textContent = "Access denied. Your account is not an admin.";
      await firebase.auth().signOut();
      return;
    }

    adminVerified = true;
    loginMsg.style.color = "green";
    loginMsg.textContent = "Logged in as admin successfully!";
  } catch (err) {
    console.error("Login error:", err);
    loginMsg.style.color = "red";
    loginMsg.textContent = "Login failed.";
  }
});


createVoucherBtn.addEventListener("click", async () => {
  const user = firebase.auth().currentUser;
  if (!user) {
    msg.style.color = "red";
    msg.textContent = "Please login as admin first.";
    return;
  }

  if (!adminVerified) {
    msg.style.color = "red";
    msg.textContent = "Your account is not authorized as admin.";
    return;
  }

  const code = document.getElementById("code").value.trim().toUpperCase();
  const type = document.getElementById("type").value;
  const value = parseInt(document.getElementById("value").value, 10) || 0;
  const limit = parseInt(document.getElementById("limit").value, 10) || 0;

  if (!code || !value) {
    msg.style.color = "red";
    msg.textContent = "Please fill all fields.";
    return;
  }

  try {
    // Get ID token for server-side verification
    const idToken = await user.getIdToken();

    // Call server-side function (verifies admin status again on server)
    const response = await fetch("/.netlify/functions/createVoucher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, type, value, limitPerDay: limit, idToken }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      msg.style.color = "red";
      msg.textContent = result.error || "Failed to create voucher.";
      return;
    }

    msg.style.color = "green";
    msg.textContent = `Voucher ${code} created successfully!`;

    document.getElementById("code").value = "";
    document.getElementById("value").value = "";
    document.getElementById("limit").value = "0";
  } catch (err) {
    console.error("Error creating voucher:", err);
    msg.style.color = "red";
    msg.textContent = "Failed to create voucher.";
  }
});
