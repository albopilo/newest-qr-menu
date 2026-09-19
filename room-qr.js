// room-qr.js — Room QR code management, ported from 13e-Cafe-bolt QrCodeTab.tsx
(() => {
  "use strict";

  const BASE_URL = window.location.origin.replace(/\/$/, "");

  const COLORS = {
    espresso: "#3D2817",
    espressoDark: "#2A1810",
    cream: "#FFFDF8",
    creamLight: "#F5EFE6",
    gold: "#C8A96A",
    goldLight: "#D4B97D",
    white: "#FFFFFF",
  };

  const CAFE_NAME = "13e Cafe";

  // Poster text constants (matching the 13e-Cafe-bolt template)
  const POSTER_TEXTS = {
    cafeName: CAFE_NAME,
    scanToOrder: "Scan to Order",
    roomLabel: "Room",
    instruction1: "1. Scan the QR code",
    instruction2: "2. Browse menu & place your order",
    instruction3: "3. Pay via QRIS or cash",
    qrisOnly: "QRIS Only",
  };

  /***********************
   * Canvas poster generation (exact replica of 13e-Cafe-bolt)
   ***********************/
  function ctxTextWidth(ctx, text, font) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  async function generatePosterCanvas(room, scale) {
    scale = scale || 2;
    const W = 600 * scale;
    const H = 850 * scale;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    const w = 600;
    const h = 850;

    // Background
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, w, h);

    // Top decorative band
    const gradTop = ctx.createLinearGradient(0, 0, w, 0);
    gradTop.addColorStop(0, COLORS.espresso);
    gradTop.addColorStop(0.5, COLORS.espressoDark);
    gradTop.addColorStop(1, COLORS.espresso);
    ctx.fillStyle = gradTop;
    ctx.fillRect(0, 0, w, 140);

    // Gold accent line under top band
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(0, 140, w, 4);

    // Cafe name
    ctx.fillStyle = COLORS.white;
    ctx.font = "bold 42px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(POSTER_TEXTS.cafeName, w / 2, 75);

    // Cafe subtitle line
    ctx.fillStyle = COLORS.goldLight;
    ctx.font = "italic 16px Georgia, serif";
    ctx.fillText("Coffee & Comfort", w / 2, 105);

    // "Scan to Order" headline
    ctx.fillStyle = COLORS.espresso;
    ctx.font = "bold 32px Georgia, serif";
    ctx.fillText(POSTER_TEXTS.scanToOrder, w / 2, 210);

    // Room label badge
    const badgeW = 220;
    const badgeH = 44;
    const badgeX = (w - badgeW) / 2;
    const badgeY = 235;
    ctx.fillStyle = COLORS.espresso;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 10);
    ctx.fill();

    ctx.fillStyle = COLORS.goldLight;
    ctx.font = "bold 20px Georgia, serif";
    ctx.fillText(POSTER_TEXTS.roomLabel + ": " + (room.display_name || room.name), w / 2, badgeY + 29);

    // QR code
    const qrSize = 300;
    const qrX = (w - qrSize) / 2;
    const qrY = 310;

    // QR code white background with border
    ctx.fillStyle = COLORS.white;
    ctx.fillRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32);
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 3;
    ctx.strokeRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32);

    // Generate QR onto its own canvas, then draw onto poster
    const qrCanvas = document.createElement("canvas");
    await QRCode.toCanvas(qrCanvas, BASE_URL + "/?table=" + encodeURIComponent(room.name), {
      width: qrSize,
      margin: 1,
      color: { dark: COLORS.espresso, light: COLORS.white },
    });
    ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

    // Instructions section
    const instY = 660;
    ctx.fillStyle = COLORS.espresso;
    ctx.font = "bold 18px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(POSTER_TEXTS.instruction1, w / 2, instY);

    ctx.fillStyle = "#6B5544";
    ctx.font = "15px -apple-system, sans-serif";
    ctx.fillText(POSTER_TEXTS.instruction2, w / 2, instY + 28);
    ctx.fillText(POSTER_TEXTS.instruction3, w / 2, instY + 50);

    // Payment info badges
    const pillY = instY + 80;
    const pills = [];
    if (room.qris_only) {
      pills.push({ text: POSTER_TEXTS.qrisOnly, bg: "#E8D5B8", fg: COLORS.espresso });
    }

    if (pills.length > 0) {
      let totalPillW = 0;
      for (const p of pills) {
        totalPillW += ctxTextWidth(ctx, p.text, "bold 13px -apple-system, sans-serif") + 28;
      }
      let pillX = (w - totalPillW) / 2;
      ctx.font = "bold 13px -apple-system, sans-serif";
      for (const p of pills) {
        const pw = ctxTextWidth(ctx, p.text, "bold 13px -apple-system, sans-serif") + 28;
        const ph = 30;
        ctx.fillStyle = p.bg;
        drawRoundedRect(ctx, pillX, pillY, pw, ph, 15);
        ctx.fill();
        ctx.fillStyle = p.fg;
        ctx.fillText(p.text, pillX + pw / 2, pillY + 20);
        pillX += pw + 10;
      }
    }

    // Bottom band
    const gradBot = ctx.createLinearGradient(0, 0, w, 0);
    gradBot.addColorStop(0, COLORS.espresso);
    gradBot.addColorStop(0.5, COLORS.espressoDark);
    gradBot.addColorStop(1, COLORS.espresso);
    ctx.fillStyle = gradBot;
    ctx.fillRect(0, h - 60, w, 60);

    ctx.fillStyle = COLORS.goldLight;
    ctx.font = "13px Georgia, serif";
    ctx.fillText(BASE_URL, w / 2, h - 35);

    return canvas;
  }

  /***********************
   * State
   ***********************/
  let rooms = [];
  let editingRoomId = null;
  let unsubscribeRooms = null;

  /***********************
   * Helpers
   ***********************/
  function showBanner(msg, ms) {
    ms = ms || 3000;
    const b = document.getElementById("banner");
    if (!b) { console.info("Banner:", msg); return; }
    b.textContent = msg;
    b.classList.remove("hidden");
    clearTimeout(b.__hideTimer);
    b.__hideTimer = setTimeout(() => b.classList.add("hidden"), ms);
  }

  function el(tag, props, children) {
    props = props || {};
    children = children || [];
    const node = document.createElement(tag);
    Object.entries(props).forEach(function (entry) {
      var k = entry[0], v = entry[1];
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    });
    children.forEach(function (ch) { node.appendChild(ch); });
    return node;
  }

  /***********************
   * Load rooms from Firestore
   ***********************/
  function listenRooms() {
    if (typeof unsubscribeRooms === "function") {
      unsubscribeRooms();
      unsubscribeRooms = null;
    }
    var db = window.db;
    if (!db) return;
    unsubscribeRooms = db.collection("room_tables")
      .orderBy("sort_order", "asc")
      .onSnapshot(function (snap) {
        rooms = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          d._id = doc.id;
          rooms.push(d);
        });
        renderRoomCards();
        var status = document.getElementById("roomStatus");
        if (status) {
          status.textContent = rooms.length === 0
            ? "No rooms yet. Click \"Add Room\" to create one."
            : rooms.length + " room" + (rooms.length > 1 ? "s" : "") + " configured";
        }
      }, function (err) {
        console.error("Rooms listen error:", err);
        showBanner("Failed to load rooms.", 3500);
      });
  }

  /***********************
   * Render room QR cards
   ***********************/
  function renderRoomCards() {
    var list = document.getElementById("roomQrList");
    if (!list) return;
    list.innerHTML = "";

    if (rooms.length === 0) {
      list.innerHTML = '<p class="muted" style="text-align:center; padding:20px;">No rooms yet. Click "Add Room" to create one.</p>';
      return;
    }

    rooms.forEach(function (room) {
      var card = el("div", { class: "row", style: "display:flex; flex-direction:column; align-items:center; padding:12px;" });

      // Header row
      var head = el("div", { style: "display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;" });
      var info = el("div", {}, [
        el("p", { style: "font-weight:bold; color:#3D2817; margin:0;" }, [document.createTextNode(room.display_name || room.name)]),
        el("p", { style: "font-size:12px; color:#6b7280; margin:2px 0 0 0;" }, [document.createTextNode(room.qris_only ? "QRIS Only" : "Cash")])
      ]);
      var btns = el("div", { style: "display:flex; gap:4px;" });
      var editBtn = el("button", { class: "btn minimal", style: "padding:4px 8px; font-size:12px;" }, [document.createTextNode("Edit")]);
      editBtn.addEventListener("click", function () { openRoomModal(room); });
      var delBtn = el("button", { class: "btn danger", style: "padding:4px 8px; font-size:12px;" }, [document.createTextNode("Delete")]);
      delBtn.addEventListener("click", function () { deleteRoom(room); });
      btns.appendChild(editBtn);
      btns.appendChild(delBtn);
      head.appendChild(info);
      head.appendChild(btns);
      card.appendChild(head);

      // QR canvas container
      var qrBox = el("div", { style: "background:#fff; padding:10px; border-radius:8px; border:1px solid #e5e7eb; margin:8px 0;" });
      var canvas = el("canvas");
      qrBox.appendChild(canvas);
      card.appendChild(qrBox);

      // URL text
      var url = BASE_URL + "/?table=" + encodeURIComponent(room.name);
      var urlP = el("p", { style: "font-size:11px; color:#6b7280; text-align:center; margin:4px 0 8px; word-break:break-all;" }, [document.createTextNode(url)]);
      card.appendChild(urlP);

      // Download button
      var dlBtn = el("button", { class: "btn", style: "width:100%; justify-content:center;" }, [document.createTextNode("Download QR Poster")]);
      dlBtn.addEventListener("click", function () { downloadRoomPoster(room); });
      card.appendChild(dlBtn);

      list.appendChild(card);

      // Generate QR code on canvas
      QRCode.toCanvas(canvas, url, {
        width: 200,
        margin: 2,
        color: { dark: COLORS.espresso, light: COLORS.cream },
      }, function (err) {
        if (err) console.error("QR generation error:", err);
      });
    });
  }

  /***********************
   * Download single poster
   ***********************/
  async function downloadRoomPoster(room) {
    try {
      var poster = await generatePosterCanvas(room, 2);
      var link = document.createElement("a");
      link.download = "qr-" + room.name.replace(/\s+/g, "-") + ".png";
      link.href = poster.toDataURL("image/png");
      link.click();
      showBanner("QR poster downloaded.", 2000);
    } catch (err) {
      console.error("Download poster error:", err);
      showBanner("Failed to download poster.", 3000);
    }
  }

  /***********************
   * Download all as ZIP
   ***********************/
  async function downloadAllPosters() {
    if (rooms.length === 0) return;
    showBanner("Generating posters...", 2000);
    try {
      var zip = new JSZip();
      for (var i = 0; i < rooms.length; i++) {
        var room = rooms[i];
        var poster = await generatePosterCanvas(room, 2);
        var dataUrl = poster.toDataURL("image/png");
        var base64 = dataUrl.split(",")[1];
        zip.file("qr-" + room.name.replace(/\s+/g, "-") + ".png", base64, { base64: true });
      }
      var blob = await zip.generateAsync({ type: "blob" });
      var link = document.createElement("a");
      link.download = "qr-codes-all-rooms.zip";
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
      showBanner("All QR posters downloaded.", 3000);
    } catch (err) {
      console.error("Download all error:", err);
      showBanner("Failed to download all posters.", 3000);
    }
  }

  /***********************
   * Print all
   ***********************/
  async function openPrintLayout() {
    if (rooms.length === 0) return;
    var modal = document.getElementById("roomPrintModal");
    var area = document.getElementById("roomPrintArea");
    if (!modal || !area) return;
    area.innerHTML = '<p class="muted" style="text-align:center; padding:20px;">Generating posters...</p>';
    modal.classList.remove("hidden");

    area.innerHTML = "";
    for (var i = 0; i < rooms.length; i++) {
      var room = rooms[i];
      var poster = await generatePosterCanvas(room, 1.5);
      var wrap = el("div", { style: "display:inline-block; width:48%; vertical-align:top; padding:8px;" });
      var img = el("img", { src: poster.toDataURL("image/png"), style: "width:100%; border:1px solid #e5e7eb; border-radius:8px;" });
      wrap.appendChild(img);
      area.appendChild(wrap);
    }
  }

  function closePrintLayout() {
    var modal = document.getElementById("roomPrintModal");
    if (modal) modal.classList.add("hidden");
  }

  /***********************
   * Room form modal
   ***********************/
  function openRoomModal(room) {
    var modal = document.getElementById("roomModal");
    if (!modal) return;
    editingRoomId = room ? room._id : null;

    document.getElementById("roomModalTitle").textContent = room ? "Edit Room" : "Add Room";
    document.getElementById("roomName").value = room ? (room.name || "") : "";
    document.getElementById("roomName").disabled = !!room;
    document.getElementById("roomDisplayName").value = room ? (room.display_name || "") : "";
    document.getElementById("roomDeliveryFee").value = room ? (room.delivery_fee || 0) : 0;
    document.getElementById("roomQrisOnly").checked = room ? !!room.qris_only : false;

    modal.classList.remove("hidden");
  }

  function closeRoomModal() {
    var modal = document.getElementById("roomModal");
    if (modal) modal.classList.add("hidden");
    editingRoomId = null;
  }

  async function saveRoom() {
    var db = window.db;
    if (!db) return;
    var name = document.getElementById("roomName").value.trim();
    var displayName = document.getElementById("roomDisplayName").value.trim();
    var deliveryFee = parseInt(document.getElementById("roomDeliveryFee").value, 10) || 0;
    var qrisOnly = document.getElementById("roomQrisOnly").checked;

    if (!name) {
      showBanner("Room name is required.", 3000);
      return;
    }

    var data = {
      name: name,
      display_name: displayName || name,
      delivery_fee: deliveryFee,
      qris_only: qrisOnly,
      sort_order: 99,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      if (editingRoomId) {
        await db.collection("room_tables").doc(editingRoomId).set(data, { merge: true });
      } else {
        // Check for duplicate name
        var existing = await db.collection("room_tables").where("name", "==", name).limit(1).get();
        if (!existing.empty) {
          showBanner("A room with this name already exists.", 3000);
          return;
        }
        await db.collection("room_tables").add(data);
      }
      showBanner("Room saved.", 2000);
      closeRoomModal();
    } catch (err) {
      console.error("Save room error:", err);
      showBanner("Failed to save room.", 3000);
    }
  }

  async function deleteRoom(room) {
    var db = window.db;
    if (!db) return;
    if (!confirm("Delete room \"" + room.name + "\"? This cannot be undone.")) return;
    try {
      await db.collection("room_tables").doc(room._id).delete();
      showBanner("Room deleted.", 2000);
    } catch (err) {
      console.error("Delete room error:", err);
      showBanner("Failed to delete room.", 3000);
    }
  }

  /***********************
   * Bind UI events
   ***********************/
  function bindRoomQrUI() {
    document.getElementById("addRoomBtn")?.addEventListener("click", function () { openRoomModal(null); });
    document.getElementById("saveRoomBtn")?.addEventListener("click", saveRoom);
    document.getElementById("cancelRoomBtn")?.addEventListener("click", closeRoomModal);
    document.getElementById("printAllRoomsBtn")?.addEventListener("click", openPrintLayout);
    document.getElementById("closePrintBtn")?.addEventListener("click", closePrintLayout);
    document.getElementById("downloadAllRoomsBtn")?.addEventListener("click", downloadAllPosters);
    document.getElementById("doPrintBtn")?.addEventListener("click", function () { window.print(); });

    // Close modals on outside click
    document.getElementById("roomModal")?.addEventListener("click", function (e) {
      if (e.target.id === "roomModal") closeRoomModal();
    });
    document.getElementById("roomPrintModal")?.addEventListener("click", function (e) {
      if (e.target.id === "roomPrintModal") closePrintLayout();
    });

    // ESC to close
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeRoomModal();
        closePrintLayout();
      }
    });
  }

  /***********************
   * Init — wait for admin auth, then load rooms
   ***********************/
  function initRoomQr() {
    bindRoomQrUI();

    // Listen for auth state to start loading rooms after admin login
    var auth = window.auth;
    if (auth) {
      auth.onAuthStateChanged(function (user) {
        if (user) {
          listenRooms();
        } else {
          rooms = [];
          if (typeof unsubscribeRooms === "function") { unsubscribeRooms(); unsubscribeRooms = null; }
          renderRoomCards();
        }
      });
    }
  }

  // Add print styles
  var style = document.createElement("style");
  style.textContent = "@media print { body * { visibility: hidden; } #roomPrintArea, #roomPrintArea * { visibility: visible; } #roomPrintArea { position: absolute; left: 0; top: 0; width: 100%; } }";
  document.head.appendChild(style);

  document.addEventListener("DOMContentLoaded", initRoomQr);
})();
