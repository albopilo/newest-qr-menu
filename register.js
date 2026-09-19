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

function safeRedirect(target) {
  const decoded = decodeURIComponent(target || "/");
  if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  return "/";
}

cancelBtn.addEventListener("click", () => {
  // go back to previous page or index
  const returnTo = new URLSearchParams(window.location.search).get("return") || "/";
  window.location.href = safeRedirect(returnTo);
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
    // Register via serverless function (server validates and sets tier/price fields)
    const response = await fetch("/.netlify/functions/register-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, birthdate })
    });
    const result = await response.json();

    if (!result.success) {
      showError(result.error || "Failed to register. Please try again.");
      return;
    }

    // Auto sign-in: store currentUser in localStorage and redirect back
    const currentUser = result.member;
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    localStorage.setItem("sessionStart", Date.now().toString());

    alert("Registration successful! You are now signed in.");

    const returnTo = new URLSearchParams(window.location.search).get("return") || "/";
    window.location.href = safeRedirect(returnTo);

  } catch (err) {
    console.error("Registration error:", err);
    showError("Failed to register. Please try again.");
  }
});
