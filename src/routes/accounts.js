const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

const ROLES = ["admin", "dapur", "kurir"];

router.get("/", requireRole("admin"), async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT username, role, name FROM accounts ORDER BY FIELD(role,'admin','dapur','kurir'), name");
    res.json({ accounts: rows });
  } catch (e) { next(e); }
});

// Tambah akun baru. Satu peran boleh punya banyak akun (mis. 2-3 kurir), dan satu akun
// juga boleh dipakai login di beberapa perangkat sekaligus.
router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const username = String(b.username || "").trim().toLowerCase();
    const name = String(b.name || "").trim();
    const role = String(b.role || "");
    const password = String(b.password || "");
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      return res.status(400).json({ error: "Nama pengguna 3-40 karakter: huruf kecil, angka, titik, strip, atau garis bawah (tanpa spasi)." });
    }
    if (!name || name.length > 150) return res.status(400).json({ error: "Nama lengkap wajib diisi (maksimal 150 karakter)." });
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Peran harus Admin, Dapur, atau Kurir." });
    if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });

    const [dup] = await pool.query("SELECT username FROM accounts WHERE username = ?", [username]);
    if (dup.length) return res.status(409).json({ error: `Nama pengguna "${username}" sudah dipakai.` });

    await pool.query(
      "INSERT INTO accounts (username, password_hash, role, name) VALUES (?, ?, ?, ?)",
      [username, bcrypt.hashSync(password, 10), role, name]
    );
    res.status(201).json({ account: { username, role, name } });
  } catch (e) { next(e); }
});

router.patch("/:username", requireRole("admin"), async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    if (!name || name.length > 150) return res.status(400).json({ error: "Nama wajib diisi (maksimal 150 karakter)." });
    const [result] = await pool.query("UPDATE accounts SET name = ? WHERE username = ?", [name, req.params.username]);
    if (!result.affectedRows) return res.status(404).json({ error: "Akun tidak ditemukan." });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.patch("/:username/password", requireRole("admin"), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password baru minimal 6 karakter." });
    }
    const [rows] = await pool.query("SELECT * FROM accounts WHERE username = ?", [req.params.username]);
    const account = rows[0];
    if (!account) return res.status(404).json({ error: "Akun tidak ditemukan." });
    const hash = bcrypt.hashSync(password, 10);
    await pool.query("UPDATE accounts SET password_hash = ? WHERE username = ?", [hash, account.username]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:username", requireRole("admin"), async (req, res, next) => {
  try {
    const username = req.params.username;
    if (username === req.session.user.username) {
      return res.status(400).json({ error: "Akun yang sedang kamu pakai tidak bisa dihapus." });
    }
    const [rows] = await pool.query("SELECT role FROM accounts WHERE username = ?", [username]);
    if (!rows.length) return res.status(404).json({ error: "Akun tidak ditemukan." });
    if (rows[0].role === "admin") {
      const [admins] = await pool.query("SELECT COUNT(*) AS c FROM accounts WHERE role = 'admin'");
      if (admins[0].c <= 1) return res.status(400).json({ error: "Harus tersisa minimal satu akun Admin." });
    }
    await pool.query("DELETE FROM accounts WHERE username = ?", [username]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
