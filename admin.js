// admin.js — patched single file
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

  // Expose shared instances for outside usage
  window.auth = auth;
  window.db = db;
  // window.invalidateMenuCache will be assigned AFTER the function is defined.

  /***********************
   * Globals
   ***********************/
  let unsubscribeProducts = null;
  let unsubscribePromos = null;
  let currentEditId = null;
  let currentEditData = null;
  let filteredText = "";
  let currentPromoId = null;
  let currentPromoData = null;

  // For injection & file input
  const EXPORT_BTN_ID = "__exportBtnInjected";
  const IMPORT_BTN_ID = "__importBtnInjected";
  const TEMPLATE_BTN_ID = "__templateBtnInjected";
  const FILE_INPUT_ID = "__importFileInput";
  const BATCH_LIMIT = 500;

// normalize a Google Drive share URL into a direct image URL usable in <img src="">
function normalizeDriveUrlForSave(url) {
  if (!url) return url;
  const s = String(url).trim();
  // If it already looks like a proper image host, return as-is
  if (/^https?:\/\/(https?:)?\/\//.test(s) || /^data:image\//.test(s) || /^https?:\/\/(lh3|drive|docs)\./i.test(s)) {
    // detect drive /d/ link
    const m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m && m[1]) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
    const q = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (q && q[1]) return `https://drive.google.com/uc?export=view&id=${q[1]}`;
    return s;
  }
  // fallback
  return s;
}


  /***********************
   * Banner helper
   ***********************/
  function showBanner(msg, ms = 3000) {
    const b = document.getElementById("banner");
    if (!b) {
      // fallback
      console.info("Banner:", msg);
      return;
    }
    b.textContent = msg;
    b.classList.remove("hidden");
    clearTimeout(b.__hideTimer);
    b.__hideTimer = setTimeout(() => b.classList.add("hidden"), ms);
  }

  function showBannerLocal(msg, ms = 3000) {
    if (typeof showBanner === "function") showBanner(msg, ms);
    else alert(msg);
  }

  /***********************
   * Cache invalidation
   ***********************/
  function invalidateMenuCache() {
    try {
      localStorage.removeItem("productCacheV2");
      localStorage.removeItem("productCacheTimeV2");
      localStorage.removeItem("promoCacheV1");
      localStorage.removeItem("promoCacheTimeV1");
      showBanner("Menu & promo cache invalidated. Customers will fetch fresh data on next load.", 3200);
    } catch (e) {
      console.warn("Cache invalidate failed:", e);
    }
  }

  // expose after declaration
  window.invalidateMenuCache = invalidateMenuCache;

  /***********************
   * Admin gate using /admins/{uid}
   ***********************/
  async function isUidAdmin(uid) {
    if (!uid) return false;
    try {
      const snap = await db.collection("admins").doc(uid).get();
      return snap.exists;
    } catch (e) {
      console.error("isUidAdmin error:", e);
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
        populateBuyProductSelect(snap);
        populateFreeProductSelect(snap);
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
    const keepSelected = new Set(Array.from(sel.selectedOptions).map(o => o.value));
    sel.innerHTML = "";
    productsSnap.forEach(doc => {
      const p = doc.data();
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = `${p.name}${p.variant_names ? ` (${p.variant_names})` : ""}`;
      if (keepSelected.has(doc.id)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function populateFreeProductSelect(productsSnap) {
    const sel = document.getElementById("fieldFreeProductId");
    if (!sel) return;
    const currentValue = sel.value;
    sel.innerHTML = "";
    productsSnap.forEach(doc => {
      const p = doc.data();
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = `${p.name}${p.variant_names ? ` (${p.variant_names})` : ""}`;
      sel.appendChild(opt);
    });
    if (currentValue) sel.value = currentValue;
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
   * Modal helpers & forms
   ***********************/
  function openModal(id) { const m = document.getElementById(id); if (m) m.classList.remove("hidden"); }
  function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.add("hidden"); }

  function populatePhotos(p) {
    for (let i = 1; i <= 10; i++) {
      const elInput = document.getElementById(`photo_${i}`);
      if (elInput) elInput.value = p?.[`photo_${i}`] || "";
    }
    const prev = document.getElementById("photoPreview");
    if (prev) {
      const u = (p?.photo_1 || "").trim();
      if (u) { prev.src = u; prev.classList.remove("hidden"); }
      else prev.classList.add("hidden");
    }
  }

  function populateForm(p = null) {
    document.getElementById("modalTitle").textContent = p ? "Edit product" : "New product";
    document.getElementById("fieldName").value = p?.name || "";
    document.getElementById("fieldCategory").value = p?.category || "";
    document.getElementById("fieldVariantLabel").value = p?.variant_label || "";
    document.getElementById("fieldVariant").value = p?.variant_names || p?.variant || "";
    const price = p?.pos_sell_price ?? p?.price ?? p?.market_price ?? 0;
    document.getElementById("fieldPrice").value = price ? String(price) : "";
    const hidden = Number(p?.pos_hidden ?? 0);
    document.getElementById("fieldHidden").value = String(hidden);
    populatePhotos(p);
  }

  // ---- FIX: add the missing openEditModal function ----
  function openEditModal(id, data) {
    currentEditId = id || null;
    currentEditData = data || null;
    populateForm(currentEditData);
    openModal("adminModal");
  }

  function populatePromoForm(p = null) {
    document.getElementById("promoModalTitle").textContent = p ? "Edit Program" : "New Program";
    document.getElementById("fieldPromoType").value = p?.type || "buy_x_get_y";
    document.getElementById("fieldPromoActive").checked = !!p?.active;
    document.getElementById("fieldFreeQty").value = p?.free_qty || 1;
    const freeSel = document.getElementById("fieldFreeProductId");
    if (freeSel) freeSel.value = p?.free_product_id || "";
    const buySel = document.getElementById("fieldBuyProductIds");
    if (buySel) {
      const ids = p?.buy_product_ids || [];
      Array.from(buySel.options).forEach(opt => { opt.selected = ids.includes(opt.value); });
    }
    const freeVariantEl = document.getElementById("fieldFreeVariant");
    if (freeVariantEl) freeVariantEl.value = p?.free_variant || "";
  }

  async function savePromoForm() {
    try {
      const type = document.getElementById("fieldPromoType").value.trim();
      const active = document.getElementById("fieldPromoActive").checked;
      const buyIds = Array.from(document.getElementById("fieldBuyProductIds").selectedOptions).map(o => o.value);
      const freeId = document.getElementById("fieldFreeProductId").value.trim();
      const freeQty = Number(document.getElementById("fieldFreeQty").value);

      if (!type || buyIds.length === 0 || !freeId) { showBanner("Please fill all required fields.", 3000); return; }
      if (!Number.isInteger(freeQty) || freeQty <= 0) { showBanner("Free quantity must be a positive integer.", 3000); return; }

      const freeVariant = (document.getElementById("fieldFreeVariant")?.value || "").trim();
      const payload = { type, active, buy_product_ids: buyIds, free_product_id: freeId, free_qty: freeQty };
      if (freeVariant) payload.free_variant = freeVariant;

      if (currentPromoId) {
        await db.collection("marketing_programs").doc(currentPromoId).set(payload, { merge: true });
        showBanner("Program updated.", 2200);
      } else {
        await db.collection("marketing_programs").add(payload);
        showBanner("Program created.", 2200);
      }
      invalidateMenuCache();
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
    const raw = (document.getElementById(`photo_${i}`)?.value || "").trim();
    payload[`photo_${i}`] = normalizeDriveUrlForSave(raw);
  }
}


  async function saveCurrentForm() {
    try {
      const name = document.getElementById("fieldName").value.trim();
      const category = document.getElementById("fieldCategory").value.trim() || "Uncategorized";
      const variantLabel = document.getElementById("fieldVariantLabel").value.trim();
      const variantName = document.getElementById("fieldVariant").value.trim();
      const priceVal = parsePrice(document.getElementById("fieldPrice").value);
      const pos_hidden = Number(document.getElementById("fieldHidden").value || 0);

      if (!name || priceVal <= 0) { showBanner("Name and a positive price are required.", 3200); return; }

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
    try {
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
   * Import/Export UI + logic
   ***********************/

  // CSV parser (simple)
  function csvToObjects(text) {
    const rows = [];
    // preserve blank lines? ignore them
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "") continue; // skip blank
      const fields = [];
      let cur = "";
      let inQuotes = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') {
          if (inQuotes && line[j + 1] === '"') { cur += '"'; j++; }
          else inQuotes = !inQuotes;
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
    const rawHeader = rows[0].map(h => (h || "").trim());
    const isHeader = rawHeader.some(h => /name|price|category|variant/i.test(h));
    if (!isHeader) {
      // make col1.. colN
      const maxCols = Math.max(...rows.map(r => r.length));
      const headers = [];
      for (let i = 0; i < maxCols; i++) headers.push(`col${i + 1}`);
      return rows.map(r => {
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
        return obj;
      });
    }
    const headers = rawHeader;
    const objs = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const o = {};
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j] || `col${j + 1}`;
        o[key] = r[j] ?? "";
      }
      if (Object.values(o).every(v => String(v).trim() === "")) continue;
      objs.push(o);
    }
    return objs;
  }

  function parseXlsxArrayBufferToObjects(ab) {
    if (typeof XLSX === "undefined") {
      throw new Error("XLSX (SheetJS) is not available. Please include https://unpkg.com/xlsx/dist/xlsx.full.min.js");
    }
    const data = new Uint8Array(ab);
    const wb = XLSX.read(data, { type: "array" });
    const first = wb.SheetNames[0];
    const sheet = wb.Sheets[first];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return json;
  }

  function normalizeKey(k) {
    return String(k || "").trim().toLowerCase().replace(/[\s\-_\.]+/g, "");
  }

  function findFirst(row, candidates) {
    for (let i = 0; i < candidates.length; i++) {
      for (const rk of Object.keys(row)) {
        if (normalizeKey(rk) === normalizeKey(candidates[i])) return row[rk];
      }
    }
    for (const rk of Object.keys(row)) {
      const nk = normalizeKey(rk);
      for (const c of candidates) {
        if (nk.includes(normalizeKey(c))) return row[rk];
      }
    }
    return undefined;
  }

  function parsePriceLocal(input) {
    if (typeof input === "number") return input;
    if (!input) return 0;
    const cleaned = String(input).replace(/[^\d.-]/g, "");
    const num = Number(cleaned);
    return isNaN(num) ? 0 : Math.round(num);
  }

  function buildPayloadFromRow(row) {
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

    for (let i = 1; i <= 10; i++) {
      const candidates = [`photo_${i}`, `photo${i}`, `image${i}`, `img${i}`, `photo ${i}`];
      const v = findFirst(row, candidates);
      if (v !== undefined && String(v).trim() !== "") payload[`photo_${i}`] = String(v).trim();
    }

    return payload;
  }

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
      const idVal = findFirst(row, ["id", "product_id", "docid", "doc_id"]) || "";
      const id = String(idVal || "").trim();
      const payload = buildPayloadFromRow(row);

      // Validate: require name and positive price for new creation
      if (!payload.name || payload.pos_sell_price <= 0) {
        // allow update if id present (user wants partial update)
        if (!id) {
          console.warn("Skipping invalid row:", row);
          continue;
        }
      }

      if (id) {
        const ref = db.collection("products").doc(id);
        batch.set(ref, payload, { merge: true });
        updated++;
      } else {
        const ref = db.collection("products").doc();
        batch.set(ref, { ...payload, id: ref.id }); // ⬅️ new ID injected into payload
        created++;
      }
      ops++;

      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
        showBannerLocal(`Imported ${processed} / ${rows.length} rows...`, 1200);
      }
    }

    if (ops > 0) await batch.commit();

    invalidateMenuCache();
    showBannerLocal(
      `Import done. Created ${created}, updated ${updated}. Processed ${processed} rows.`,
      4000
    );
  } catch (e) {
    console.error("Import failed:", e);
    showBannerLocal("Import failed. Check console for details.", 4000);
  }
}


  async function handleFileImport(file) {
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let rows = [];
      if (ext === "csv") {
        const text = await file.text();
        rows = csvToObjects(text);
      } else if (ext === "xlsx" || ext === "xls") {
        if (typeof XLSX === "undefined") {
          showBannerLocal("XLSX library not found. Include SheetJS (xlsx) to import Excel files.", 6000);
          console.warn("Include SheetJS: <script src='https://unpkg.com/xlsx/dist/xlsx.full.min.js'></script>");
          return;
        }
        const ab = await file.arrayBuffer();
        rows = parseXlsxArrayBufferToObjects(ab);
      } else {
        showBannerLocal("Unsupported file type. Please use CSV or XLSX.", 3000);
        return;
      }
      await importRowsIntoFirestore(rows);
    } catch (err) {
      console.error("File import failed:", err);
      showBannerLocal("Import failed. See console for details.", 4000);
    }
  }

  async function exportProductsAsExcel() {
    try {
      if (typeof XLSX === "undefined") {
        alert("XLSX library is missing. Please include https://unpkg.com/xlsx/dist/xlsx.full.min.js");
        return;
      }

      const snapshot = await db.collection("products").get();
      if (snapshot.empty) {
        alert("No products found to export!");
        return;
      }

      const products = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || "",
        category: doc.data().category || "",
        variant_label: doc.data().variant_label || "",
        variant_names: doc.data().variant_names || "",
        pos_sell_price: doc.data().pos_sell_price ?? doc.data().sell_price ?? doc.data().market_price ?? 0,
        pos_hidden: doc.data().pos_hidden ?? 0,
        photo_1: doc.data().photo_1 || "",
        photo_2: doc.data().photo_2 || "",
        photo_3: doc.data().photo_3 || ""
      }));

      // Explicitly set header order
      const headers = [
        "id",
        "name",
        "category",
        "variant_label",
        "variant_names",
        "pos_sell_price",
        "pos_hidden",
        "photo_1",
        "photo_2",
        "photo_3"
      ];

      const ws = XLSX.utils.json_to_sheet(products, { header: headers });
      // overwrite header row labels if you want more human-friendly names
      XLSX.utils.sheet_add_aoa(ws, [[
        "ID",
        "Name",
        "Category",
        "Variant Label",
        "Variant Names",
        "Price",
        "Hidden",
        "Photo 1",
        "Photo 2",
        "Photo 3"
      ]], { origin: "A1" });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Products");

      XLSX.writeFile(wb, "products.xlsx");
    } catch (err) {
      console.error("❌ Excel export failed:", err);
      alert("Export failed: " + err.message);
    }
  }

  function downloadTemplate() {
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
      "",
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products-import-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1000);
  }

  /***********************
   * UI injection helpers - robust
   ***********************/
  // Single file input instance reused
  function createOrGetFileInput() {
    let input = document.getElementById(FILE_INPUT_ID);
    if (input) return input;
    input = document.createElement("input");
    input.id = FILE_INPUT_ID;
    input.type = "file";
    input.accept = ".csv, .xls, .xlsx, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.style.display = "none";
    input.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) handleFileImport(f);
      // reset
      input.value = "";
    });
    document.body.appendChild(input);
    return input;
  }

  function injectExportButton(toolbar) {
    if (document.getElementById(EXPORT_BTN_ID)) {
      console.log("ℹ️ Export button already exists, skipping inject");
      return;
    }

    const btn = document.createElement("button");
    btn.id = EXPORT_BTN_ID;
    btn.textContent = "Export Excel";
    btn.addEventListener("click", () => {
      exportProductsAsExcel();
    });

    toolbar.appendChild(btn);

    console.log("✅ Export button injected into toolbar");
  }

  function injectImportUIInto(toolbar) {
    if (document.getElementById(IMPORT_BTN_ID)) return;

    const importBtn = document.createElement("button");
    importBtn.id = IMPORT_BTN_ID;
    importBtn.className = "btn";
    importBtn.textContent = "Import CSV/XLSX";

    const tplBtn = document.createElement("button");
    tplBtn.id = TEMPLATE_BTN_ID;
    tplBtn.className = "btn minimal";
    tplBtn.style.marginLeft = "6px";
    tplBtn.textContent = "Download Template";
    tplBtn.addEventListener("click", downloadTemplate);

    const fileInput = createOrGetFileInput();
    importBtn.addEventListener("click", () => fileInput.click());

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && logoutBtn.parentNode === toolbar) {
      toolbar.insertBefore(importBtn, logoutBtn);
      toolbar.insertBefore(tplBtn, logoutBtn);
    } else {
      toolbar.appendChild(importBtn);
      toolbar.appendChild(tplBtn);
    }

    console.log("✅ Import + Template buttons injected into toolbar");
  }

  function ensureToolbarInjection() {
    const toolbarSelector = ".toolbar";
    const attempted = { done: false };

    function tryInject() {
      const toolbar = document.querySelector(toolbarSelector);
      if (toolbar) {
        console.log("✅ Toolbar found, injecting buttons");
        injectExportButton(toolbar);
        injectImportUIInto(toolbar);
        attempted.done = true;
        return true;
      }
      console.log("⏳ Toolbar not found yet");
      return false;
    }

    if (tryInject()) return;

    const mo = new MutationObserver((mutations, obs) => {
      if (tryInject()) obs.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      if (!attempted.done) tryInject();
    }, 1000);
  }

  /***********************
   * Wire up UI
   ***********************/
  function bindUI() {
    // Login
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("adminEmail").value.trim();
        const pass = document.getElementById("adminPass").value.trim();
        if (!email || !pass) { showBanner("Email and password required.", 3000); return; }
        try {
          const cred = await auth.signInWithEmailAndPassword(email, pass);
          const ok = await requireAdmin(cred.user);
          if (!ok) return;
          toggleSections(true);
          listenProducts();
          listenPromos();
          showBanner("Welcome back.", 2000);
          // Try ensure buttons are present after login
          ensureToolbarInjection();
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
      if (typeof unsubscribeProducts === "function") { unsubscribeProducts(); unsubscribeProducts = null; }
      showBanner("Logged out.", 2000);
    });

    // toolbar actions (existing)
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

    document.getElementById("searchInput")?.addEventListener("input", (e) => {
      filteredText = e.target.value || "";
      // Re-render via re-attaching listener (cheap for small sets)
      listenProducts();
    });

    // Modal buttons
    document.getElementById("saveBtn")?.addEventListener("click", saveCurrentForm);
    document.getElementById("cancelBtn")?.addEventListener("click", () => closeModal("adminModal"));
    document.getElementById("bulkSaveBtn")?.addEventListener("click", saveBulkForm);
    document.getElementById("bulkCancelBtn")?.addEventListener("click", () => closeModal("bulkModal"));

    // Photo preview
    document.getElementById("togglePhotos")?.addEventListener("click", () => {
      const box = document.getElementById("photoFields"); box?.classList.toggle("hidden");
    });
    const photo1Input = document.getElementById("photo_1");
    if (photo1Input) {
photo1Input.addEventListener("input", () => {
  const prev = document.getElementById("photoPreview");
  const raw = (photo1Input.value || "").trim();
  const u = normalizeDriveUrlForSave(raw);
  if (!prev) return;
  if (u) { prev.src = u; prev.classList.remove("hidden"); }
  else prev.classList.add("hidden");
});
    }

    // click outside to close modals
    document.getElementById("adminModal")?.addEventListener("click", (e) => { if (e.target.id === "adminModal") closeModal("adminModal"); });
    document.getElementById("bulkModal")?.addEventListener("click", (e) => { if (e.target.id === "bulkModal") closeModal("bulkModal"); });

    // ESC to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeModal("adminModal"); closeModal("bulkModal"); }
    });

    // Promo modal hooks
    document.getElementById("addPromoBtn")?.addEventListener("click", () => {
      currentPromoId = null; currentPromoData = null; populatePromoForm(null); openModal("promoModal");
    });
    document.getElementById("savePromoBtn")?.addEventListener("click", savePromoForm);
    document.getElementById("cancelPromoBtn")?.addEventListener("click", () => closeModal("promoModal"));
  }


  /***********************
   * Bootstrap
   ***********************/
  function init() {
    bindUI();

    // Ensure toolbar injection as early as possible (cover both logged-in and already logged pages)
    ensureToolbarInjection();

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        toggleSections(false);
        if (typeof unsubscribeProducts === "function") { unsubscribeProducts(); unsubscribeProducts = null; }
        return;
      }
      const ok = await requireAdmin(user);
      if (!ok) return;
      toggleSections(true);
      listenProducts();
      listenPromos();
      // ensure buttons appear after login
      ensureToolbarInjection();
    });
  }

  /***********************
   * DOM ready wiring (single place)
   ***********************/
  document.addEventListener("DOMContentLoaded", () => {
    // wire possible existing export/import buttons in the HTML to the unified handlers
    const exportBtn = document.getElementById("exportBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => exportProductsAsExcel());
    }

    const importBtn = document.getElementById("importBtn");
    if (importBtn) {
      const fileInput = createOrGetFileInput();
      importBtn.addEventListener("click", () => fileInput.click());
    }

    // Now initialize the app (auth listeners, injections, etc.)
    init();
  });

  // Optional debug hook
  window.__adminDeleteProduct = deleteProduct;

})(); // end file
