// Bagian murni (tanpa database) untuk memproses daftar menu dalam pesanan, supaya mudah diuji.

const MAX_QTY = 100000;

// Merapikan daftar item dari browser: validasi bentuk, qty bulat >= 1, dan gabungkan baris yang
// menunya sama (nama + varian) supaya tidak muncul dobel di pesanan.
function normalizeRequestedItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Minimal satu menu harus dipilih." };
  }
  if (raw.length > 100) return { error: "Terlalu banyak baris menu dalam satu pesanan (maksimal 100)." };
  const merged = new Map();
  for (const it of raw) {
    if (!it || typeof it !== "object") return { error: "Data menu tidak valid." };
    const nama = String(it.nama || "").trim();
    const varian = String(it.varian === undefined || it.varian === null ? "" : it.varian).trim();
    const menuId = it.menuId ? parseInt(it.menuId, 10) : null;
    if (!nama && !menuId) return { error: "Ada menu tanpa nama." };
    const qty = Math.min(MAX_QTY, Math.max(1, parseInt(it.qty, 10) || 1));
    const key = menuId ? "id:" + menuId : "n:" + nama.toLowerCase() + "|" + varian.toLowerCase();
    const prev = merged.get(key);
    if (prev) prev.qty = Math.min(MAX_QTY, prev.qty + qty);
    else merged.set(key, { nama, varian, menuId, qty });
  }
  return { items: Array.from(merged.values()) };
}

function sumTotal(lines) {
  return lines.reduce((s, l) => s + l.harga * l.qty, 0);
}

module.exports = { normalizeRequestedItems, sumTotal };
