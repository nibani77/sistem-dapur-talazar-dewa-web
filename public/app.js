(function () {
  "use strict";

  // =====================================================================
  //  Helper umum
  // =====================================================================
  const $ = (id) => document.getElementById(id);

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin"
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* tanpa isi */ }
    if (!res.ok) {
      const err = new Error(data.error || "Terjadi kesalahan.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Semua teks dari pengguna (nama, alamat, catatan, nama menu...) wajib lewat esc() sebelum masuk innerHTML.
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ESC[c]);

  const roleLabel = { admin: "Admin", dapur: "Dapur", kurir: "Kurir" };
  const roleIcon = { admin: "AD", dapur: "DP", kurir: "KR" };
  const statusLabel = { baru: "Baru", dimasak: "Dimasak", siap: "Siap diambil", diantar: "Diantar", selesai: "Selesai", batal: "Dibatalkan" };
  const ACTIVE = ["baru", "dimasak", "siap", "diantar"];
  const BASE_TITLE = document.title;

  const rupiah = (n) => "Rp" + Math.round(Number(n || 0)).toLocaleString("id-ID");
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = () => new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const fmtDateTime = (ts) => new Date(ts).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtFull = (ts) => new Date(ts).toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  function fmtElapsed(ts) {
    const diff = Math.max(0, Date.now() - ts);
    return Math.floor(diff / 60000) + ":" + pad2(Math.floor((diff % 60000) / 1000));
  }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  const isToday = (ts) => ts >= startOfDay(Date.now());
  const ymdLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const vlabel = (v) => (v && v !== "-" ? v : "");
  const itemLabel = (i) => i.nama + (vlabel(i.varian) ? " (" + vlabel(i.varian) + ")" : "");
  const itemsSummary = (o) => o.items.map((i) => itemLabel(i) + " x" + i.qty).join(", ");

  // =====================================================================
  //  State
  // =====================================================================
  let currentUser = null;
  let company = { name: "CV Karya Cinta Talazar", address: "", phone: "", note: "" };
  let orders = [];
  let menuItems = [];   // menu aktif (untuk membuat pesanan)
  let allMenu = [];     // semua menu termasuk nonaktif (khusus admin)
  let cart = [];
  let editingOrder = null;
  let itemsLocked = false;
  let detailOrderId = null;

  const adminFilter = { q: "", status: "", from: "", to: "", limit: 100 };
  const search = { dapur: "", kurir: "" };

  const screenLogin = $("screen-login");
  const screenApp = $("screen-app");
  const panels = { admin: $("panel-admin"), dapur: $("panel-dapur"), kurir: $("panel-kurir") };

  // =====================================================================
  //  Toast, suara, dan notifikasi pesanan
  // =====================================================================
  function toast(title, body, kind) {
    const stack = $("toast-stack");
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.innerHTML = `<b>${esc(title)}</b>${body ? esc(body) : ""}`;
    const close = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    el.addEventListener("click", close);
    stack.appendChild(el);
    while (stack.children.length > 5) stack.removeChild(stack.firstChild);
    setTimeout(close, kind === "err" ? 9000 : 8000);
  }
  const showError = (e) => toast("Gagal", e && e.message ? e.message : String(e), "err");

  let audioCtx = null;
  function soundEnabled() { try { return localStorage.getItem("dn_sound") !== "0"; } catch (e) { return true; } }
  function saveSound(on) { try { localStorage.setItem("dn_sound", on ? "1" : "0"); } catch (e) { /* abaikan */ } }

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) { try { audioCtx = new AC(); } catch (e) { return null; } }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function chime() {
    if (!soundEnabled()) return;
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    [[880, 0], [1175, 0.2], [880, 0.4]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0 + at); osc.stop(t0 + at + 0.2);
    });
  }
  function updateSoundUI() {
    const on = soundEnabled();
    $("sound-btn").textContent = on ? "🔔" : "🔕";
    $("sound-btn").title = on ? "Suara notifikasi aktif (klik untuk senyap)" : "Suara notifikasi senyap (klik untuk aktifkan)";
    const needGesture = on && !screenApp.hidden && (!audioCtx || audioCtx.state !== "running");
    $("sound-banner").hidden = !needGesture;
  }
  // Browser hanya mengizinkan suara setelah pengguna menyentuh layar sekali.
  ["pointerdown", "keydown"].forEach((evt) => document.addEventListener(evt, () => { ensureAudio(); setTimeout(updateSoundUI, 150); }, { passive: true }));
  $("sound-banner").addEventListener("click", () => { ensureAudio(); setTimeout(() => { chime(); updateSoundUI(); }, 150); });
  $("sound-btn").addEventListener("click", () => {
    const next = !soundEnabled();
    saveSound(next);
    if (next) {
      ensureAudio();
      if ("Notification" in window && Notification.permission === "default") { try { Notification.requestPermission(); } catch (e) { /* abaikan */ } }
      setTimeout(() => { chime(); updateSoundUI(); }, 150);
      toast("Suara notifikasi aktif", "Kamu akan mendengar bunyi saat ada pesanan yang perlu perhatian. Biarkan halaman ini tetap terbuka.", "ok");
    } else {
      toast("Suara notifikasi senyap", "Pemberitahuan tetap muncul di layar.");
    }
    updateSoundUI();
  });

  let unread = 0;
  function bumpTitle() {
    if (!document.hidden) return;
    unread++;
    document.title = `(${unread}) ${BASE_TITLE}`;
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      unread = 0; document.title = BASE_TITLE;
      if (!screenApp.hidden) pollNow();
    }
  });

  function notify(title, body) {
    toast(title, body);
    chime();
    bumpTitle();
    try {
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body: body || "" });
      }
    } catch (e) { /* abaikan */ }
  }

  // Bandingkan data terbaru dengan yang terakhir dilihat, lalu beri tahu sesuai peran.
  const known = new Map(); // id -> { status, editedAt }
  let notifyReady = false;

  function detectChanges(fresh, silent) {
    const role = currentUser.role;
    for (const o of fresh) {
      const prev = known.get(o.id);
      if (notifyReady && !silent) {
        if (!prev) {
          if (role === "dapur" && o.status === "baru") notify("Pesanan baru " + o.id, `${o.customer} · ${itemsSummary(o)}`);
        } else {
          if (role === "kurir" && prev.status !== "siap" && o.status === "siap") {
            notify("Siap diambil: " + o.id, `${o.customer}${o.pickupLocation ? " · di " + o.pickupLocation : ""}`);
          }
          if (role === "admin" && prev.status !== "selesai" && o.status === "selesai") {
            notify("Sudah diantar: " + o.id, `${o.customer} · oleh ${o.courier || "kurir"}`);
          }
          if (o.status === "batal" && prev.status !== "batal" && role !== "admin") {
            const relevant = role === "dapur" ? ["baru", "dimasak", "siap"] : ["siap", "diantar"];
            if (relevant.includes(prev.status)) notify("DIBATALKAN: " + o.id, `${o.customer}${o.cancelReason ? " · " + o.cancelReason : ""}. Jangan diproses.`);
          }
          if ((o.editedAt || 0) !== (prev.editedAt || 0) && role !== "admin") {
            const relevant = role === "dapur" ? ["baru", "dimasak", "siap"] : ["siap", "diantar"];
            if (relevant.includes(o.status)) notify("Pesanan diubah: " + o.id, "Admin mengubah pesanan ini. Cek ulang detailnya.");
          }
        }
      }
      known.set(o.id, { status: o.status, editedAt: o.editedAt || 0 });
    }
  }

  // =====================================================================
  //  Memuat data
  // =====================================================================
  function ordersUrl() {
    if (currentUser && currentUser.role === "admin" && (adminFilter.from || adminFilter.to)) {
      const from = adminFilter.from ? new Date(adminFilter.from + "T00:00:00").getTime() : 0;
      const to = adminFilter.to ? new Date(adminFilter.to + "T00:00:00").getTime() + 86400000 : Date.now() + 366 * 86400000;
      return `/api/orders?from=${from}&to=${to}`;
    }
    return "/api/orders";
  }

  async function refreshOrders() {
    const url = ordersUrl();
    const { orders: fresh } = await api("GET", url);
    detectChanges(fresh, url !== "/api/orders");
    orders = fresh;
    notifyReady = true;
    renderAll();
  }

  function rememberOrder(order) {
    known.set(order.id, { status: order.status, editedAt: order.editedAt || 0 });
    const idx = orders.findIndex((o) => o.id === order.id);
    if (idx >= 0) orders[idx] = order; else orders.unshift(order);
  }

  // =====================================================================
  //  Layar & login
  // =====================================================================
  async function showApp(user) {
    currentUser = user;
    known.clear(); notifyReady = false;
    orders = []; menuItems = []; allMenu = [];
    Object.assign(adminFilter, { q: "", status: "", from: "", to: "", limit: 100 });
    $("f-q").value = ""; $("f-status").value = ""; $("f-from").value = ""; $("f-to").value = "";
    screenLogin.hidden = true;
    screenApp.hidden = false;
    $("who-avatar").textContent = roleIcon[user.role];
    $("who-avatar").className = "who-avatar " + user.role;
    $("who-name").textContent = user.name;
    $("who-role").textContent = roleLabel[user.role];
    Object.entries(panels).forEach(([k, p]) => p.classList.toggle("active", k === user.role));
    if (user.role === "kurir") {
      $("kurir-name").textContent = user.name;
      $("kurir-avatar").textContent = user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    }
    updateSoundUI();
    try {
      const jobs = [refreshOrders(), api("GET", "/api/config").then((r) => { company = Object.assign(company, r.company); })];
      if (user.role === "admin") jobs.push(loadMenu());
      await Promise.all(jobs);
    } catch (e) {
      if (e.status === 401) showLogin("Sesi berakhir. Silakan masuk lagi.");
      else console.error(e);
    }
  }

  async function loadMenu() {
    const { items } = await api("GET", "/api/menu");
    allMenu = items;
    menuItems = items.filter((i) => i.aktif);
    populateMenuCategories();
  }

  function showLogin(message) {
    currentUser = null;
    orders = [];
    closeAllModals();
    screenApp.hidden = true;
    screenLogin.hidden = false;
    document.title = BASE_TITLE;
    if (message) { msgBox.className = "msg err show"; msgBox.textContent = message; }
  }

  $("logout-btn").addEventListener("click", async () => {
    try { await api("POST", "/api/auth/logout"); } catch (e) { /* abaikan */ }
    showLogin();
  });

  const form = $("login-form");
  const msgBox = $("msg-box");
  const toggleBtn = $("toggle-pass");
  const passInput = $("password");

  toggleBtn.addEventListener("click", () => {
    const show = passInput.type === "password";
    passInput.type = show ? "text" : "password";
    toggleBtn.textContent = show ? "Sembunyikan" : "Tampilkan";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = form.querySelector('input[name="role"]:checked').value;
    const username = $("username").value.trim();
    const password = passInput.value.trim();
    if (!username || !password) {
      msgBox.className = "msg err show";
      msgBox.textContent = "Nama pengguna atau kata sandi belum diisi.";
      return;
    }
    try {
      const { user } = await api("POST", "/api/auth/login", { username, password, role });
      msgBox.classList.remove("show");
      form.reset();
      showApp(user);
    } catch (err) {
      msgBox.className = "msg err show";
      msgBox.textContent = err.message;
    }
  });

  // =====================================================================
  //  ADMIN: ringkasan, filter, tabel
  // =====================================================================
  function filteredOrders() {
    const q = adminFilter.q.trim().toLowerCase();
    return orders.filter((o) => {
      if (adminFilter.status === "aktif") { if (!ACTIVE.includes(o.status)) return false; }
      else if (adminFilter.status && o.status !== adminFilter.status) return false;
      if (q) {
        const hay = [o.id, o.customer, o.addr, o.notes, o.courier, o.pickupLocation, itemsSummary(o)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.placedAt - a.placedAt);
  }

  function renderAdmin() {
    $("admin-date").textContent = fmtDate();
    const today = orders.filter((o) => isToday(o.placedAt) && o.status !== "batal");
    $("kpi-total").textContent = today.length;
    $("kpi-revenue").textContent = rupiah(today.reduce((s, o) => s + o.total, 0));
    $("kpi-cooking").textContent = orders.filter((o) => o.status === "dimasak").length;
    $("kpi-couriers").textContent = orders.filter((o) => o.status === "diantar").length;

    const list = filteredOrders();
    const shown = list.slice(0, adminFilter.limit);
    $("f-count").textContent = list.length
      ? `Menampilkan ${shown.length} dari ${list.length} pesanan${adminFilter.from || adminFilter.to ? "" : " (90 hari terakhir + yang masih berjalan)"}`
      : "";
    $("admin-table-body").innerHTML = shown.length ? shown.map((o) => `
      <tr class="${o.status === "batal" ? "is-batal" : ""}">
        <td class="oid">${esc(o.id)}</td>
        <td class="nowrap">${esc(fmtDateTime(o.placedAt))}</td>
        <td>${esc(o.customer)}${o.editedAt ? ' <span class="tag edit">diubah</span>' : ""}</td>
        <td class="menu">${esc(itemsSummary(o))}</td>
        <td>${esc(o.courier || "—")}</td>
        <td><span class="badge ${esc(o.status)}">${esc(statusLabel[o.status])}</span></td>
        <td class="oid">${esc(rupiah(o.total))}</td>
        <td class="act"><button class="btn-sm" data-detail="${esc(o.id)}">Detail</button><button class="btn-sm" data-nota="${esc(o.id)}">Nota</button></td>
      </tr>`).join("") : `<tr><td colspan="8" style="text-align:center; color:var(--muted); padding:22px;">Tidak ada pesanan yang cocok.</td></tr>`;
    $("f-more-row").hidden = list.length <= adminFilter.limit;

    const counts = { baru: 0, dimasak: 0, siap: 0, diantar: 0, selesai: 0, batal: 0 };
    list.forEach((o) => counts[o.status]++);
    const colors = { baru: "var(--chili)", dimasak: "var(--turmeric)", siap: "var(--steel)", diantar: "#5B6B4A", selesai: "var(--leaf)", batal: "var(--muted)" };
    const max = Math.max(1, ...Object.values(counts));
    $("admin-bars").innerHTML = Object.entries(counts).map(([k, v]) => `
      <div class="bar-row">
        <div class="bl">${esc(statusLabel[k])}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%; background:${colors[k]}"></div></div>
        <div class="bv">${v}</div>
      </div>`).join("");

    const delivered = orders.filter((o) => o.status === "selesai").sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0)).slice(0, 12);
    $("admin-delivered").innerHTML = delivered.length
      ? delivered.map((o) => `
        <div class="delivered-row">
          ${o.proofUrl ? `<a href="${esc(o.proofUrl)}" target="_blank" rel="noopener"><img class="delivered-thumb" loading="lazy" src="${esc(o.proofUrl)}" alt="Bukti pengantaran ${esc(o.id)}"></a>` : `<div class="delivered-thumb none">Tanpa foto</div>`}
          <div class="delivered-info">
            <div class="did">${esc(o.id)} — ${esc(o.customer)}</div>
            <div class="dmeta">${esc(o.addr)}</div>
            <div class="dmeta">Diantar oleh ${esc(o.courier || "—")}${o.deliveredAt ? " · selesai " + esc(fmtDateTime(o.deliveredAt)) : ""}</div>
          </div>
        </div>`).join("")
      : `<div class="delivered-empty">Belum ada pengantaran yang selesai.</div>`;
  }

  $("admin-table-body").addEventListener("click", (e) => {
    const d = e.target.closest("[data-detail]");
    if (d) return openDetail(d.dataset.detail);
    const n = e.target.closest("[data-nota]");
    if (n) { const o = orders.find((x) => x.id === n.dataset.nota); if (o) printNota(o); }
  });

  $("f-q").addEventListener("input", () => { adminFilter.q = $("f-q").value; adminFilter.limit = 100; renderAdmin(); });
  $("f-status").addEventListener("change", () => { adminFilter.status = $("f-status").value; adminFilter.limit = 100; renderAdmin(); });
  async function onDateFilter() {
    adminFilter.from = $("f-from").value; adminFilter.to = $("f-to").value; adminFilter.limit = 100;
    try { await refreshOrders(); } catch (e) { showError(e); }
  }
  $("f-from").addEventListener("change", onDateFilter);
  $("f-to").addEventListener("change", onDateFilter);
  $("f-reset").addEventListener("click", async () => {
    const hadDates = adminFilter.from || adminFilter.to;
    Object.assign(adminFilter, { q: "", status: "", from: "", to: "", limit: 100 });
    $("f-q").value = ""; $("f-status").value = ""; $("f-from").value = ""; $("f-to").value = "";
    if (hadDates) { try { await refreshOrders(); } catch (e) { showError(e); } } else renderAdmin();
  });
  $("f-more").addEventListener("click", () => { adminFilter.limit += 100; renderAdmin(); });

  // =====================================================================
  //  DAPUR
  // =====================================================================
  function matchesSearch(o, q) {
    q = q.trim().toLowerCase();
    if (!q) return true;
    return [o.id, o.customer, o.addr, o.notes, o.pickupLocation, itemsSummary(o)].join(" ").toLowerCase().includes(q);
  }

  function ticketHTML(o, kind) {
    const mins = Math.floor((Date.now() - o.placedAt) / 60000);
    const urgent = (kind === "baru" && mins >= 5) || (kind === "dimasak" && mins >= 15);
    const btn = kind === "baru"
      ? `<button class="ticket-btn to-dimasak" data-id="${esc(o.id)}" data-next="dimasak">Mulai masak</button>`
      : kind === "dimasak"
      ? `<button class="ticket-btn to-siap" data-open-ready="${esc(o.id)}">Tandai siap</button>`
      : `<button class="ticket-btn done" disabled>Menunggu diambil kurir</button>`;
    const komposisi = kind === "dimasak"
      ? `<div class="ticket-komposisi">${o.items.map((i) => `
          <div class="komposisi-row">
            <div class="komposisi-item">${esc(itemLabel(i))} <span class="mono">x${i.qty}</span></div>
            <div class="komposisi-detail">${esc(i.komposisi || "Komposisi belum tercatat.")}</div>
          </div>`).join("")}</div>`
      : "";
    const note = o.notes ? `<div class="ticket-note"><b>Catatan:</b> ${esc(o.notes)}</div>` : "";
    const edited = o.editedAt ? `<div class="ticket-note" style="background:var(--turmeric-soft); color:var(--turmeric);">✏️ Pesanan ini diubah admin — cek ulang menu dan catatannya.</div>` : "";
    const location = (kind === "siap" && o.pickupLocation) ? `<div class="ticket-location">📍 Diletakkan di: ${esc(o.pickupLocation)}</div>` : "";
    return `
      <div class="ticket">
        <div class="ticket-top"><span class="ticket-id">${esc(o.id)}</span><span class="ticket-timer ${urgent ? "urgent" : ""} mono">${fmtElapsed(o.placedAt)}</span></div>
        <div class="ticket-cust">${esc(o.customer)}</div>
        <div class="ticket-addr">${esc(o.addr)}</div>
        ${note}${edited}
        <ul class="ticket-items">${o.items.map((i) => `<li>${esc(itemLabel(i))} x${i.qty}</li>`).join("")}</ul>
        ${komposisi}
        ${location}
        <button type="button" class="btn-sm ticket-print" data-print="${esc(o.id)}">🖨️ Cetak pesanan ini</button>
        ${btn}
      </div>`;
  }

  // Lembar cetak 1 pesanan untuk dapur: pelanggan, catatan, dan tiap menu lengkap dengan komposisinya.
  function printDapurOrder(o) {
    const rows = o.items.map((i, n) => `
      <tr><td>${n + 1}</td>
      <td><b>${esc(i.nama)}</b>${vlabel(i.varian) ? "<br>" + esc(vlabel(i.varian)) : ""}</td>
      <td class="r">${i.qty}${i.satuan ? " " + esc(i.satuan) : ""}</td>
      <td class="komp">${esc(i.komposisi || "Komposisi belum tercatat.")}</td></tr>`).join("");
    printHtml(`
      <div class="print-sheet">
        <div class="nota-head">
          <div class="nota-co">${esc(company.name)}<small>Lembar pesanan dapur</small></div>
          <div class="nota-title">${esc(o.id)}<small>${esc(statusLabel[o.status])}</small></div>
        </div>
        <div class="nota-meta">
          <div><b>Pelanggan</b>: ${esc(o.customer)}</div>
          <div><b>Waktu pesan</b>: ${esc(fmtFull(o.placedAt))}</div>
          <div><b>Alamat</b>: ${esc(o.addr)}</div>
          <div><b>Lokasi penempatan</b>: ${esc(o.pickupLocation || "—")}</div>
        </div>
        ${o.notes ? `<p style="border:1.5px solid #111; padding:6px 8px; font-size:12.5px; font-weight:700; margin:0 0 12px;">CATATAN: ${esc(o.notes)}</p>` : ""}
        ${o.editedAt ? `<p style="font-size:11.5px; font-weight:700; margin:0 0 10px;">Pesanan ini sudah diubah admin. Pakai lembar ini, bukan cetakan lama.</p>` : ""}
        <table>
          <thead><tr><th>No</th><th>Menu</th><th class="r">Jumlah</th><th>Komposisi / bahan per 1 paket</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-size:10.5px; color:#444; margin-top:8px;">Kebutuhan bahan total = komposisi x jumlah dipesan.</p>
        <div class="nota-sign"><div>Dimasak oleh</div><div>Dicek oleh</div></div>
        <p style="font-size:10px; color:#777; margin-top:14px;">Dicetak ${esc(fmtFull(Date.now()))}</p>
      </div>`);
  }

  function renderDapur() {
    $("dapur-date").textContent = fmtDate();
    const groups = { baru: [], dimasak: [], siap: [] };
    orders.forEach((o) => { if (groups[o.status] && matchesSearch(o, search.dapur)) groups[o.status].push(o); });
    ["baru", "dimasak", "siap"].forEach((k) => {
      $("count-" + k).textContent = groups[k].length;
      $("col-" + k).innerHTML = groups[k].length
        ? groups[k].sort((a, b) => a.placedAt - b.placedAt).map((o) => ticketHTML(o, k)).join("")
        : `<div class="empty-col">${search.dapur.trim() ? "Tidak ada yang cocok" : "Tidak ada pesanan"}</div>`;
    });
  }

  $("panel-dapur").addEventListener("click", (e) => {
    const pr = e.target.closest("[data-print]");
    if (pr) { const o = orders.find((x) => x.id === pr.dataset.print); if (o) printDapurOrder(o); return; }
    const next = e.target.closest(".ticket-btn[data-next]");
    if (next) return updateOrderStatus(next.dataset.id, { status: next.dataset.next });
    const ready = e.target.closest(".ticket-btn[data-open-ready]");
    if (ready) openReadyModal(ready.dataset.openReady);
  });
  $("dapur-q").addEventListener("input", () => { search.dapur = $("dapur-q").value; renderDapur(); });

  // =====================================================================
  //  KURIR
  // =====================================================================
  function deliveryHTML(o, kind) {
    const action = kind === "siap"
      ? `<button class="pill-btn pickup" data-id="${esc(o.id)}" data-next="diantar">Ambil pesanan</button>`
      : `<button class="pill-btn finish" data-open-deliver="${esc(o.id)}">Selesai diantar</button>`;
    const location = o.pickupLocation ? `<div class="delivery-location">📍 Dari dapur: ${esc(o.pickupLocation)}</div>` : "";
    const note = o.notes ? `<div class="delivery-note">📝 ${esc(o.notes)}</div>` : "";
    const edited = o.editedAt ? `<div class="delivery-note" style="background:var(--turmeric-soft); color:var(--turmeric);">✏️ Diubah admin — cek alamat dan catatan</div>` : "";
    return `
      <div class="delivery ${kind}">
        <div class="delivery-main">
          <div class="delivery-id mono">${esc(o.id)}</div>
          <div class="delivery-addr">${esc(o.addr)}</div>
          <div class="delivery-cust">${esc(o.customer)}</div>
          ${location}${note}${edited}
        </div>
        <div class="delivery-actions">${action}</div>
      </div>`;
  }

  function renderKurir() {
    $("kurir-date").textContent = fmtDate();
    const me = currentUser.name;
    const siap = orders.filter((o) => o.status === "siap" && matchesSearch(o, search.kurir));
    // Kurir hanya melihat pesanan yang ia ambil sendiri; kurir lain punya daftarnya sendiri.
    const diantarSaya = orders.filter((o) => o.status === "diantar" && o.courier === me && matchesSearch(o, search.kurir));
    const diantarLain = orders.filter((o) => o.status === "diantar" && o.courier !== me).length;
    const selesaiSaya = orders.filter((o) => o.status === "selesai" && o.courier === me && o.deliveredAt && isToday(o.deliveredAt));

    $("kurir-siap").innerHTML = siap.length ? siap.map((o) => deliveryHTML(o, "siap")).join("") : `<div class="empty-col">Belum ada pesanan siap diambil</div>`;
    $("kurir-diantar").innerHTML = (diantarSaya.length ? diantarSaya.map((o) => deliveryHTML(o, "diantar")).join("") : `<div class="empty-col">Kamu tidak sedang mengantar pesanan</div>`)
      + (diantarLain ? `<div class="empty-col" style="margin-top:10px;">${diantarLain} pesanan sedang diantar kurir lain</div>` : "");
    $("kurir-count").textContent = selesaiSaya.length;
    $("kurir-earn").textContent = diantarSaya.length;
  }

  $("panel-kurir").addEventListener("click", (e) => {
    const next = e.target.closest(".pill-btn[data-next]");
    if (next) return updateOrderStatus(next.dataset.id, { status: next.dataset.next, courier: currentUser.name });
    const deliver = e.target.closest(".pill-btn[data-open-deliver]");
    if (deliver) openDeliverModal(deliver.dataset.openDeliver);
  });
  $("kurir-q").addEventListener("input", () => { search.kurir = $("kurir-q").value; renderKurir(); });

  // =====================================================================
  //  Render & polling
  // =====================================================================
  function renderAll() {
    if (screenApp.hidden || !currentUser) return;
    if (currentUser.role === "admin") renderAdmin();
    else if (currentUser.role === "dapur") renderDapur();
    else renderKurir();
  }
  setInterval(() => { if (!screenApp.hidden && currentUser && currentUser.role === "dapur") renderDapur(); }, 1000);

  let polling = false;
  async function pollNow() {
    if (screenApp.hidden || polling) return;
    polling = true;
    try { await refreshOrders(); }
    catch (e) { if (e.status === 401) showLogin("Sesi berakhir atau akun dinonaktifkan. Silakan masuk lagi."); }
    finally { polling = false; }
  }
  setInterval(pollNow, 5000);

  async function updateOrderStatus(id, payload) {
    try {
      const { order } = await api("PATCH", `/api/orders/${encodeURIComponent(id)}/status`, payload);
      rememberOrder(order);
      renderAll();
      return true;
    } catch (e) {
      showError(e);
      pollNow();
      return false;
    }
  }

  // =====================================================================
  //  Modal umum
  // =====================================================================
  const MODAL_IDS = ["order-modal", "ready-modal", "deliver-modal", "password-modal", "accounts-modal", "detail-modal", "menu-admin-modal", "report-modal"];
  function closeAllModals() { MODAL_IDS.forEach((id) => { const m = $(id); if (m) m.hidden = true; }); }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = MODAL_IDS.map($).filter((m) => m && !m.hidden).pop();
    if (open) open.hidden = true;
  });

  // =====================================================================
  //  ADMIN: buat / ubah pesanan
  // =====================================================================
  const orderModal = $("order-modal");
  const menuListEl = $("menu-list");
  const menuCountEl = $("menu-count");
  const menuSearchEl = $("menu-search");
  const menuCategoryEl = $("menu-category");
  const cartListEl = $("cart-list");
  const cartTotalEl = $("cart-total");
  const submitOrderBtn = $("submit-order");
  const orderMsgEl = $("order-msg");
  const orderCustomerEl = $("order-customer");
  const orderAddressEl = $("order-address");
  const orderNotesEl = $("order-notes");

  function populateMenuCategories() {
    const categories = Array.from(new Set(menuItems.map((i) => i.kategori)));
    menuCategoryEl.innerHTML = '<option value="">Semua kategori</option>' + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  const cartKey = (nama, varian) => (nama + "|" + (varian || "")).toLowerCase();

  function renderMenuList() {
    if (itemsLocked) {
      menuCountEl.textContent = "";
      menuListEl.innerHTML = '<div class="menu-empty">Menu tidak bisa diubah karena pesanan ini sudah siap/diantar.</div>';
      return;
    }
    const q = menuSearchEl.value.trim().toLowerCase();
    const cat = menuCategoryEl.value;
    const filtered = menuItems.filter((it) => {
      if (cat && it.kategori !== cat) return false;
      if (q && !(it.nama.toLowerCase().includes(q) || it.kategori.toLowerCase().includes(q))) return false;
      return true;
    });
    menuCountEl.textContent = filtered.length + " menu ditemukan";
    if (!filtered.length) {
      menuListEl.innerHTML = '<div class="menu-empty">Tidak ada menu yang cocok.</div>';
      return;
    }
    let html = "";
    let lastCat = null;
    filtered.forEach((it) => {
      if (it.kategori !== lastCat) { html += `<div class="menu-cat-head">${esc(it.kategori)}</div>`; lastCat = it.kategori; }
      const sub = [vlabel(it.varian), it.jumlah ? it.jumlah + " " + it.satuan : ""].filter(Boolean).join(" · ");
      html += `
        <div class="menu-row">
          <div class="menu-row-info">
            <div class="menu-row-name">${esc(it.nama)}</div>
            <div class="menu-row-sub">${esc(sub)}</div>
          </div>
          <div class="menu-row-price mono">${esc(rupiah(it.harga))}</div>
          <button type="button" class="menu-add-btn" data-id="${it.id}" title="Tambah ke pesanan">+</button>
        </div>`;
    });
    menuListEl.innerHTML = html;
  }
  menuListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-add-btn");
    if (!btn) return;
    const it = menuItems.find((m) => String(m.id) === btn.dataset.id);
    if (it) addToCart(it);
  });

  function addToCart(it) {
    const key = cartKey(it.nama, it.varian);
    const existing = cart.find((c) => c.key === key);
    if (existing) existing.qty++;
    else cart.push({ key, menuId: it.id, nama: it.nama, varian: it.varian, harga: it.harga, satuan: it.satuan, qty: 1 });
    renderCart();
  }
  function changeQty(key, delta) {
    const c = cart.find((x) => x.key === key);
    if (!c) return;
    c.qty += delta;
    if (c.qty <= 0) cart = cart.filter((x) => x.key !== key);
    renderCart();
  }

  function renderCart() {
    if (!cart.length) {
      cartListEl.innerHTML = '<div class="cart-empty">Belum ada menu dipilih.</div>';
    } else {
      cartListEl.innerHTML = cart.map((c) => `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-name">${esc(c.nama)}${vlabel(c.varian) ? " — " + esc(c.varian) : ""}</div>
            <div class="cart-item-price">${esc(rupiah(c.harga))} / ${esc(c.satuan || "item")}</div>
            ${itemsLocked ? "" : `<button type="button" class="cart-remove" data-key="${esc(c.key)}">Hapus</button>`}
          </div>
          <div class="cart-qty">
            ${itemsLocked ? `<span class="qty-val mono">x${c.qty}</span>` : `
            <button type="button" class="qty-btn" data-key="${esc(c.key)}" data-d="-1">−</button>
            <span class="qty-val mono">${c.qty}</span>
            <button type="button" class="qty-btn" data-key="${esc(c.key)}" data-d="1">+</button>`}
          </div>
        </div>`).join("");
    }
    cartTotalEl.textContent = rupiah(cart.reduce((s, c) => s + c.harga * c.qty, 0));
    submitOrderBtn.disabled = !(orderCustomerEl.value.trim() && (cart.length || itemsLocked));
  }
  cartListEl.addEventListener("click", (e) => {
    const q = e.target.closest(".qty-btn");
    if (q) return changeQty(q.dataset.key, parseInt(q.dataset.d, 10));
    const r = e.target.closest(".cart-remove");
    if (r) { cart = cart.filter((c) => c.key !== r.dataset.key); renderCart(); }
  });

  // order = null -> pesanan baru; order = {...} -> ubah pesanan yang ada
  function openOrderModal(order) {
    editingOrder = order || null;
    itemsLocked = !!order && !["baru", "dimasak"].includes(order.status);
    cart = order ? order.items.map((i) => ({ key: cartKey(i.nama, i.varian), nama: i.nama, varian: i.varian, harga: i.harga, satuan: i.satuan, qty: i.qty })) : [];
    orderCustomerEl.value = order ? order.customer : "";
    orderAddressEl.value = order && order.addr !== "Alamat menyusul dikonfirmasi" ? order.addr : "";
    orderNotesEl.value = order ? order.notes : "";
    menuSearchEl.value = ""; menuCategoryEl.value = "";
    orderMsgEl.textContent = "";
    $("order-modal-title").textContent = order ? "Ubah pesanan " + order.id : "Buat pesanan baru";
    $("order-modal-sub").textContent = order
      ? "Harga menu yang sudah ada di pesanan ini tidak berubah. Menu baru memakai harga katalog sekarang."
      : "Pilih menu dari daftar harga, lalu kirim ke dapur.";
    $("cart-lock-note").hidden = !itemsLocked;
    submitOrderBtn.textContent = order ? "Simpan perubahan" : "Kirim ke dapur";
    renderMenuList(); renderCart();
    orderModal.hidden = false;
  }
  function closeOrderModal() { orderModal.hidden = true; editingOrder = null; }

  $("open-order-modal").addEventListener("click", () => openOrderModal(null));
  $("close-order-modal").addEventListener("click", closeOrderModal);
  orderModal.addEventListener("click", (e) => { if (e.target === orderModal) closeOrderModal(); });
  menuSearchEl.addEventListener("input", renderMenuList);
  menuCategoryEl.addEventListener("change", renderMenuList);
  orderCustomerEl.addEventListener("input", renderCart);

  submitOrderBtn.addEventListener("click", async () => {
    const customer = orderCustomerEl.value.trim();
    if (!customer || (!cart.length && !itemsLocked)) return;
    const payload = {
      customer,
      addr: orderAddressEl.value.trim() || "Alamat menyusul dikonfirmasi",
      notes: orderNotesEl.value.trim()
    };
    if (!itemsLocked) payload.items = cart.map((c) => ({ menuId: c.menuId, nama: c.nama, varian: c.varian, qty: c.qty }));
    submitOrderBtn.disabled = true;
    try {
      let order;
      if (editingOrder) ({ order } = await api("PUT", `/api/orders/${encodeURIComponent(editingOrder.id)}`, payload));
      else ({ order } = await api("POST", "/api/orders", payload));
      const wasEdit = !!editingOrder;
      rememberOrder(order);
      closeOrderModal();
      renderAll();
      toast(wasEdit ? "Pesanan diperbarui" : "Pesanan terkirim ke dapur", `${order.id} · ${order.customer}`, "ok");
      if (wasEdit && !$("detail-modal").hidden && detailOrderId === order.id) openDetail(order.id);
    } catch (e) {
      orderMsgEl.textContent = e.message;
      submitOrderBtn.disabled = false;
    }
  });

  // =====================================================================
  //  ADMIN: detail pesanan, batalkan, nota
  // =====================================================================
  const detailModal = $("detail-modal");

  function openDetail(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    detailOrderId = id;
    $("detail-title").textContent = "Pesanan " + o.id;
    $("detail-sub").innerHTML = `<span class="badge ${esc(o.status)}">${esc(statusLabel[o.status])}</span>`;
    const row = (k, v) => `<div><div class="k">${esc(k)}</div><div>${v}</div></div>`;
    const cancelInfo = o.status === "batal"
      ? row("Dibatalkan", `${esc(o.cancelledAt ? fmtFull(o.cancelledAt) : "—")}<br><span class="multiline">${esc(o.cancelReason || "")}</span>`) : "";
    $("detail-body").innerHTML = `
      <div class="detail-grid">
        ${row("Pelanggan", esc(o.customer))}
        ${row("Dibuat", esc(fmtFull(o.placedAt)))}
        ${row("Alamat pengantaran", esc(o.addr))}
        ${row("Catatan", o.notes ? `<span class="multiline">${esc(o.notes)}</span>` : "—")}
        ${row("Lokasi penempatan (dapur)", esc(o.pickupLocation || "—"))}
        ${row("Siap diambil", esc(o.readyAt ? fmtFull(o.readyAt) : "—"))}
        ${row("Kurir", esc(o.courier || "—"))}
        ${row("Selesai diantar", esc(o.deliveredAt ? fmtFull(o.deliveredAt) : "—"))}
        ${o.editedAt ? row("Terakhir diubah", esc(fmtFull(o.editedAt))) : ""}
        ${cancelInfo}
      </div>
      <table class="detail-items">
        <thead><tr><th>Menu</th><th class="r">Qty</th><th class="r">Harga</th><th class="r">Subtotal</th></tr></thead>
        <tbody>${o.items.map((i) => `
          <tr>
            <td><b>${esc(i.nama)}</b>${vlabel(i.varian) ? " — " + esc(i.varian) : ""}
              ${i.komposisi ? `<details><summary>Lihat komposisi</summary><div class="komp">${esc(i.komposisi)}</div></details>` : ""}</td>
            <td class="r">${i.qty}</td><td class="r">${esc(rupiah(i.harga))}</td><td class="r">${esc(rupiah(i.harga * i.qty))}</td>
          </tr>`).join("")}</tbody>
      </table>
      <div class="detail-total"><span>Total</span><span class="mono">${esc(rupiah(o.total))}</span></div>
      ${o.proofUrl ? `<div class="detail-proof"><div class="k" style="font-size:11.5px; color:var(--muted); font-weight:600;">Foto bukti pengantaran</div><a href="${esc(o.proofUrl)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(o.proofUrl)}" alt="Bukti pengantaran ${esc(o.id)}"></a></div>` : ""}
      <div id="cancel-area"></div>`;
    const canChange = o.status !== "selesai" && o.status !== "batal";
    $("detail-foot").innerHTML = `
      ${canChange ? `<button class="btn-sm danger" data-act="cancel">⛔ Batalkan pesanan</button><button class="btn-sm" data-act="edit">✏️ Ubah pesanan</button>` : ""}
      <button class="btn-sm" data-act="dapur">🖨️ Lembar dapur (bahan)</button>
      <button class="btn-sm primary" data-act="nota">🖨️ Cetak nota</button>`;
    detailModal.hidden = false;
  }

  $("close-detail-modal").addEventListener("click", () => { detailModal.hidden = true; });
  detailModal.addEventListener("click", (e) => { if (e.target === detailModal) detailModal.hidden = true; });

  $("detail-foot").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    const o = orders.find((x) => x.id === detailOrderId);
    if (!btn || !o) return;
    if (btn.dataset.act === "nota") printNota(o);
    if (btn.dataset.act === "dapur") printDapurOrder(o);
    if (btn.dataset.act === "edit") { detailModal.hidden = true; openOrderModal(o); }
    if (btn.dataset.act === "cancel") {
      $("cancel-area").innerHTML = `
        <div class="cancel-box">
          <label for="cancel-reason">Alasan pembatalan (wajib, akan tercatat di riwayat)</label>
          <input type="text" id="cancel-reason" maxlength="255" placeholder="mis. Pelanggan membatalkan / salah input">
          <div class="form-msg err" id="cancel-msg"></div>
          <div class="row"><button class="btn-sm" id="cancel-back">Kembali</button><button class="btn-sm danger" id="cancel-confirm">Ya, batalkan pesanan</button></div>
        </div>`;
      $("cancel-reason").focus();
      $("cancel-back").addEventListener("click", () => { $("cancel-area").innerHTML = ""; });
      $("cancel-confirm").addEventListener("click", async () => {
        const reason = $("cancel-reason").value.trim();
        if (reason.length < 3) { $("cancel-msg").textContent = "Tulis alasan pembatalan (minimal 3 huruf)."; return; }
        $("cancel-confirm").disabled = true;
        try {
          const { order } = await api("POST", `/api/orders/${encodeURIComponent(o.id)}/cancel`, { reason });
          rememberOrder(order);
          renderAll();
          openDetail(order.id);
          toast("Pesanan dibatalkan", order.id, "ok");
        } catch (err) {
          $("cancel-msg").textContent = err.message;
          $("cancel-confirm").disabled = false;
          pollNow();
        }
      });
    }
  });

  // =====================================================================
  //  Cetak (nota, daftar pesanan, laporan, rekap dapur/kurir)
  // =====================================================================
  function printHtml(html) {
    document.querySelectorAll(".print-area").forEach((a) => { a.innerHTML = ""; });
    $("print-admin").innerHTML = html;
    document.body.classList.add("printing");
    window.print();
  }
  window.addEventListener("afterprint", () => document.body.classList.remove("printing"));

  function printNota(o) {
    const rows = o.items.map((i, n) => `
      <tr><td>${n + 1}</td><td>${esc(i.nama)}</td><td>${esc(vlabel(i.varian))}</td>
      <td class="r">${i.qty}</td><td class="r">${esc(rupiah(i.harga))}</td><td class="r">${esc(rupiah(i.harga * i.qty))}</td></tr>`).join("");
    const contact = [company.address, company.phone].filter(Boolean).map(esc).join(" · ");
    printHtml(`
      <div class="print-sheet">
        <div class="nota-head">
          <div class="nota-co">${esc(company.name)}<small>${contact}</small></div>
          <div class="nota-title">NOTA PESANAN<small>No. ${esc(o.id)}</small></div>
        </div>
        ${o.status === "batal" ? `<p style="font-weight:800; color:#a00; font-size:13px;">PESANAN DIBATALKAN${o.cancelReason ? " — " + esc(o.cancelReason) : ""}</p>` : ""}
        <div class="nota-meta">
          <div><b>Pelanggan</b>: ${esc(o.customer)}</div>
          <div><b>Tanggal pesan</b>: ${esc(fmtFull(o.placedAt))}</div>
          <div><b>Alamat</b>: ${esc(o.addr)}</div>
          <div><b>Status</b>: ${esc(statusLabel[o.status])}${o.deliveredAt ? " (" + esc(fmtDateTime(o.deliveredAt)) + ")" : ""}</div>
          ${o.notes ? `<div style="grid-column:1/3;"><b>Catatan</b>: ${esc(o.notes)}</div>` : ""}
        </div>
        <table>
          <thead><tr><th>No</th><th>Menu</th><th>Varian</th><th class="r">Qty</th><th class="r">Harga</th><th class="r">Subtotal</th></tr></thead>
          <tbody>${rows}<tr class="nota-total"><td colspan="5" class="r">TOTAL</td><td class="r">${esc(rupiah(o.total))}</td></tr></tbody>
        </table>
        <div class="nota-foot">${esc(company.note || "Terima kasih atas kepercayaan Anda. Nota ini dapat digunakan sebagai bukti pemesanan.")}</div>
        <div class="nota-sign"><div>Hormat kami</div><div>Penerima</div></div>
        <p style="font-size:10px; color:#777; margin-top:18px;">Dicetak ${esc(fmtFull(Date.now()))}</p>
      </div>`);
  }

  function printAdminList() {
    const list = filteredOrders().slice().reverse(); // terlama dulu
    const valid = list.filter((o) => o.status !== "batal");
    const filt = [];
    if (adminFilter.status) filt.push("Status: " + (adminFilter.status === "aktif" ? "Masih berjalan" : statusLabel[adminFilter.status]));
    if (adminFilter.q.trim()) filt.push("Pencarian: " + adminFilter.q.trim());
    if (adminFilter.from || adminFilter.to) filt.push(`Tanggal: ${adminFilter.from || "…"} s/d ${adminFilter.to || "…"}`);
    const rows = list.map((o) => `
      <tr class="${o.status === "batal" ? "canceled" : ""}"><td>${esc(o.id)}</td><td>${esc(fmtDateTime(o.placedAt))}</td>
      <td>${esc(o.customer)}<br><span style="color:#666;">${esc(o.addr)}</span></td>
      <td>${o.items.map((i) => esc(itemLabel(i) + " x" + i.qty)).join("<br>")}</td>
      <td>${esc(statusLabel[o.status])}</td><td class="r">${esc(rupiah(o.total))}</td></tr>`).join("");
    printHtml(`
      <div class="print-sheet">
        <h1>Daftar Pesanan — ${esc(company.name)}</h1>
        <p class="psub">Dicetak ${esc(fmtFull(Date.now()))}${filt.length ? " · " + esc(filt.join(" · ")) : ""}</p>
        <table><thead><tr><th>No.</th><th>Tanggal</th><th>Pelanggan</th><th>Menu</th><th>Status</th><th class="r">Total</th></tr></thead>
        <tbody>${rows}<tr class="nota-total"><td colspan="5" class="r">TOTAL ${valid.length} PESANAN (tanpa yang dibatalkan)</td><td class="r">${esc(rupiah(valid.reduce((s, o) => s + o.total, 0)))}</td></tr></tbody></table>
      </div>`);
  }
  $("print-admin-list-btn").addEventListener("click", printAdminList);

  function printRecap(area) {
    const printedAt = fmtDateTime(Date.now());
    // Rekap hanya memuat pesanan yang masih berjalan atau dibuat hari ini (yang dibatalkan tidak ikut).
    const relevant = orders.filter((o) => o.status !== "batal" && (ACTIVE.includes(o.status) || isToday(o.placedAt)));
    document.querySelectorAll(".print-area").forEach((a) => { a.innerHTML = ""; });
    if (area === "dapur") {
      const rows = relevant.slice().sort((a, b) => a.placedAt - b.placedAt).map((o) => `
        <tr>
          <td>${esc(o.id)}</td>
          <td>${esc(o.customer)}<br><span style="color:#666;">${esc(o.addr)}</span></td>
          <td>${o.items.map((i) => esc(itemLabel(i) + " x" + i.qty)).join("<br>")}</td>
          <td>${esc(o.notes || "—")}</td>
          <td>${esc(statusLabel[o.status])}</td>
          <td>${esc(o.pickupLocation || "—")}</td>
        </tr>`).join("");
      $("print-dapur").innerHTML = `<div class="print-sheet"><h1>Rekap Pesanan Dapur</h1><p class="psub">Dicetak pada ${esc(printedAt)}</p>
        <table><thead><tr><th>No.</th><th>Pelanggan</th><th>Menu</th><th>Catatan</th><th>Status</th><th>Lokasi penempatan</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else {
      const rows = relevant.filter((o) => ["siap", "diantar", "selesai"].includes(o.status)).sort((a, b) => a.placedAt - b.placedAt).map((o) => `
        <tr>
          <td>${esc(o.id)}</td>
          <td>${esc(o.customer)}<br><span style="color:#666;">${esc(o.addr)}</span></td>
          <td>${o.items.map((i) => esc(itemLabel(i) + " x" + i.qty)).join("<br>")}</td>
          <td>${esc(o.pickupLocation || "—")}</td>
          <td>${esc(statusLabel[o.status])}</td>
          <td>${esc(o.courier || "—")}</td>
          <td>${esc(o.deliveredAt ? fmtTime(o.deliveredAt) : "—")}</td>
        </tr>`).join("");
      $("print-kurir").innerHTML = `<div class="print-sheet"><h1>Rekap Pengantaran Kurir</h1><p class="psub">Dicetak pada ${esc(printedAt)}</p>
        <table><thead><tr><th>No.</th><th>Pelanggan</th><th>Menu</th><th>Lokasi ambil</th><th>Status</th><th>Kurir</th><th>Jam selesai</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    document.body.classList.add("printing");
    window.print();
  }
  $("print-dapur-btn").addEventListener("click", () => printRecap("dapur"));
  $("print-kurir-btn").addEventListener("click", () => printRecap("kurir"));

  // =====================================================================
  //  DAPUR: tandai siap + lokasi penempatan
  // =====================================================================
  const readyModal = $("ready-modal");
  const readyLocationEl = $("ready-location");
  const confirmReadyBtn = $("confirm-ready");
  let readyOrderId = null;

  function openReadyModal(orderId) {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    readyOrderId = orderId;
    $("ready-order-id").textContent = o.id;
    $("ready-order-cust").textContent = o.customer + " — " + o.addr;
    readyLocationEl.value = "";
    confirmReadyBtn.disabled = true;
    readyModal.hidden = false;
    readyLocationEl.focus();
  }
  function closeReadyModal() { readyModal.hidden = true; readyOrderId = null; }
  $("close-ready-modal").addEventListener("click", closeReadyModal);
  readyModal.addEventListener("click", (e) => { if (e.target === readyModal) closeReadyModal(); });
  readyLocationEl.addEventListener("input", () => { confirmReadyBtn.disabled = !readyLocationEl.value.trim(); });
  confirmReadyBtn.addEventListener("click", async () => {
    const loc = readyLocationEl.value.trim();
    if (!readyOrderId || !loc) return;
    confirmReadyBtn.disabled = true;
    const ok = await updateOrderStatus(readyOrderId, { status: "siap", pickupLocation: loc });
    if (ok) closeReadyModal(); else confirmReadyBtn.disabled = false;
  });

  // =====================================================================
  //  KURIR: selesai diantar + foto bukti
  // =====================================================================
  const deliverModal = $("deliver-modal");
  const deliverTimeEl = $("deliver-time");
  const deliverPhotoBtn = $("deliver-photo-btn");
  const deliverPhotoInput = $("deliver-photo-input");
  const deliverPhotoPreview = $("deliver-photo-preview");
  const confirmDeliverBtn = $("confirm-deliver");
  let deliverOrderId = null;
  let deliverPhotoData = null;

  function openDeliverModal(orderId) {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    deliverOrderId = orderId;
    deliverPhotoData = null;
    $("deliver-order-id").textContent = o.id;
    $("deliver-order-cust").textContent = o.customer + " — " + o.addr;
    deliverTimeEl.textContent = fmtDateTime(Date.now());
    deliverPhotoPreview.classList.remove("show");
    deliverPhotoPreview.src = "";
    deliverPhotoInput.value = "";
    deliverPhotoBtn.textContent = "📷 Ambil foto";
    confirmDeliverBtn.disabled = true;
    deliverModal.hidden = false;
  }
  function closeDeliverModal() { deliverModal.hidden = true; deliverOrderId = null; deliverPhotoData = null; }
  $("close-deliver-modal").addEventListener("click", closeDeliverModal);
  deliverModal.addEventListener("click", (e) => { if (e.target === deliverModal) closeDeliverModal(); });

  deliverPhotoBtn.addEventListener("click", () => deliverPhotoInput.click());
  deliverPhotoInput.addEventListener("change", () => {
    const file = deliverPhotoInput.files && deliverPhotoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Foto kamera HP bisa 3-5 MB. Perkecil dulu (maks 1280px, JPEG ~70%) supaya cepat terkirim dan hemat database.
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        deliverPhotoData = canvas.toDataURL("image/jpeg", 0.7);
        deliverPhotoPreview.src = deliverPhotoData;
        deliverPhotoPreview.classList.add("show");
        deliverPhotoBtn.textContent = "📷 Ganti foto";
        deliverTimeEl.textContent = fmtDateTime(Date.now());
        confirmDeliverBtn.disabled = false;
      };
      img.onerror = () => toast("Foto tidak bisa dibaca", "Coba ambil foto lagi dengan kamera biasa.", "err");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  confirmDeliverBtn.addEventListener("click", async () => {
    if (!deliverOrderId || !deliverPhotoData) return;
    confirmDeliverBtn.disabled = true;
    const ok = await updateOrderStatus(deliverOrderId, { status: "selesai", proofPhoto: deliverPhotoData, courier: currentUser.name });
    if (ok) closeDeliverModal(); else confirmDeliverBtn.disabled = false;
  });

  // =====================================================================
  //  Ganti password (semua peran)
  // =====================================================================
  const passwordModal = $("password-modal");
  const pwOldEl = $("pw-old");
  const pwNewEl = $("pw-new");
  const pwConfirmEl = $("pw-confirm");
  const passwordMsgEl = $("password-msg");

  function openPasswordModal() {
    pwOldEl.value = ""; pwNewEl.value = ""; pwConfirmEl.value = "";
    passwordMsgEl.classList.remove("show");
    passwordModal.hidden = false;
    pwOldEl.focus();
  }
  function closePasswordModal() { passwordModal.hidden = true; }
  $("open-password-modal").addEventListener("click", openPasswordModal);
  $("close-password-modal").addEventListener("click", closePasswordModal);
  passwordModal.addEventListener("click", (e) => { if (e.target === passwordModal) closePasswordModal(); });

  $("confirm-password").addEventListener("click", async () => {
    if (pwNewEl.value !== pwConfirmEl.value) {
      passwordMsgEl.className = "msg err show";
      passwordMsgEl.textContent = "Konfirmasi password baru tidak cocok.";
      return;
    }
    try {
      await api("POST", "/api/auth/me/password", { oldPassword: pwOldEl.value, newPassword: pwNewEl.value });
      passwordMsgEl.className = "msg ok show";
      passwordMsgEl.textContent = "Password berhasil diganti.";
      setTimeout(closePasswordModal, 1100);
    } catch (e) {
      passwordMsgEl.className = "msg err show";
      passwordMsgEl.textContent = e.message;
    }
  });

  // =====================================================================
  //  ADMIN: kelola akun (tambah, ganti password, hapus)
  // =====================================================================
  const accountsModal = $("accounts-modal");
  const accountsListEl = $("accounts-list");

  async function renderAccountsList() {
    const { accounts } = await api("GET", "/api/accounts");
    accountsListEl.innerHTML = accounts.map((a) => `
      <div class="account-row" data-username="${esc(a.username)}">
        <div class="account-row-head">
          <div class="account-row-avatar who-avatar ${esc(a.role)}">${esc(roleIcon[a.role])}</div>
          <div style="flex:1;">
            <div class="account-row-name">${esc(a.name)} <span style="color:var(--muted); font-weight:500;">· ${esc(roleLabel[a.role])}${a.username === currentUser.username ? " · akun kamu" : ""}</span></div>
            <div class="account-row-user">${esc(a.username)}</div>
          </div>
          ${a.username === currentUser.username ? "" : `<button type="button" class="account-row-del">Hapus</button>`}
        </div>
        <div class="account-row-form">
          <input type="text" class="acc-new-pw" placeholder="Password baru (min. 6 karakter)">
          <button type="button" class="account-row-save">Simpan</button>
        </div>
        <div class="account-row-status"></div>
      </div>`).join("");
  }

  accountsListEl.addEventListener("click", async (e) => {
    const row = e.target.closest(".account-row");
    if (!row) return;
    const username = row.dataset.username;
    const status = row.querySelector(".account-row-status");
    if (e.target.closest(".account-row-save")) {
      const input = row.querySelector(".acc-new-pw");
      const val = input.value.trim();
      if (val.length < 6) { status.className = "account-row-status err"; status.textContent = "Minimal 6 karakter."; return; }
      try {
        await api("PATCH", `/api/accounts/${encodeURIComponent(username)}/password`, { password: val });
        input.value = "";
        status.className = "account-row-status ok"; status.textContent = "Password berhasil diperbarui.";
      } catch (err) { status.className = "account-row-status err"; status.textContent = err.message; }
    }
    if (e.target.closest(".account-row-del")) {
      if (!confirm(`Hapus akun "${username}"? Akun ini tidak bisa login lagi. Riwayat pesanan tetap tersimpan.`)) return;
      try {
        await api("DELETE", `/api/accounts/${encodeURIComponent(username)}`);
        await renderAccountsList();
      } catch (err) { status.className = "account-row-status err"; status.textContent = err.message; }
    }
  });

  $("acc-add-btn").addEventListener("click", async () => {
    const msg = $("acc-add-msg");
    const body = {
      name: $("acc-new-name").value.trim(),
      username: $("acc-new-username").value.trim(),
      role: $("acc-new-role").value,
      password: $("acc-new-pass").value
    };
    if (!body.name || !body.username || !body.password) { msg.className = "form-msg err"; msg.textContent = "Nama lengkap, nama pengguna, dan password wajib diisi."; return; }
    try {
      await api("POST", "/api/accounts", body);
      msg.className = "form-msg ok"; msg.textContent = `Akun ${body.username.toLowerCase()} berhasil dibuat. Berikan nama pengguna dan password ini ke orangnya.`;
      ["acc-new-name", "acc-new-username", "acc-new-pass"].forEach((id) => { $(id).value = ""; });
      await renderAccountsList();
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  });

  function openAccountsModal() { $("acc-add-msg").textContent = ""; renderAccountsList().catch(showError); accountsModal.hidden = false; }
  function closeAccountsModal() { accountsModal.hidden = true; }
  $("open-accounts-modal").addEventListener("click", openAccountsModal);
  $("close-accounts-modal").addEventListener("click", closeAccountsModal);
  accountsModal.addEventListener("click", (e) => { if (e.target === accountsModal) closeAccountsModal(); });

  // =====================================================================
  //  ADMIN: kelola menu & harga
  // =====================================================================
  const menuAdminModal = $("menu-admin-modal");
  let maEditId = null;

  function maRender() {
    const q = $("ma-search").value.trim().toLowerCase();
    const cat = $("ma-category").value;
    const list = allMenu.filter((it) => {
      if (cat && it.kategori !== cat) return false;
      if (q && !(it.nama.toLowerCase().includes(q) || it.kategori.toLowerCase().includes(q) || (it.komposisi || "").toLowerCase().includes(q))) return false;
      return true;
    });
    $("ma-count").textContent = `${list.length} menu` + (allMenu.some((m) => !m.aktif) ? ` · ${allMenu.filter((m) => !m.aktif).length} nonaktif` : "");
    let html = "", last = null;
    list.forEach((it) => {
      if (it.kategori !== last) { html += `<div class="menu-cat-head">${esc(it.kategori)}</div>`; last = it.kategori; }
      html += `
        <div class="menu-admin-row ${it.aktif ? "" : "off"} ${it.id === maEditId ? "active-edit" : ""}" data-id="${it.id}" style="cursor:pointer;">
          <div class="menu-row-info">
            <div class="menu-row-name">${esc(it.nama)} ${it.aktif ? "" : '<span class="tag">nonaktif</span>'} ${it.komposisi ? "" : '<span class="tag edit">belum ada komposisi</span>'}</div>
            <div class="menu-row-sub">${esc([vlabel(it.varian), it.jumlah ? it.jumlah + " " + it.satuan : ""].filter(Boolean).join(" · "))}</div>
          </div>
          <div class="menu-row-price mono">${esc(rupiah(it.harga))}</div>
          <button type="button" class="btn-sm">Ubah</button>
        </div>`;
    });
    $("ma-list").innerHTML = html || '<div class="menu-empty">Tidak ada menu yang cocok.</div>';
    const cats = Array.from(new Set(allMenu.map((m) => m.kategori)));
    const current = $("ma-category").value;
    $("ma-category").innerHTML = '<option value="">Semua kategori</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    $("ma-category").value = cats.includes(current) ? current : "";
    $("ma-kategori-list").innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join("");
  }

  function maHargaHint() {
    const n = parseInt($("ma-harga").value.replace(/\D/g, ""), 10);
    $("ma-harga-hint").textContent = Number.isFinite(n) ? rupiah(n) : "";
  }
  $("ma-harga").addEventListener("input", maHargaHint);

  function maLoadForm(it) {
    maEditId = it ? it.id : null;
    $("ma-form-title").textContent = it ? "Ubah menu" : "Menu baru";
    $("ma-nama").value = it ? it.nama : "";
    $("ma-harga").value = it ? String(it.harga) : "";
    $("ma-varian").value = it ? it.varian : "Paket";
    $("ma-kategori").value = it ? it.kategori : "";
    $("ma-jumlah").value = it ? it.jumlah : "";
    $("ma-satuan").value = it ? it.satuan : "";
    $("ma-komposisi").value = it ? it.komposisi : "";
    $("ma-toggle").hidden = !it;
    $("ma-delete").hidden = !it;
    if (it) $("ma-toggle").textContent = it.aktif ? "Nonaktifkan (sembunyikan dari pesanan)" : "Aktifkan kembali";
    $("ma-msg").textContent = ""; $("ma-msg").className = "form-msg";
    maHargaHint();
    maRender();
  }

  function maSyncAfterChange() {
    menuItems = allMenu.filter((i) => i.aktif);
    populateMenuCategories();
    maRender();
  }

  $("ma-list").addEventListener("click", (e) => {
    const row = e.target.closest(".menu-admin-row");
    if (!row) return;
    const it = allMenu.find((m) => String(m.id) === row.dataset.id);
    if (it) maLoadForm(it);
  });
  $("ma-new").addEventListener("click", () => maLoadForm(null));
  $("ma-search").addEventListener("input", maRender);
  $("ma-category").addEventListener("change", maRender);

  $("ma-save").addEventListener("click", async () => {
    const msg = $("ma-msg");
    const body = {
      nama: $("ma-nama").value.trim(),
      harga: parseInt($("ma-harga").value.replace(/\D/g, ""), 10),
      varian: $("ma-varian").value.trim() || "Paket",
      kategori: $("ma-kategori").value.trim() || "Menu Lainnya",
      jumlah: $("ma-jumlah").value.trim(),
      satuan: $("ma-satuan").value.trim(),
      komposisi: $("ma-komposisi").value.trim()
    };
    if (!body.nama) { msg.className = "form-msg err"; msg.textContent = "Nama menu wajib diisi."; return; }
    if (!Number.isFinite(body.harga)) { msg.className = "form-msg err"; msg.textContent = "Harga wajib diisi dengan angka."; return; }
    try {
      let item;
      if (maEditId) ({ item } = await api("PUT", `/api/menu/${maEditId}`, body));
      else ({ item } = await api("POST", "/api/menu", body));
      const idx = allMenu.findIndex((m) => m.id === item.id);
      if (idx >= 0) allMenu[idx] = item; else allMenu.push(item);
      allMenu.sort((a, b) => a.kategori.localeCompare(b.kategori) || a.nama.localeCompare(b.nama) || a.varian.localeCompare(b.varian));
      maSyncAfterChange();
      maLoadForm(item);
      msg.className = "form-msg ok"; msg.textContent = "Menu tersimpan. Berlaku untuk pesanan baru.";
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  });

  $("ma-toggle").addEventListener("click", async () => {
    const it = allMenu.find((m) => m.id === maEditId);
    if (!it) return;
    try {
      const { item } = await api("PATCH", `/api/menu/${it.id}/aktif`, { aktif: !it.aktif });
      allMenu[allMenu.findIndex((m) => m.id === item.id)] = item;
      maSyncAfterChange();
      maLoadForm(item);
    } catch (err) { $("ma-msg").className = "form-msg err"; $("ma-msg").textContent = err.message; }
  });

  $("ma-delete").addEventListener("click", async () => {
    const it = allMenu.find((m) => m.id === maEditId);
    if (!it) return;
    if (!confirm(`Hapus menu "${it.nama} (${it.varian})" dari katalog? Pesanan lama yang memakai menu ini tidak terpengaruh.\n\nKalau hanya ingin menyembunyikan sementara, pilih Nonaktifkan.`)) return;
    try {
      await api("DELETE", `/api/menu/${it.id}`);
      allMenu = allMenu.filter((m) => m.id !== it.id);
      maSyncAfterChange();
      maLoadForm(null);
    } catch (err) { $("ma-msg").className = "form-msg err"; $("ma-msg").textContent = err.message; }
  });

  async function openMenuAdminModal() {
    menuAdminModal.hidden = false;
    try { await loadMenu(); } catch (e) { showError(e); }
    $("ma-search").value = "";
    maLoadForm(null);
  }
  $("open-menu-admin-modal").addEventListener("click", openMenuAdminModal);
  $("close-menu-admin-modal").addEventListener("click", () => { menuAdminModal.hidden = true; });
  menuAdminModal.addEventListener("click", (e) => { if (e.target === menuAdminModal) menuAdminModal.hidden = true; });

  // =====================================================================
  //  ADMIN: laporan
  // =====================================================================
  const reportModal = $("report-modal");
  let reportData = null;

  function setReportRange(kind) {
    const now = new Date();
    let from = new Date(now), to = new Date(now);
    if (kind === "7") from.setDate(from.getDate() - 6);
    else if (kind === "30") from.setDate(from.getDate() - 29);
    else if (kind === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (kind === "lastmonth") { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
    $("rp-from").value = ymdLocal(from);
    $("rp-to").value = ymdLocal(to);
    $("rp-group").value = kind === "month" || kind === "lastmonth" || kind === "30" ? ($("rp-group").value === "month" ? "month" : "day") : "day";
  }
  const reportQuery = () => `from=${encodeURIComponent($("rp-from").value)}&to=${encodeURIComponent($("rp-to").value)}&group=${encodeURIComponent($("rp-group").value)}`;
  const GROUP_LABEL = { day: "per hari", week: "per minggu", month: "per bulan" };

  function reportTables(r, forPrint) {
    const s = r.summary;
    const cls = forPrint ? "" : ' class="rep"';
    const periods = r.periods.map((p) => `<tr><td>${esc(p.label)}</td><td class="r">${p.orders}</td><td class="r">${esc(rupiah(p.revenue))}</td><td class="r">${p.cancelled}</td></tr>`).join("");
    const menus = r.menus.length ? r.menus.map((m, i) => `
      <tr><td class="r">${i + 1}</td><td><b>${esc(m.nama)}</b><br><span style="color:var(--muted)">${esc(m.varian)}</span></td>
      <td class="r">${m.qty}</td><td class="r">${esc(rupiah(m.revenue))}</td>
      <td class="${forPrint ? "komp" : "multiline"}">${esc(m.komposisi || "Belum ada detail komposisi")}</td></tr>`).join("")
      : `<tr><td colspan="5" style="text-align:center;color:var(--muted)">Belum ada pesanan pada periode ini.</td></tr>`;
    return `
      <div class="${forPrint ? "" : "rep-h"}" ${forPrint ? 'style="margin:6px 0 4px;font-weight:700;"' : ""}>Penjualan ${esc(GROUP_LABEL[r.range.group])}</div>
      <table${cls}><thead><tr><th>Periode</th><th class="r">Pesanan</th><th class="r">Omzet</th><th class="r">Dibatalkan</th></tr></thead>
        <tbody>${periods}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="r">${s.orderCount}</td><td class="r">${esc(rupiah(s.revenue))}</td><td class="r">${s.cancelledCount}</td></tr></tfoot></table>
      <div class="${forPrint ? "" : "rep-h"}" ${forPrint ? 'style="margin:14px 0 4px;font-weight:700;"' : ""}>Rekap menu dan komposisi bahan</div>
      <p class="${forPrint ? "" : "rep-note"}" ${forPrint ? 'style="font-size:10.5px;color:#555;margin:0 0 6px;"' : ""}>Komposisi adalah bahan untuk 1 paket. Kebutuhan total = komposisi × jumlah dipesan.</p>
      <table${cls}><thead><tr><th class="r">No</th><th>Menu</th><th class="r">Jumlah</th><th class="r">Omzet</th><th>Komposisi / bahan per 1 paket</th></tr></thead><tbody>${menus}</tbody></table>`;
  }

  function renderReport(r) {
    const s = r.summary;
    $("rp-result").innerHTML = `
      <div class="report-kpis">
        <div class="kpi"><div class="label">Pesanan</div><div class="value">${s.orderCount}</div><div class="sub">${s.deliveredCount} selesai · ${s.activeCount} berjalan</div></div>
        <div class="kpi"><div class="label">Omzet</div><div class="value">${esc(rupiah(s.revenue))}</div><div class="sub">tanpa pesanan batal</div></div>
        <div class="kpi"><div class="label">Rata-rata / pesanan</div><div class="value">${esc(rupiah(s.avgOrder))}</div><div class="sub">${s.itemCount} paket dipesan</div></div>
        <div class="kpi"><div class="label">Dibatalkan</div><div class="value">${s.cancelledCount}</div><div class="sub">${esc(rupiah(s.cancelledValue))}</div></div>
      </div>
      <p class="rep-note">Dihitung berdasarkan tanggal pesanan dibuat. Unduh Excel/Word untuk daftar pesanan lengkap.</p>
      ${reportTables(r, false)}`;
  }

  async function loadReport() {
    const msg = $("rp-msg");
    msg.textContent = "";
    ["rp-xlsx", "rp-docx", "rp-print"].forEach((id) => { $(id).disabled = true; });
    if (!$("rp-from").value || !$("rp-to").value) { msg.textContent = "Isi tanggal mulai dan tanggal akhir."; return; }
    $("rp-result").innerHTML = '<div class="menu-empty">Memuat laporan…</div>';
    try {
      const { report, company: co } = await api("GET", "/api/reports?" + reportQuery());
      reportData = report;
      if (co) company = Object.assign(company, co);
      renderReport(report);
      ["rp-xlsx", "rp-docx", "rp-print"].forEach((id) => { $(id).disabled = false; });
    } catch (e) {
      $("rp-result").innerHTML = "";
      msg.textContent = e.message;
    }
  }

  async function downloadReport(fmt, btn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Menyiapkan…";
    try {
      const res = await fetch(`/api/reports/export?format=${fmt}&${reportQuery()}`, { credentials: "same-origin" });
      if (!res.ok) {
        let m = "Gagal membuat file laporan.";
        try { m = (await res.json()).error || m; } catch (e) { /* abaikan */ }
        throw new Error(m);
      }
      const blob = await res.blob();
      const name = (/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "") || [])[1] || `laporan.${fmt}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { showError(e); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  function printReport() {
    if (!reportData) return;
    const r = reportData, s = r.summary;
    const rows = r.orders.map((o) => `
      <tr class="${o.status === "batal" ? "canceled" : ""}"><td>${esc(o.id)}</td><td>${esc(o.date)}</td><td>${esc(o.customer)}</td>
      <td>${esc(o.itemsText).replace(/\n/g, "<br>")}</td><td>${esc(statusLabel[o.status])}</td><td class="r">${esc(rupiah(o.total))}</td></tr>`).join("");
    printHtml(`
      <div class="print-sheet">
        <h1>Laporan Pesanan — ${esc(company.name)}</h1>
        <p class="psub">Periode ${esc(r.range.from)} s/d ${esc(r.range.to)} · ${esc(GROUP_LABEL[r.range.group])} · dicetak ${esc(fmtFull(Date.now()))}</p>
        <table><tbody>
          <tr><td>Jumlah pesanan (tanpa batal)</td><td class="r">${s.orderCount}</td><td>Total omzet</td><td class="r">${esc(rupiah(s.revenue))}</td></tr>
          <tr><td>Selesai diantar</td><td class="r">${s.deliveredCount}</td><td>Rata-rata per pesanan</td><td class="r">${esc(rupiah(s.avgOrder))}</td></tr>
          <tr><td>Dibatalkan</td><td class="r">${s.cancelledCount}</td><td>Nilai dibatalkan</td><td class="r">${esc(rupiah(s.cancelledValue))}</td></tr>
        </tbody></table>
        ${reportTables(r, true)}
        <div class="h3p"><b>Daftar pesanan</b></div>
        <table><thead><tr><th>No.</th><th>Tanggal</th><th>Pelanggan</th><th>Menu</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Belum ada pesanan.</td></tr>'}</tbody></table>
      </div>`);
  }

  $("open-report-modal").addEventListener("click", () => {
    reportModal.hidden = false;
    if (!$("rp-from").value) { setReportRange("7"); loadReport(); }
  });
  $("close-report-modal").addEventListener("click", () => { reportModal.hidden = true; });
  reportModal.addEventListener("click", (e) => { if (e.target === reportModal) reportModal.hidden = true; });
  reportModal.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    const kind = b.dataset.range;
    setReportRange(kind);
    if (kind === "month" || kind === "lastmonth") $("rp-group").value = "week";
    loadReport();
  }));
  $("rp-show").addEventListener("click", loadReport);
  $("rp-xlsx").addEventListener("click", (e) => downloadReport("xlsx", e.currentTarget));
  $("rp-docx").addEventListener("click", (e) => downloadReport("docx", e.currentTarget));
  $("rp-print").addEventListener("click", printReport);

  // =====================================================================
  //  Mulai
  // =====================================================================
  (async function boot() {
    try {
      const { user } = await api("GET", "/api/auth/me");
      showApp(user);
    } catch (e) {
      showLogin();
    }
  })();
})();
