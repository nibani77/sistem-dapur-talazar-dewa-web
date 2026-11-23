// Aturan memperbarui detail/komposisi menu dari Excel "Bahan Makanan". Bagian murni (tanpa database)
// supaya mudah diuji, dan dipakai baik oleh db.js maupun skrip penyusun data/menu.json.
//  - "replace": mengganti komposisi HANYA kalau isinya masih persis sama dengan teks lama (rule.old).
//               Komposisi yang sudah diedit admin dari aplikasi tidak ditimpa.
//  - "append" : menambahkan blok "Detail bahan (Excel):" di bawah komposisi yang ada (tidak dobel).
const MARK = "Detail bahan (Excel):";

// Mengembalikan teks komposisi baru, atau null kalau tidak ada yang perlu diubah.
function applyRule(current, rule) {
  const cur = current === null || current === undefined ? "" : String(current);
  if (rule.mode === "replace") return cur === rule.old ? rule.text : null;
  if (rule.mode === "append") {
    if (cur.includes(MARK)) return null;
    const block = MARK + "\n" + rule.text;
    return cur.trim() ? cur + "\n" + block : block;
  }
  return null;
}

module.exports = { MARK, applyRule };
