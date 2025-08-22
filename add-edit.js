// ---------- Helpers ----------
function getQueryParam(key) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

function buildKeywords(name) {
  const keywords = [];
  const lowerName = name.toLowerCase();
  let cur = "";
  for (const ch of lowerName) {
    cur += ch;
    keywords.push(cur);
  }
  return keywords;
}

// -------- EMAIL SENDER --------
function sendEmailNotification(templateId, data) {
  return emailjs.send("service_dhmya66", templateId, data)
    .then(() => console.log("✅ Email sent"))
    .catch(err => console.error("❌ Email send failed:", err));
}

// ---------- Add / Edit Member ----------
document.addEventListener("DOMContentLoaded", () => {
  const mode = localStorage.getItem("mode");
  const isAdmin = mode === "admin" || localStorage.getItem("isAdmin") === "true";
  const memberId = getQueryParam("id");

  console.log(`ℹ️ Add/Edit page loaded in mode: ${mode}, memberId: ${memberId || "(new)"}`);

  // --- Gate: Edit mode is Admin only ---
  if (memberId && !isAdmin) {
    alert("❌ Admin access only.");
    location.href = "index.html";
    return;
  }

  // --- Tier handling: only lock on Add for Kafe/Public ---
  const tierSelect = document.getElementById("newTier") || document.getElementById("editTier");
  const tierLabel = tierSelect?.previousElementSibling;
  if (!memberId && (mode === "kafe" || mode === "public")) {
    if (tierSelect) {
      tierSelect.value = "Bronze";
      tierSelect.disabled = true;
      tierSelect.style.display = "none";
    }
    if (tierLabel) {
      tierLabel.style.display = "none";
    }
  }

  // --- Auto-fill birthdate from KTP number ---
  const ktpInput = document.getElementById("newKTP") || document.getElementById("editKTP");
  const birthdateInput = document.getElementById("newBirthdate") || document.getElementById("editBirth");

  ktpInput?.addEventListener("blur", () => {
    const raw = ktpInput.value.trim();
    const digits = raw.replace(/\D/g, ""); // keep digits only

    if (!digits || digits.length < 12) return;

    const dobPart = digits.slice(6, 12);
    let day = parseInt(dobPart.slice(0, 2), 10);
    const month = parseInt(dobPart.slice(2, 4), 10);
    const yy = parseInt(dobPart.slice(4, 6), 10);

    const gender = day > 40 ? "Female" : "Male";
    if (day > 40) day -= 40;

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      console.warn("⚠️ Invalid KTP birth segment:", { dobPart, day, month, yy });
      return;
    }

    const now = new Date();
    const currentYY = now.getFullYear() % 100;
    const fullYear = yy <= currentYY ? 2000 + yy : 1900 + yy;

    const fullDate = new Date(fullYear, month - 1, day);
    const yyyy = fullDate.getFullYear();
    const mm = String(fullDate.getMonth() + 1).padStart(2, "0");
    const dd = String(fullDate.getDate()).padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;

    birthdateInput.value = iso;
    birthdateInput.style.backgroundColor = "#ffffcc";
    console.log(`🎂 Detected birthdate: ${iso} (${gender})`);
  });

  // --- If editing, load member and adjust button label ---
  if (memberId) {
    loadMemberForEdit(memberId);
    document.getElementById("addMemberBtn").textContent = "Save Changes";
  }

  // --- Hook save button ---
  document.getElementById("addMemberBtn")?.addEventListener("click", async () => {
    await saveFormMember(memberId, mode);
  });
});

// ---------- Load member data into form ----------
async function loadMemberForEdit(memberId) {
  try {
    const docSnap = await db.collection("members").doc(memberId).get();
    if (!docSnap.exists) {
      alert("❌ Member not found.");
      location.href = "index.html";
      return;
    }
    const data = docSnap.data();
    (document.getElementById("newName") || document.getElementById("editName")).value = data.name || "";
    (document.getElementById("newKTP") || document.getElementById("editKTP")).value = data.ktpNumber || data.ktp || "";
    (document.getElementById("newBirthdate") || document.getElementById("editBirth")).value = data.birthdate || "";
    (document.getElementById("newPhone") || document.getElementById("editPhone")).value = data.phone || "";
    (document.getElementById("newEmail") || document.getElementById("editEmail")).value = data.email || "";
    (document.getElementById("newTier") || document.getElementById("editTier")).value = data.tier || "Bronze";
  } catch (err) {
    console.error("❌ Error loading member:", err);
    alert("Failed to load member data.");
  }
}

function getSubjectForType(type, member) {
  switch (type) {
    case "birthday":
      return `Celebrate in Style: Your Exclusive 13e Birthday Rewards`;
    case "upgrade":
      return `🚀 Congrats, ${member.name}! Welcome to ${member.tier} Status`;
    case "cashback_expire":
      return `⏳ Don’t Let Your Cashback Expire – Redeem Now, ${member.name}!`;
    case "transaction_summary":
      return `🧾 Your Transaction Has Been Recorded – Cashback Updated!`;
    case "welcome":
      return `☕ Welcome to 13e Café Rewards, ${member.name}!`;
    default:
      return `Hello from 13e Café ☕`;
  }
}

function getMessagePayload(type, member) {
  switch (type) {
    case "birthday":
      return `Celebrate in Style: Your Exclusive 13e Birthday Rewards`;
    case "upgrade":
      return `🚀 Congrats, ${member.name}! Welcome to ${member.tier} Status`;
    case "cashback_expire":
      return `⏳ Don’t Let Your Cashback Expire – Redeem Now, ${member.name}!`;
    case "transaction_summary":
      return `🧾 Your Transaction Has Been Recorded – Cashback Updated!`;
    case "welcome":
      return `☕ Welcome to 13e Café Rewards, ${member.name}!`;
    default:
      return `Hello from 13e Café ☕`;
  }
}

// ---------- Save form to Firestore ----------
// ---------- Save form to Firestore ----------
async function saveFormMember(memberId, mode) {
  try {
    const name = (document.getElementById("newName") || document.getElementById("editName")).value.trim();
    const ktp = (document.getElementById("newKTP") || document.getElementById("editKTP")).value.trim();
    const birthdate = (document.getElementById("newBirthdate") || document.getElementById("editBirth")).value;
    const phone = (document.getElementById("newPhone") || document.getElementById("editPhone")).value.trim();
    const email = (document.getElementById("newEmail") || document.getElementById("editEmail")).value.trim();
    let tier = (document.getElementById("newTier") || document.getElementById("editTier"))?.value || "Bronze";

    // Clamp tier only on Add for Kafe/Public
    if (!memberId && (mode === "kafe" || mode === "public")) {
      tier = "Bronze";
    }

if (!name) {
  alert("Name is required.");
  return;
}

const memberData = {
  name,
  nameLower: name.toLowerCase(),
  keywords: buildKeywords(name),
  ktpNumber: ktp,
  birthdate,
  phone,
  email,
  tier,
  updatedAt: new Date()
};

// ✅ Add this right after building memberData
if (birthdate) {
  const d = new Date(birthdate);
  if (!isNaN(d)) { // make sure it's a valid date
    memberData.birthMonth = d.getMonth() + 1;
    memberData.birthDay = d.getDate();
  }
}

    if (memberId) {
      // --- EDIT EXISTING MEMBER ---
      await db.collection("members").doc(memberId).update(memberData);
      alert("✅ Member updated successfully.");
      location.href = `details.html?id=${memberId}`;
    } else {
      // --- ADD NEW MEMBER ---
      memberData.createdAt = new Date();
      memberData.welcomed = true; // ✅ mark as welcomed immediately
      const docRef = await db.collection("members").add(memberData);

      // 💌 Send welcome email with subject + body loaded from helpers
      if (email) {
  const payload = {
    member_name: name,
    member_email: email,
    ...getMessagePayload("welcome", memberData),
    closing_line: "We’re excited to have you with us — see you at 13e Café soon! ☕",
    subject_line: getSubjectForType("welcome", memberData)
  };
  await sendEmailNotification("template_hi5egvi", payload);
}

      alert("✅ Member added successfully.");
      location.href = "index.html";
    }
  } catch (err) {
    console.error("❌ Error saving member:", err);
    alert("Failed to save member.");
  }
}