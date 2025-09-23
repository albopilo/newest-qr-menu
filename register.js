// register.js
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

const form = document.getElementById("registerForm");
const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const birthInput = document.getElementById("birthdate");
const errorEl = document.getElementById("formError");
const cancelBtn = document.getElementById("cancelBtn");

function showError(msg) {
  errorEl.style.display = "block";
  errorEl.textContent = msg;
}

function clearError() {
  errorEl.style.display = "none";
  errorEl.textContent = "";
}

function normalizePhone(input) {
  return input
    .replace(/[^\d+]/g, "")
    .replace(/^\+?62/, "0")
    .replace(/^0+/, "0");
}

cancelBtn.addEventListener("click", () => {
  // go back to previous page or index
  const returnTo = new URLSearchParams(window.location.search).get("return") || "/";
  window.location.href = decodeURIComponent(returnTo);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const name = (nameInput.value || "").trim();
  const email = (emailInput.value || "").trim().toLowerCase();
  const phoneRaw = (phoneInput.value || "").trim();
  const birthdate = (birthInput.value || "").trim(); // yyyy-mm-dd

  if (!name || !email || !phoneRaw || !birthdate) {
    showError("All fields are required.");
    return;
  }

  // basic email check
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    showError("Please enter a valid email address.");
    return;
  }

  const phone = normalizePhone(phoneRaw);

  try {
    // check phone
    const phoneSnap = await db.collection("members").where("phone", "==", phone).limit(1).get();
    if (!phoneSnap.empty) {
      showError("This phone number is already registered. Please sign in instead.");
      return;
    }
    // check email
    const emailSnap = await db.collection("members").where("email", "==", email).limit(1).get();
    if (!emailSnap.empty) {
      showError("This email address is already registered. Please sign in instead.");
      return;
    }

    // create member doc with a timestamp-like id (matching Exhibit A style)
    const newId = String(Date.now());
    const memberDoc = {
      birthdate: birthdate,            // e.g. "2000-11-28"
      email: email,
      id: newId,
      ktp: null,
      lastRoomUpgrade: null,
      monthlySinceUpgrade: 0,
      name: name,
      nameLower: name.toLowerCase(),
      phone: phone,
      redeemablePoints: 0,
      roomUpgradeHistory: [],
      spendingSinceUpgrade: 0,
      tier: "Classic",                 // per your request
      upgradeDate: null,
      welcomed: true,
      yearlySinceUpgrade: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      discountRate: 0.10,
      taxRate: 0.10
    };

    await db.collection("members").doc(newId).set(memberDoc);

    // Auto sign-in: store currentUser in localStorage and redirect back
    const currentUser = {
      phoneNumber: phone,
      memberId: newId,
      tier: memberDoc.tier,
      discountRate: memberDoc.discountRate,
      taxRate: memberDoc.taxRate,
      displayName: memberDoc.name
    };
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    localStorage.setItem("sessionStart", Date.now().toString());

    alert("Registration successful! You are now signed in.");

    const returnTo = new URLSearchParams(window.location.search).get("return") || "/";
    window.location.href = decodeURIComponent(returnTo);

  } catch (err) {
    console.error("Registration error:", err);
    showError("Failed to register. Please try again.");
  }
});
