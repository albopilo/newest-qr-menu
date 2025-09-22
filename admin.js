// admin.js — Part 1/2
(() => {
  "use strict";

  

  /***********************
   * Firebase initialization
   ***********************/
  const firebaseConfig = {
    apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
    authDomain: "e-loyalty-12563.firebaseapp.com",
    projectId: "e-loyalty-12563",
    storageBucket: "e-loyalty-12563.appspot.com",
    messagingSenderId: "3887061029",
    appId: "1:3887061029:web:f9c238731d7e6dd5fb47cc",
    measurementId: "G-966P8W06W2"
  };
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
// Expose shared instances + helpers so Part 2 can reuse them
window.auth = auth;
window.db = db;
window.showBanner = showBanner;
window.invalidateMenuCache = invalidateMenuCache;


  /***********************
   * Globals
   ***********************/
  let unsubscribeProducts = null;
  let currentEditId = null;          // null = create new
  let currentEditData = null;        // keep the doc snapshot data for edit context
  let filteredText = "";
  let unsubscribePromos = null;
let currentPromoId = null;
let currentPromoData = null;

  /***********************
   * Banner helper
   ***********************/
  function showBanner(msg, ms = 3000) {
    const b = document.getElementById("banner");
    if (!b) return;
    b.textContent = msg;
    b.classList.remove("hidden");
    clearTimeout(b.__hideTimer);
    b.__hideTimer = setTimeout(() => b.classList.add("hidden"), ms);
  }

  /***********************
   * Cache invalidation
   ***********************/
function invalidateMenuCache() {
  try {
    localStorage.removeItem("productCacheV2");
    localStorage.removeItem("productCacheTimeV2");
    localStorage.removeItem("promoCacheV1");       // 🔹 clear promo cache
    localStorage.removeItem("promoCacheTimeV1");   // 🔹 clear promo cache timestamp
    showBanner("Menu & promo cache invalidated. Customers will fetch fresh data on next load.", 3200);
  } catch (e) {
    console.warn("Cache invalidate failed:", e);
  }
}

  /***********************
   * Admin gate using /admins/{uid}
   ***********************/
  async function isUidAdmin(uid) {
    if (!uid) return false;
    try {
      const snap = await db.collection("admins").doc(uid).get();
      return snap.exists;
    } catch {
      return false;
    }
  }
  async function requireAdmin(user) {
    if (!user) return false;
    const ok = await isUidAdmin(user.uid);
    if (!ok) {
      showBanner("Access denied. Your account is not authorized.", 4000);
      await auth.signOut().catch(() => {});
      return false;
    }
    return true;
  }
  function toggleSections(authed) {
    const login = document.getElementById("loginSection");
    const panel = document.getElementById("adminPanel");
    if (authed) {
      login?.classList.add("hidden");
      panel?.classList.remove("hidden");
    } else {
      panel?.classList.add("hidden");
      login?.classList.remove("hidden");
    }
  }

  /***********************
   * Utilities
   ***********************/
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    });
    children.forEach(ch => node.appendChild(ch));
    return node;
  }
  function formatRp(n) {
    const val = Number(n || 0);
    return "Rp" + val.toLocaleString("id-ID");
  }
  function parsePrice(input) {
    if (typeof input === "number") return input;
    if (!input) return 0;
    const cleaned = String(input).replace(/[^\d.-]/g, "");
    const num = Number(cleaned);
    return isNaN(num) ? 0 : Math.round(num);
  }

  /***********************
   * Rendering
   ***********************/
  function renderProducts(snapshot) {
    const list = document.getElementById("productList");
    const status = document.getElementById("listStatus");
    if (!list) return;

    list.innerHTML = "";
    let count = 0;

    snapshot.forEach(doc => {
      const p = doc.data();
      const id = doc.id;

      const needle = filteredText.trim().toLowerCase();
      const hay = [
        p.name || "",
        String(p.variant_names || p.variant || ""),
        String(p.category || ""),
        String(p.variant_label || "")
      ].join(" ").toLowerCase();
      if (needle && !hay.includes(needle)) return;

      count++;

      const photo1 = (p.photo_1 || "").trim();
      const nameCell = el("div", { class: "nameCell" }, [
        photo1 ? el("img", { class: "thumb", src: photo1, alt: "" }) : el("span", { class: "thumb hidden" }),
        el("span", {}, [document.createTextNode(p.name || "—")])
      ]);

      const variantDisplay =
        (p.variant_names && String(p.variant_names).trim() !== "")
          ? String(p.variant_names)
          : (p.variant || "—");

      const row = el("div", { class: "grid row", dataset: { id } }, [
        nameCell,
        el("div", {}, [document.createTextNode(variantDisplay)]),
        el("div", {}, [document.createTextNode(formatRp(p.pos_sell_price ?? p.price ?? p.market_price ?? 0))]),
        el("div", {}, [document.createTextNode(p.category || "Uncategorized")]),
        el("div", {}, [el("span", { class: "pill" }, [document.createTextNode(String(p.pos_hidden ?? 0))])]),
        el("div", {}, [
          (() => {
            const editBtn = el("button", { class: "btn minimal" }, [document.createTextNode("Edit")]);
            editBtn.addEventListener("click", () => openEditModal(id, p));
            return editBtn;
          })(),
          (() => {
            const delBtn = el("button", { class: "btn danger", style: "margin-left:6px" }, [document.createTextNode("Delete")]);
            delBtn.addEventListener("click", () => deleteProduct(id, p.name, variantDisplay));
            return delBtn;
          })()
        ])
      ]);

      list.appendChild(row);
    });

    if (status) {
      status.textContent = count === 0 ? "No products match your filter." : `${count} product${count > 1 ? "s" : ""} shown`;
    }
  }

  function renderPromos(snapshot) {
  const list = document.getElementById("promoList");
  const status = document.getElementById("promoStatus");
  if (!list) return;

  list.innerHTML = "";
  let count = 0;

  snapshot.forEach(doc => {
    const p = doc.data();
    const id = doc.id;
    count++;

    const row = el("div", { class: "grid row", dataset: { id } }, [
      el("div", {}, [document.createTextNode(p.type || "—")]),
      el("div", {}, [document.createTextNode(p.active ? "Yes" : "No")]),
      el("div", {}, [document.createTextNode((p.buy_product_ids || []).join(", "))]),
      el("div", {}, [document.createTextNode(p.free_product_id || "—")]),
      el("div", {}, [document.createTextNode(p.free_qty || 0)]),
      el("div", {}, [
        (() => {
          const editBtn = el("button", { class: "btn minimal" }, [document.createTextNode("Edit")]);
          editBtn.addEventListener("click", () => openPromoModal(id, p));
          return editBtn;
        })(),
        (() => {
          const delBtn = el("button", { class: "btn danger", style: "margin-left:6px" }, [document.createTextNode("Delete")]);
          delBtn.addEventListener("click", () => deletePromo(id));
          return delBtn;
        })()
      ])
    ]);

    list.appendChild(row);
  });

  if (status) {
    status.textContent = count === 0 ? "No promos found." : `${count} program${count > 1 ? "s" : ""} shown`;
  }
}

  /***********************
   * Live query
   ***********************/
function listenProducts() {
  if (typeof unsubscribeProducts === "function") {
    unsubscribeProducts();
    unsubscribeProducts = null;
  }
  const listRef = db.collection("products").orderBy("name");
  unsubscribeProducts = listRef.onSnapshot(
    snap => {
      renderProducts(snap);
      populateBuyProductSelect(snap);   // pass the snapshot here
      populateFreeProductSelect(snap);  // pass the snapshot here
    },
    err => {
      console.error("Products listen error:", err);
      showBanner("Failed to load products.", 3500);
    }
  );
}

function populateBuyProductSelect(productsSnap) {
  const sel = document.getElementById("fieldBuyProductIds");
  if (!sel) return;

  // Preserve current selections if the modal is open
  const keepSelected = new Set(Array.from(sel.selectedOptions).map(o => o.value));

  sel.innerHTML = "";
  productsSnap.forEach(doc => {
    const p = doc.data();
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = `${p.name}${p.variant_names ? ` (${p.variant_names})` : ""}`;
    // Keep currently selected items selected during live refresh
    if (keepSelected.has(doc.id)) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateFreeProductSelect(productsSnap) {
  const sel = document.getElementById("fieldFreeProductId");
  if (!sel) return;

  const currentValue = sel.value; // try to preserve if user selected something

  sel.innerHTML = "";
  productsSnap.forEach(doc => {
    const p = doc.data();
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = `${p.name}${p.variant_names ? ` (${p.variant_names})` : ""}`;
    sel.appendChild(opt);
  });

  if (currentValue) sel.value = currentValue; // restore if still present
}


  function listenPromos() {
  if (typeof unsubscribePromos === "function") {
    unsubscribePromos();
    unsubscribePromos = null;
  }
  const listRef = db.collection("marketing_programs").orderBy("type");
  unsubscribePromos = listRef.onSnapshot(
    snap => renderPromos(snap),
    err => {
      console.error("Promos listen error:", err);
      showBanner("Failed to load marketing programs.", 3500);
    }
  );
}

  /***********************
   * Modal helpers
   ***********************/
  function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove("hidden");
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add("hidden");
  }

  function populatePhotos(p) {
    for (let i = 1; i <= 10; i++) {
      const elInput = document.getElementById(`photo_${i}`);
      if (elInput) elInput.value = p?.[`photo_${i}`] || "";
    }
    const prev = document.getElementById("photoPreview");
    if (prev) {
      const u = (p?.photo_1 || "").trim();
      if (u) {
        prev.src = u;
        prev.classList.remove("hidden");
      } else {
        prev.classList.add("hidden");
      }
    }
  }

  function populateForm(p = null) {
    document.getElementById("modalTitle").textContent = p ? "Edit product" : "New product";
    document.getElementById("fieldName").value = p?.name || "";
    document.getElementById("fieldCategory").value = p?.category || "";
    document.getElementById("fieldVariantLabel").value = p?.variant_label || "";
    // Use variant_names as the canonical variant field; fallback to legacy "variant"
    document.getElementById("fieldVariant").value = p?.variant_names || p?.variant || "";
    const price = p?.pos_sell_price ?? p?.price ?? p?.market_price ?? 0;
    document.getElementById("fieldPrice").value = price ? String(price) : "";
    const hidden = Number(p?.pos_hidden ?? 0);
    document.getElementById("fieldHidden").value = String(hidden);

    populatePhotos(p);
  }

function populatePromoForm(p = null) {
  document.getElementById("promoModalTitle").textContent = p ? "Edit Program" : "New Program";
  document.getElementById("fieldPromoType").value = p?.type || "buy_x_get_y";
  document.getElementById("fieldPromoActive").checked = !!p?.active;
  document.getElementById("fieldFreeQty").value = p?.free_qty || 1;

  // Preselect free product
  const freeSel = document.getElementById("fieldFreeProductId");
  if (freeSel) freeSel.value = p?.free_product_id || "";

  // Preselect buy products in <select multiple>
  const buySel = document.getElementById("fieldBuyProductIds");
  if (buySel) {
    const ids = p?.buy_product_ids || [];
    Array.from(buySel.options).forEach(opt => {
      opt.selected = ids.includes(opt.value);
    });
  }

  // Optional variant lock (if the field exists)
  const freeVariantEl = document.getElementById("fieldFreeVariant");
  if (freeVariantEl) freeVariantEl.value = p?.free_variant || "";
}

async function savePromoForm() {
  const type = document.getElementById("fieldPromoType").value.trim();
  const active = document.getElementById("fieldPromoActive").checked;
  const buyIds = Array.from(document.getElementById("fieldBuyProductIds").selectedOptions)
  .map(opt => opt.value);
  const freeId = document.getElementById("fieldFreeProductId").value.trim();
  const freeQty = Number(document.getElementById("fieldFreeQty").value);
  

  if (!type || buyIds.length === 0 || !freeId) {
    showBanner("Please fill all required fields.", 3000);
    return;
  }
  if (!Number.isInteger(freeQty) || freeQty <= 0) {
    showBanner("Free quantity must be a positive integer.", 3000);
    return;
  }

const freeVariantEl = document.getElementById("fieldFreeVariant");
const freeVariant = (freeVariantEl?.value || "").trim();
const payload = { type, active, buy_product_ids: buyIds, free_product_id: freeId, free_qty: freeQty };
if (freeVariant) payload.free_variant = freeVariant;

  try {
    if (currentPromoId) {
      await db.collection("marketing_programs").doc(currentPromoId).set(payload, { merge: true });
      showBanner("Program updated.", 2200);
    } else {
      await db.collection("marketing_programs").add(payload);
      showBanner("Program created.", 2200);
    }
    invalidateMenuCache(); // optional: clear promo cache too
    closeModal("promoModal");
  } catch (e) {
    console.error("Save promo failed:", e);
    showBanner("Failed to save program.", 3200);
  }
}

async function deletePromo(id) {
  const ok = confirm("Delete this marketing program?");
  if (!ok) return;
  try {
    await db.collection("marketing_programs").doc(id).delete();
    invalidateMenuCache();
    showBanner("Program deleted.", 2200);
  } catch (e) {
    console.error("Delete promo failed:", e);
    showBanner("Failed to delete program.", 3200);
  }
}

function openPromoModal(id, data) {
  currentPromoId = id || null;
  currentPromoData = data || null;
  populatePromoForm(currentPromoData);
  openModal("promoModal");
}

  function collectPhotosInto(payload) {
    for (let i = 1; i <= 10; i++) {
      const val = (document.getElementById(`photo_${i}`).value || "").trim();
      payload[`photo_${i}`] = val;
    }
  }

  async function saveCurrentForm() {
    const name = document.getElementById("fieldName").value.trim();
    const category = document.getElementById("fieldCategory").value.trim() || "Uncategorized";
    const variantLabel = document.getElementById("fieldVariantLabel").value.trim();
    const variantName = document.getElementById("fieldVariant").value.trim(); // -> variant_names
    const priceVal = parsePrice(document.getElementById("fieldPrice").value);
    const pos_hidden = Number(document.getElementById("fieldHidden").value || 0);

    if (!name || priceVal <= 0) {
      showBanner("Name and a positive price are required.", 3200);
      return;
    }

    const payload = {
      name,
      category,
      variant_label: variantLabel || "",
      variant_names: variantName || "",
      pos_sell_price: priceVal,
      price: priceVal,
      pos_hidden
    };
    collectPhotosInto(payload);

    try {
      if (currentEditId) {
        await db.collection("products").doc(currentEditId).set(payload, { merge: true });
        showBanner("Product updated.", 2200);
      } else {
        await db.collection("products").add(payload);
        showBanner("Product created.", 2200);
      }
      invalidateMenuCache();
      closeModal("adminModal");
    } catch (e) {
      console.error("Save failed:", e);
      showBanner("Failed to save product.", 3200);
    }
  }

  async function deleteProduct(id, name = "", variantDisplay = "") {
    const label = [name, variantDisplay && variantDisplay !== "—" ? `(${variantDisplay})` : ""].filter(Boolean).join(" ");
    const ok = confirm(`Delete this product ${label ? `"${label}"` : ""}?`);
    if (!ok) return;
    try {
      await db.collection("products").doc(id).delete();
      invalidateMenuCache();
      showBanner("Product deleted.", 2200);
    } catch (e) {
      console.error("Delete failed:", e);
      showBanner("Failed to delete product.", 3200);
    }
  }

  /***********************
   * Bulk add
   ***********************/
  function parseBulkLines(text) {
    return String(text)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s*\|\s*|\s*,\s*/);
        const vName = (parts[0] || "").trim();
        const vPrice = parsePrice(parts[1] || "");
        return { variant_names: vName, price: vPrice };
      })
      .filter(item => item.variant_names && item.price > 0);
  }

  async function saveBulkForm() {
    const name = document.getElementById("bulkName").value.trim();
    const category = document.getElementById("bulkCategory").value.trim() || "Uncategorized";
    const variantLabel = document.getElementById("bulkVariantLabel").value.trim();
    const hidden = Number(document.getElementById("bulkHidden").value || 0);
    const lines = parseBulkLines(document.getElementById("bulkVariants").value);

    if (!name || lines.length === 0) {
      showBanner("Provide a name and at least one valid 'Variant | Price' line.", 3600);
      return;
    }

    const batch = db.batch();
    lines.forEach(({ variant_names, price }) => {
      const ref = db.collection("products").doc();
      batch.set(ref, {
        name,
        category,
        variant_names,
        variant_label: variantLabel || "",
        pos_sell_price: price,
        price,
        pos_hidden: hidden
      });
    });

    try {
      await batch.commit();
      invalidateMenuCache();
      closeModal("bulkModal");
      showBanner(`Created ${lines.length} variant${lines.length > 1 ? "s" : ""}.`, 2600);
    } catch (e) {
      console.error("Bulk commit failed:", e);
      showBanner("Bulk creation failed.", 3200);
    }
  }

  /***********************
   * Open edit modal
   ***********************/
  function openEditModal(id, data) {
    currentEditId = id || null;
    currentEditData = data || null;
    populateForm(currentEditData);
    openModal("adminModal");
  }

  /***********************
   * Wire up UI
   ***********************/
 function bindUI() {
 const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault(); // prevent full page reload

    const email = document.getElementById("adminEmail").value.trim();
    const pass = document.getElementById("adminPass").value.trim();

    if (!email || !pass) {
      showBanner("Email and password required.", 3000);
      return;
    }

    try {
      const cred = await auth.signInWithEmailAndPassword(email, pass);
      const ok = await requireAdmin(cred.user);
      if (!ok) return;
      toggleSections(true);
      listenProducts();
      listenPromos();
      showBanner("Welcome back.", 2000);
    } catch (err) {
      console.error("Login failed", err);
      showBanner("Login failed.", 3200);
    }
  });
}



    // Logout
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      try { await auth.signOut(); } catch {}
      toggleSections(false);
      if (typeof unsubscribeProducts === "function") {
        unsubscribeProducts();
        unsubscribeProducts = null;
      }
      showBanner("Logged out.", 2000);
    });

    // Toolbar actions
    document.getElementById("addProductBtn")?.addEventListener("click", () => {
      currentEditId = null;
      currentEditData = null;
      populateForm(null);
      openModal("adminModal");
    });
    document.getElementById("bulkAddBtn")?.addEventListener("click", () => {
      document.getElementById("bulkName").value = "";
      document.getElementById("bulkCategory").value = "";
      document.getElementById("bulkVariantLabel").value = "";
      document.getElementById("bulkVariants").value = "";
      document.getElementById("bulkHidden").value = "0";
      openModal("bulkModal");
    });
    document.getElementById("invalidateCacheBtn")?.addEventListener("click", invalidateMenuCache);

    // Search
    document.getElementById("searchInput")?.addEventListener("input", (e) => {
      filteredText = e.target.value || "";
      // Re-render from the last snapshot via re-attach (cheap for small datasets)
      listenProducts();
    });

    // Modal buttons
    document.getElementById("saveBtn")?.addEventListener("click", saveCurrentForm);
    document.getElementById("cancelBtn")?.addEventListener("click", () => closeModal("adminModal"));
    document.getElementById("bulkSaveBtn")?.addEventListener("click", saveBulkForm);
    document.getElementById("bulkCancelBtn")?.addEventListener("click", () => closeModal("bulkModal"));

    // Photos toggle + live preview
    document.getElementById("togglePhotos")?.addEventListener("click", () => {
      const box = document.getElementById("photoFields");
      box?.classList.toggle("hidden");
    });
    const photo1Input = document.getElementById("photo_1");
    if (photo1Input) {
      photo1Input.addEventListener("input", () => {
        const prev = document.getElementById("photoPreview");
        const u = (photo1Input.value || "").trim();
        if (!prev) return;
        if (u) {
          prev.src = u;
          prev.classList.remove("hidden");
        } else {
          prev.classList.add("hidden");
        }
      });
    }

    // Click outside to close modals
    document.getElementById("adminModal")?.addEventListener("click", (e) => {
      if (e.target.id === "adminModal") closeModal("adminModal");
    });
    document.getElementById("bulkModal")?.addEventListener("click", (e) => {
      if (e.target.id === "bulkModal") closeModal("bulkModal");
    });

    // ESC to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal("adminModal");
        closeModal("bulkModal");
      }
    });

    document.getElementById("addPromoBtn")?.addEventListener("click", () => {
  currentPromoId = null;
  currentPromoData = null;
  populatePromoForm(null);
  openModal("promoModal");
});
document.getElementById("savePromoBtn")?.addEventListener("click", savePromoForm);
document.getElementById("cancelPromoBtn")?.addEventListener("click", () => closeModal("promoModal"));
  }

  /***********************
   * Bootstrap
   ***********************/
  function init() {
    bindUI();
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        toggleSections(false);
        if (typeof unsubscribeProducts === "function") {
          unsubscribeProducts();
          unsubscribeProducts = null;
        }
        return;
      }
      const ok = await requireAdmin(user);
      if (!ok) return;
      toggleSections(true);
      listenProducts();
      listenPromos();
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  // Optional debug hook
  window.__adminDeleteProduct = deleteProduct;
})();

// admin.js — Part 2/2
(() => {
  "use strict";

  const EXPORT_BTN_ID = "__exportBtnInjected";
  const IMPORT_BTN_ID = "__importBtnInjected";
  const TEMPLATE_BTN_ID = "__templateBtnInjected";
  const FILE_INPUT_ID = "__importFileInput";
  const BATCH_LIMIT = 500; // Firestore batch write limit


  /* ------------------------
     EXPORT (your original code, kept mostly identical)
     ------------------------ */
  async function exportProducts() {
    try {
      const snap = await db.collection("products").orderBy("name").get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products-export-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
      showBannerLocal("Export failed.");
    }
  }

  function injectExportButton() {
    if (document.getElementById(EXPORT_BTN_ID)) return;
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar) return;
    const btn = document.createElement("button");
    btn.id = EXPORT_BTN_ID;
    btn.className = "btn";
    btn.textContent = "Export JSON";
    btn.addEventListener("click", exportProducts);

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && logoutBtn.parentNode === toolbar) {
      toolbar.insertBefore(btn, logoutBtn);
    } else {
      toolbar.appendChild(btn);
    }
  }

   /* ------------------------
     IMPORT UI injection and helpers
     ------------------------ */

  function injectImportUI() {
    if (document.getElementById(IMPORT_BTN_ID)) return;
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar) return;

    // Import button
    const importBtn = document.createElement("button");
    importBtn.id = IMPORT_BTN_ID;
    importBtn.className = "btn";
    importBtn.textContent = "Import CSV/XLSX";

    // Template button (small minimal button)
    const tplBtn = document.createElement("button");
    tplBtn.id = TEMPLATE_BTN_ID;
    tplBtn.className = "btn minimal";
    tplBtn.style.marginLeft = "6px";
    tplBtn.textContent = "Download Template";
    tplBtn.addEventListener("click", downloadTemplate);

    // hidden file input
    const fileInput = document.createElement("input");
    fileInput.id = FILE_INPUT_ID;
    fileInput.type = "file";
    fileInput.accept = ".csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) handleFileImport(f);
      // reset so same file can be picked again
      fileInput.value = "";
    });

    importBtn.addEventListener("click", () => fileInput.click());

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && logoutBtn.parentNode === toolbar) {
      toolbar.insertBefore(importBtn, logoutBtn);
      toolbar.insertBefore(tplBtn, logoutBtn);
    } else {
      toolbar.appendChild(importBtn);
      toolbar.appendChild(tplBtn);
    }

    document.body.appendChild(fileInput);
  }

  function downloadTemplate() {
    // Simple CSV header -> user can edit
    const headers = [
      "id (optional)",
      "name",
      "category",
      "variant_names",
      "variant_label",
      "price",
      "pos_hidden",
      "photo_1",
      "photo_2",
      "photo_3"
    ];
    const sampleRow = [
      "", // id
      "Coffee Latte",
      "Beverages",
      "Large|Medium|Small",
      "Size",
      "15000",
      "0",
      "https://example.com/photo1.jpg",
      "",
      ""
    ];
    const csv = `${headers.join(",")}\n${sampleRow.join(",")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `products-import-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  /* ------------------------
     CSV parsing helpers (simple RFC-4180-ish)
     ------------------------ */
  function csvToObjects(text) {
    // split into rows and parse respecting quotes
    const rows = [];
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fields = [];
      let cur = "";
      let inQuotes = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') {
          if (inQuotes && line[j + 1] === '"') {
            cur += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          fields.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      fields.push(cur);
      rows.push(fields);
    }

    if (rows.length === 0) return [];

    // Assume first row is header if any header-like cells present
    const rawHeader = rows[0].map(h => (h || "").trim());
    const isHeader = rawHeader.some(h => /name|price|category|variant/i.test(h));
    if (!isHeader) {
      // no header: create automatic headers as col1,col2...
      const maxCols = Math.max(...rows.map(r => r.length));
      const headers = [];
      for (let i = 0; i < maxCols; i++) headers.push(`col${i + 1}`);
      // convert rows to objects with those headers
      return rows.map(r => {
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
        return obj;
      });
    }

    // Map header -> rows
    const headers = rawHeader;
    const objs = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const o = {};
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j] || `col${j + 1}`;
        o[key] = r[j] ?? "";
      }
      // skip empty rows
      if (Object.values(o).every(v => String(v).trim() === "")) continue;
      objs.push(o);
    }
    return objs;
  }

  /* ------------------------
     Excel parsing using SheetJS if available
     ------------------------ */
  function parseXlsxArrayBufferToObjects(ab) {
    if (typeof XLSX === "undefined") {
      throw new Error("XLSX (SheetJS) is not available. Please include https://unpkg.com/xlsx/dist/xlsx.full.min.js");
    }
    const data = new Uint8Array(ab);
    // read workbook
    const wb = XLSX.read(data, { type: "array" });
    const first = wb.SheetNames[0];
    const sheet = wb.Sheets[first];
    // defval ensures empty cells become empty string rather than undefined
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return json; // array of objects (if headers present) or array of arrays if options changed
  }

  /* ------------------------
     Normalize/canonicalize header names
     ------------------------ */
  function normalizeKey(k) {
    return String(k || "")
      .trim()
      .toLowerCase()
      .replace(/[\s\-_\.]+/g, "");
  }

  function findFirst(row, candidates) {
    for (let i = 0; i < candidates.length; i++) {
      const key = candidates[i];
      // check direct exact match
      for (const rk of Object.keys(row)) {
        if (normalizeKey(rk) === normalizeKey(key)) return row[rk];
      }
    }
    // if not found by exact normalized name, try substring match
    for (const rk of Object.keys(row)) {
      const nk = normalizeKey(rk);
      for (const c of candidates) {
        if (nk.includes(normalizeKey(c))) return row[rk];
      }
    }
    return undefined;
  }

  function buildPayloadFromRow(row) {
    // candidate header keys
    const name = (findFirst(row, ["name", "product_name", "title"]) || "").toString().trim();
    const category = (findFirst(row, ["category", "cat", "type", "kategori"]) || "").toString().trim() || "Uncategorized";
    const variant_names = (findFirst(row, ["variant_names", "variant", "variants", "variantname"]) || "").toString().trim();
    const variant_label = (findFirst(row, ["variant_label", "variantlabel", "label"]) || "").toString().trim();
    const priceRaw = findFirst(row, ["price", "pos_sell_price", "posprice", "sellprice", "market_price"]) || "";
    const price = parsePriceLocal(priceRaw);
    const pos_hidden = Number(findFirst(row, ["pos_hidden", "hidden", "poshidden"]) || 0);

    const payload = {
      name: name || "",
      category,
      variant_label: variant_label || "",
      variant_names: variant_names || "",
      pos_sell_price: price,
      price: price,
      pos_hidden: Number.isFinite(pos_hidden) ? pos_hidden : 0
    };

    // photos: try locate photo_1..photo_10
    for (let i = 1; i <= 10; i++) {
      const candidates = [`photo_${i}`, `photo${i}`, `image${i}`, `img${i}`, `photo ${i}`];
      const v = findFirst(row, candidates);
      if (v !== undefined && String(v).trim() !== "") {
        payload[`photo_${i}`] = String(v).trim();
      }
    }

    // any other fields that are blank/included can optionally be added, but above are the main ones.
    return payload;
  }

  /* ------------------------
     Core import routine: accepts array of row-objects (header keys => values)
     ------------------------ */
  async function importRowsIntoFirestore(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      showBannerLocal("No rows found to import.", 3000);
      return;
    }

    let batch = db.batch();
    let ops = 0;
    let created = 0;
    let updated = 0;
    let processed = 0;

    try {
      for (const row of rows) {
        processed++;
        // find id if available (support multiple id field names)
        const idVal = findFirst(row, ["id", "product_id", "docid", "doc_id"]) || "";
        const id = String(idVal || "").trim();

                const payload = buildPayloadFromRow(row);
        if (!payload.name || payload.pos_sell_price <= 0) {
          console.warn("Skipping invalid row:", row);
          continue;
        }

        if (id) {
          // update existing doc
          const ref = db.collection("products").doc(id);
          batch.set(ref, payload, { merge: true });
          updated++;
        } else {
          // create new doc
          const ref = db.collection("products").doc();
          batch.set(ref, payload);
          created++;
        }
        ops++;

        if (ops >= BATCH_LIMIT) {
          await batch.commit();
          console.log(`Committed batch of ${ops}`);
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }
      invalidateMenuCache();
      showBannerLocal(`Import done. Created ${created}, updated ${updated}. Processed ${processed} rows.`, 4000);
    } catch (e) {
      console.error("Import failed:", e);
      showBannerLocal("Import failed. Check console for details.", 4000);
    }
  }

  function showBannerLocal(msg, ms = 3000) {
    if (typeof showBanner === "function") {
      showBanner(msg, ms);
    } else {
      alert(msg);
    }
  }

  function parsePriceLocal(input) {
    if (typeof input === "number") return input;
    if (!input) return 0;
    const cleaned = String(input).replace(/[^\d.-]/g, "");
    const num = Number(cleaned);
    return isNaN(num) ? 0 : Math.round(num);
  }

  async function handleFileImport(file) {
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let rows = [];
      if (ext === "csv") {
        const text = await file.text();
        rows = csvToObjects(text);
      } else if (ext === "xlsx" || ext === "xls") {
        const ab = await file.arrayBuffer();
        rows = parseXlsxArrayBufferToObjects(ab);
      } else {
        showBannerLocal("Unsupported file type. Please use CSV or XLSX.", 3000);
        return;
      }
      await importRowsIntoFirestore(rows);
    } catch (e) {
      console.error("File import failed:", e);
      showBannerLocal("Import failed.", 3000);
    }
  }

  /* ------------------------
     Bootstrapping
     ------------------------ */
  function initAdminImportExport() {
    injectExportButton();
    injectImportUI();
  }

  document.addEventListener("DOMContentLoaded", initAdminImportExport);
})();
