const { pool } = require("../db");

// Cek sesi, lalu cocokkan ke tabel accounts. Dengan begitu akun yang dihapus admin langsung
// tidak bisa dipakai lagi, dan perubahan nama/peran langsung berlaku di semua perangkat.
async function requireAuth(req, res, next) {
  try {
    const sessionUser = req.session && req.session.user;
    if (!sessionUser) {
      return res.status(401).json({ error: "Belum login." });
    }
    const [rows] = await pool.query(
      "SELECT username, role, name FROM accounts WHERE username = ?",
      [sessionUser.username]
    );
    const account = rows[0];
    if (!account) {
      return req.session.destroy(() => res.status(401).json({ error: "Akun sudah tidak aktif. Silakan masuk lagi." }));
    }
    req.session.user = { username: account.username, role: account.role, name: account.name };
    next();
  } catch (e) {
    next(e);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (!roles.includes(req.session.user.role)) {
        return res.status(403).json({ error: "Tidak punya akses untuk aksi ini." });
      }
      next();
    });
  };
}

module.exports = { requireAuth, requireRole };
