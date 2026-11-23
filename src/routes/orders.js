const express = require("express");
const { pool, findMenu, findMenuById, nextOrderId } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { normalizeRequestedItems, sumTotal } = require("../orderItems");
const { ORDER_COLS, attachItems, fetchOrder } = require("../orderStore");

const router = express.Router();

const VALID_STATUSES = ["baru", "dimasak", "siap", "diantar", "selesai"];
// Urutan tahap yang sah, dipakai untuk memvalidasi transisi status. "batal" tidak ada di sini
// karena pembatalan punya jalur sendiri (POST /:id/cancel, hanya Admin).
const NEXT_STATUS = { baru: "dimasak", dimasak: "siap", siap: "diantar", diantar: "selesai" };
const ACTIVE_STATUSES = ["baru", "dimasak", "siap", "diantar"];
const DEFAULT_WINDOW_DAYS = 90;
const MAX_PHOTO_CHARS = 7 * 1000 * 1000; // ~5 MB foto setelah base64

async function resolveMenu(it) {
  let menu = null;
  if (it.menuId) menu = await findMenuById(it.menuId);
  if (!menu && it.nama) menu = await findMenu(it.nama, it.varian || "");
  return menu;
}

// GET /api/orders
// Tanpa parameter: pesanan 90 hari terakhir + semua yang masih berjalan.
// Dengan ?from=<ms>&to=<ms>: pesanan yang dibuat pada rentang itu (to tidak ikut).
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let rows;
    if (req.query.from !== undefined && req.query.to !== undefined) {
      const from = Number(req.query.from);
      const to = Number(req.query.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return res.status(400).json({ error: "Rentang tanggal tidak valid." });
      }
      [rows] = await pool.query(
        `SELECT ${ORDER_COLS} FROM orders WHERE placed_at >= ? AND placed_at < ? ORDER BY placed_at DESC LIMIT 5000`,
        [from, to]
      );
    } else {
      const since = Date.now() - DEFAULT_WINDOW_DAYS * 86400000;
      [rows] = await pool.query(
        `SELECT ${ORDER_COLS} FROM orders WHERE placed_at >= ? OR status IN (?) ORDER BY placed_at DESC LIMIT 5000`,
        [since, ACTIVE_STATUSES]
      );
    }
    res.json({ orders: await attachItems(rows) });
  } catch (e) { next(e); }
});

// GET /api/orders/:id/photo — foto bukti pengantaran sebagai gambar.
router.get("/:id/photo", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT proof_photo FROM orders WHERE id = ?", [req.params.id]);
    const data = rows[0] && rows[0].proof_photo;
    if (!data) return res.status(404).json({ error: "Foto tidak ada." });
    const marker = data.indexOf(";base64,");
    if (!data.startsWith("data:image/") || marker < 0) return res.status(404).json({ error: "Foto tidak valid." });
    const mime = data.slice(5, marker).toLowerCase();
    const type = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ? mime : "image/jpeg";
    res.set("Content-Type", type);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(data.slice(marker + 8), "base64"));
  } catch (e) { next(e); }
});

// POST /api/orders — buat pesanan baru, hanya Admin
router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { customer, addr, notes, items } = req.body || {};
    if (!customer || !String(customer).trim()) {
      return res.status(400).json({ error: "Nama pelanggan dan minimal satu menu wajib diisi." });
    }
    const norm = normalizeRequestedItems(items);
    if (norm.error) return res.status(400).json({ error: norm.error });

    const resolved = [];
    for (const it of norm.items) {
      const menu = await resolveMenu(it);
      if (!menu) {
        return res.status(400).json({ error: `Menu "${it.nama || it.menuId}" tidak ditemukan atau sudah dinonaktifkan.` });
      }
      resolved.push({
        nama: menu.nama, varian: menu.varian, qty: it.qty,
        harga: menu.harga, satuan: menu.satuan, komposisi: menu.komposisi
      });
    }
    const total = sumTotal(resolved);
    const id = await nextOrderId();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO orders (id, customer, addr, notes, status, placed_at, total)
         VALUES (?, ?, ?, ?, 'baru', ?, ?)`,
        [id, String(customer).trim(), String(addr || "").trim() || "Alamat menyusul dikonfirmasi", String(notes || "").trim(), Date.now(), total]
      );
      for (const it of resolved) {
        await conn.query(
          `INSERT INTO order_items (order_id, nama, varian, qty, harga, satuan, komposisi) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, it.nama, it.varian, it.qty, it.harga, it.satuan, it.komposisi]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.status(201).json({ order: await fetchOrder(id) });
  } catch (e) { next(e); }
});

// PUT /api/orders/:id — Admin mengubah pesanan.
//  - Nama, alamat, catatan: bisa diubah selama pesanan belum Selesai/Batal.
//  - Daftar menu: hanya selagi pesanan masih Baru atau Dimasak (kalau sudah siap, makanannya sudah jadi).
// Menu yang sudah ada di pesanan mempertahankan harganya saat dipesan; menu baru memakai harga katalog sekarang.
router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT id, status FROM orders WHERE id = ?", [req.params.id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
    if (order.status === "selesai" || order.status === "batal") {
      return res.status(409).json({ error: `Pesanan berstatus "${order.status}" dan tidak bisa diubah lagi.` });
    }

    const { customer, addr, notes, items } = req.body || {};
    if (!customer || !String(customer).trim()) {
      return res.status(400).json({ error: "Nama pelanggan wajib diisi." });
    }

    let resolved = null;
    if (items !== undefined) {
      if (order.status !== "baru" && order.status !== "dimasak") {
        return res.status(409).json({ error: "Menu hanya bisa diubah selagi pesanan masih Baru atau Dimasak." });
      }
      const norm = normalizeRequestedItems(items);
      if (norm.error) return res.status(400).json({ error: norm.error });

      const [oldItems] = await pool.query(
        "SELECT nama, varian, harga, satuan, komposisi FROM order_items WHERE order_id = ?", [order.id]
      );
      const snapshots = new Map(oldItems.map((o) => [o.nama.toLowerCase() + "|" + (o.varian || "").toLowerCase(), o]));

      resolved = [];
      for (const it of norm.items) {
        const snap = it.nama ? snapshots.get(it.nama.toLowerCase() + "|" + it.varian.toLowerCase()) : null;
        if (snap) {
          resolved.push({ nama: snap.nama, varian: snap.varian, qty: it.qty, harga: snap.harga, satuan: snap.satuan, komposisi: snap.komposisi });
          continue;
        }
        const menu = await resolveMenu(it);
        if (!menu) {
          return res.status(400).json({ error: `Menu "${it.nama || it.menuId}" tidak ditemukan atau sudah dinonaktifkan.` });
        }
        resolved.push({ nama: menu.nama, varian: menu.varian, qty: it.qty, harga: menu.harga, satuan: menu.satuan, komposisi: menu.komposisi });
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Kunci baris dan cek ulang status, supaya tidak bentrok kalau dapur/kurir baru saja memindahkannya.
      const [locked] = await conn.query("SELECT status FROM orders WHERE id = ? FOR UPDATE", [order.id]);
      const st = locked[0].status;
      if (st === "selesai" || st === "batal" || (resolved && st !== "baru" && st !== "dimasak")) {
        await conn.rollback();
        return res.status(409).json({ error: "Status pesanan baru saja berubah, muat ulang lalu coba lagi." });
      }
      const sets = ["customer = ?", "addr = ?", "notes = ?", "edited_at = ?"];
      const params = [
        String(customer).trim(),
        String(addr || "").trim() || "Alamat menyusul dikonfirmasi",
        String(notes || "").trim(),
        Date.now()
      ];
      if (resolved) {
        sets.push("total = ?");
        params.push(sumTotal(resolved));
      }
      params.push(order.id);
      await conn.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, params);
      if (resolved) {
        await conn.query("DELETE FROM order_items WHERE order_id = ?", [order.id]);
        for (const it of resolved) {
          await conn.query(
            `INSERT INTO order_items (order_id, nama, varian, qty, harga, satuan, komposisi) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [order.id, it.nama, it.varian, it.qty, it.harga, it.satuan, it.komposisi]
          );
        }
      }
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch (e2) { /* sudah ditutup */ }
      throw e;
    } finally {
      conn.release();
    }

    res.json({ order: await fetchOrder(order.id) });
  } catch (e) { next(e); }
});

// POST /api/orders/:id/cancel — Admin membatalkan pesanan (alasan wajib; data tetap tersimpan sebagai riwayat).
router.post("/:id/cancel", requireRole("admin"), async (req, res, next) => {
  try {
    const reason = String((req.body && req.body.reason) || "").trim();
    if (reason.length < 3) return res.status(400).json({ error: "Tulis alasan pembatalan (minimal 3 huruf)." });
    if (reason.length > 255) return res.status(400).json({ error: "Alasan maksimal 255 karakter." });

    const [result] = await pool.query(
      "UPDATE orders SET status = 'batal', cancel_reason = ?, cancelled_at = ? WHERE id = ? AND status NOT IN ('selesai','batal')",
      [reason, Date.now(), req.params.id]
    );
    if (!result.affectedRows) {
      const [rows] = await pool.query("SELECT status FROM orders WHERE id = ?", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
      return res.status(409).json({ error: `Pesanan berstatus "${rows[0].status}" sehingga tidak bisa dibatalkan.` });
    }
    res.json({ order: await fetchOrder(req.params.id) });
  } catch (e) { next(e); }
});

// PATCH /api/orders/:id/status — pindah tahap pesanan.
// Dapur: baru -> dimasak, dimasak -> siap (+ pickupLocation).
// Kurir: siap -> diantar (+ courier), diantar -> selesai (+ courier, proofPhoto).
router.patch("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT id, status, courier FROM orders WHERE id = ?", [req.params.id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });

    const { status, pickupLocation, courier: courierFromBody, proofPhoto } = req.body || {};
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Status tidak valid." });
    }
    if (NEXT_STATUS[order.status] !== status) {
      return res.status(409).json({ error: `Pesanan berstatus "${order.status}", tidak bisa langsung ke "${status}".` });
    }

    const role = req.session.user.role;
    if ((status === "dimasak" || status === "siap") && role !== "dapur" && role !== "admin") {
      return res.status(403).json({ error: "Hanya tim dapur yang bisa mengubah status ini." });
    }
    if ((status === "diantar" || status === "selesai") && role !== "kurir" && role !== "admin") {
      return res.status(403).json({ error: "Hanya kurir yang bisa mengubah status ini." });
    }

    // Nama kurir selalu dari akun yang login (bukan dari kiriman browser), supaya dengan beberapa
    // akun kurir tiap pengantaran tercatat atas nama kurir yang benar. Admin boleh mengisi manual.
    const courier = role === "kurir" ? req.session.user.name : (courierFromBody || req.session.user.name);
    // Pesanan yang sedang diantar hanya boleh diselesaikan kurir yang mengambilnya (atau admin).
    if (status === "selesai" && role === "kurir" && order.courier && order.courier !== req.session.user.name) {
      return res.status(403).json({ error: `Pesanan ini sedang diantar oleh ${order.courier}.` });
    }

    const sets = ["status = ?"];
    const params = [status];

    if (status === "siap") {
      if (!pickupLocation || !String(pickupLocation).trim()) {
        return res.status(400).json({ error: "Lokasi penempatan pesanan wajib diisi." });
      }
      sets.push("pickup_location = ?", "ready_at = ?");
      params.push(String(pickupLocation).trim().slice(0, 255), Date.now());
    }
    if (status === "diantar") {
      sets.push("courier = ?");
      params.push(courier || req.session.user.name);
    }
    if (status === "selesai") {
      if (!proofPhoto) {
        return res.status(400).json({ error: "Foto bukti pengantaran wajib dilampirkan." });
      }
      if (typeof proofPhoto !== "string" || !proofPhoto.startsWith("data:image/") || proofPhoto.length > MAX_PHOTO_CHARS) {
        return res.status(400).json({ error: "Foto bukti tidak valid atau terlalu besar." });
      }
      sets.push("courier = ?", "delivered_at = ?", "proof_photo = ?");
      params.push(courier || req.session.user.name, Date.now(), proofPhoto);
    }

    // "AND status = ?" mencegah dua perangkat (mis. dua kurir) memproses pesanan yang sama bersamaan.
    params.push(order.id, order.status);
    const [result] = await pool.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = ? AND status = ?`, params);
    if (!result.affectedRows) {
      return res.status(409).json({ error: "Pesanan ini baru saja diproses oleh perangkat lain. Layar akan diperbarui." });
    }

    res.json({ order: await fetchOrder(order.id) });
  } catch (e) { next(e); }
});

module.exports = router;
