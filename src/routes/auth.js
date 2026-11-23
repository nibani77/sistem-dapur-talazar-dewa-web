const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const roleLabel = { admin: "Admin", dapur: "Dapur", kurir: "Kurir" };

function publicUser(account) {
  return { username: account.username, role: account.role, name: account.name };
}

router.post("/login", async (req, res, next) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Nama pengguna atau kata sandi belum diisi." });
    }
    const [rows] = await pool.query("SELECT * FROM accounts WHERE username = ?", [username]);
    const account = rows[0];
    if (!account || !bcrypt.compareSync(password, account.password_hash)) {
      return res.status(401).json({ error: "Nama pengguna atau kata sandi salah." });
    }
    if (role && account.role !== role) {
      return res.status(401).json({
        error: `Akun ini terdaftar sebagai ${roleLabel[account.role]}, bukan ${roleLabel[role]}.`
      });
    }
    req.session.user = publicUser(account);
    res.json({ user: req.session.user });
  } catch (e) { next(e); }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Belum login." });
  res.json({ user: req.session.user });
});

router.post("/me/password", requireAuth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password baru minimal 6 karakter." });
    }
    const [rows] = await pool.query("SELECT * FROM accounts WHERE username = ?", [req.session.user.username]);
    const account = rows[0];
    if (!account || !bcrypt.compareSync(oldPassword || "", account.password_hash)) {
      return res.status(401).json({ error: "Password saat ini salah." });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    await pool.query("UPDATE accounts SET password_hash = ? WHERE username = ?", [hash, account.username]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
