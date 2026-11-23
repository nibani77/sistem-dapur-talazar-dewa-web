const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const COLUMNS = "id, nama, varian, kategori, harga, jumlah, satuan, komposisi, aktif";

function toItem(r) {
  return {
    id: r.id, nama: r.nama, varian: r.varian, kategori: r.kategori, harga: r.harga,
    jumlah: r.jumlah, satuan: r.satuan, komposisi: r.komposisi || "", aktif: !!r.aktif
  };
}

// Validasi isian menu dari admin. Mengembalikan { error } atau { value }.
function parseMenuBody(body) {
  const b = body || {};
  const nama = String(b.nama || "").trim();
  const varian = String(b.varian === undefined || b.varian === null ? "Paket" : b.varian).trim() || "Paket";
  const kategori = String(b.kategori || "").trim() || "Menu Lainnya";
  const hargaNum = Number(b.harga);
  if (!nama) return { error: "Nama menu wajib diisi." };
  if (nama.length > 200) return { error: "Nama menu maksimal 200 karakter." };
  if (varian.length > 100) return { error: "Varian maksimal 100 karakter." };
  if (kategori.length > 100) return { error: "Kategori maksimal 100 karakter." };
  if (!Number.isFinite(hargaNum) || hargaNum < 0 || hargaNum > 2000000000) {
    return { error: "Harga harus berupa angka (rupiah) dan tidak boleh negatif." };
  }
  const jumlah = String(b.jumlah || "").trim().slice(0, 50);
  const satuan = String(b.satuan || "").trim().slice(0, 50);
  const komposisi = String(b.komposisi || "").trim().slice(0, 5000);
  return { value: { nama, varian, kategori, harga: Math.round(hargaNum), jumlah, satuan, komposisi } };
}

// Admin melihat semua menu (termasuk yang nonaktif); peran lain hanya yang aktif.
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const all = req.session.user.role === "admin";
    const [rows] = await pool.query(
      `SELECT ${COLUMNS} FROM menu_items ${all ? "" : "WHERE aktif = 1"} ORDER BY kategori, nama, varian`
    );
    res.json({ items: rows.map(toItem) });
  } catch (e) { next(e); }
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const parsed = parseMenuBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const m = parsed.value;
    const [dup] = await pool.query("SELECT id FROM menu_items WHERE nama = ? AND varian = ? LIMIT 1", [m.nama, m.varian]);
    if (dup.length) {
      return res.status(409).json({ error: `Menu "${m.nama}" dengan varian "${m.varian}" sudah ada.` });
    }
    const [result] = await pool.query(
      "INSERT INTO menu_items (kategori, nama, varian, harga, jumlah, satuan, komposisi, aktif) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [m.kategori, m.nama, m.varian, m.harga, m.jumlah, m.satuan, m.komposisi]
    );
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM menu_items WHERE id = ?`, [result.insertId]);
    res.status(201).json({ item: toItem(rows[0]) });
  } catch (e) { next(e); }
});

// Mengubah menu/harga hanya berlaku untuk pesanan BARU. Pesanan lama menyimpan salinan
// harga dan komposisi saat dibuat, jadi nota dan laporan lama tidak berubah.
router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [existing] = await pool.query("SELECT id FROM menu_items WHERE id = ?", [id]);
    if (!existing.length) return res.status(404).json({ error: "Menu tidak ditemukan." });
    const parsed = parseMenuBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const m = parsed.value;
    const [dup] = await pool.query(
      "SELECT id FROM menu_items WHERE nama = ? AND varian = ? AND id <> ? LIMIT 1",
      [m.nama, m.varian, id]
    );
    if (dup.length) {
      return res.status(409).json({ error: `Menu "${m.nama}" dengan varian "${m.varian}" sudah ada.` });
    }
    await pool.query(
      "UPDATE menu_items SET kategori = ?, nama = ?, varian = ?, harga = ?, jumlah = ?, satuan = ?, komposisi = ? WHERE id = ?",
      [m.kategori, m.nama, m.varian, m.harga, m.jumlah, m.satuan, m.komposisi, id]
    );
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM menu_items WHERE id = ?`, [id]);
    res.json({ item: toItem(rows[0]) });
  } catch (e) { next(e); }
});

// Aktifkan / nonaktifkan menu (menu nonaktif tidak muncul saat membuat pesanan).
router.patch("/:id/aktif", requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const aktif = req.body && req.body.aktif ? 1 : 0;
    const [result] = await pool.query("UPDATE menu_items SET aktif = ? WHERE id = ?", [aktif, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Menu tidak ditemukan." });
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM menu_items WHERE id = ?`, [id]);
    res.json({ item: toItem(rows[0]) });
  } catch (e) { next(e); }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [result] = await pool.query("DELETE FROM menu_items WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Menu tidak ditemukan." });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
