const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

const MENU_JSON_PATH = path.join(__dirname, "..", "data", "menu.json");

const dbConfig = require("./dbConfig");
const { applyRule } = require("./komposisiRules");

const pool = mysql.createPool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4_general_ci"
});

async function tableCount(table) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM ${table}`);
  return rows[0].c;
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      username      VARCHAR(100) PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      role          ENUM('admin','dapur','kurir') NOT NULL,
      name          VARCHAR(150) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      kategori  VARCHAR(100) NOT NULL,
      nama      VARCHAR(200) NOT NULL,
      varian    VARCHAR(100) DEFAULT '',
      harga     INT NOT NULL,
      jumlah    VARCHAR(50)  DEFAULT '',
      satuan    VARCHAR(50)  DEFAULT '',
      komposisi TEXT,
      INDEX idx_nama_varian (nama, varian)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id              VARCHAR(20) PRIMARY KEY,
      customer        VARCHAR(150) NOT NULL,
      addr            VARCHAR(255) NOT NULL,
      notes           TEXT,
      status          ENUM('baru','dimasak','siap','diantar','selesai') NOT NULL DEFAULT 'baru',
      placed_at       BIGINT NOT NULL,
      pickup_location VARCHAR(255) DEFAULT NULL,
      ready_at        BIGINT DEFAULT NULL,
      courier         VARCHAR(150) DEFAULT NULL,
      delivered_at    BIGINT DEFAULT NULL,
      proof_photo     LONGTEXT DEFAULT NULL,
      total           INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      order_id  VARCHAR(20) NOT NULL,
      nama      VARCHAR(200) NOT NULL,
      varian    VARCHAR(100) DEFAULT '',
      qty       INT NOT NULL DEFAULT 1,
      harga     INT NOT NULL DEFAULT 0,
      satuan    VARCHAR(50) DEFAULT '',
      komposisi TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta (
      \`key\`   VARCHAR(50) PRIMARY KEY,
      \`value\` VARCHAR(255)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await upgradeSchema();
}

// ---- Pembaruan struktur untuk fitur baru. Aman dijalankan berulang: hanya menambah yang belum ada,
// dan data lama (pesanan, akun, menu) tidak disentuh. ----
async function columnInfo(table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}
async function ensureColumn(table, column, ddl) {
  if (!(await columnInfo(table, column))) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  }
}
async function ensureIndex(table, name, columns) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, name]
  );
  if (!rows.length) await pool.query(`CREATE INDEX \`${name}\` ON \`${table}\` (${columns})`);
}

async function upgradeSchema() {
  // Status "batal" untuk pesanan yang dibatalkan admin.
  const st = await columnInfo("orders", "status");
  if (st && !/'batal'/.test(st.COLUMN_TYPE)) {
    await pool.query(
      "ALTER TABLE orders MODIFY status ENUM('baru','dimasak','siap','diantar','selesai','batal') NOT NULL DEFAULT 'baru'"
    );
  }
  await ensureColumn("orders", "cancel_reason", "cancel_reason VARCHAR(255) DEFAULT NULL");
  await ensureColumn("orders", "cancelled_at", "cancelled_at BIGINT DEFAULT NULL");
  await ensureColumn("orders", "edited_at", "edited_at BIGINT DEFAULT NULL");
  // Menu bisa dinonaktifkan (tidak muncul saat buat pesanan) tanpa menghapus riwayatnya.
  await ensureColumn("menu_items", "aktif", "aktif TINYINT(1) NOT NULL DEFAULT 1");
  await ensureIndex("orders", "idx_orders_placed_at", "placed_at");
  await ensureIndex("orders", "idx_orders_status", "status");
  await ensureIndex("order_items", "idx_order_items_order", "order_id");
}

// Mengisi detail/komposisi menu dari data/komposisi.json (hasil Excel "Bahan Makanan").
// Dijalankan SEKALI per database. Aturan:
//  - "fill"   : hanya mengganti komposisi yang masih kosong / sama dengan nama menu / "Tidak dicantumkan...".
//  - "append" : menambahkan baris "Takaran dapur: ..." di bawah komposisi yang sudah ada (tidak dobel).
// Komposisi yang sudah pernah diedit admin dari aplikasi tidak ditimpa.
const KOMPOSISI_JSON_PATH = path.join(__dirname, "..", "data", "komposisi.json");
const KOMPOSISI_MARK = "Takaran dapur:";
async function syncKomposisi() {
  const [flag] = await pool.query("SELECT `value` FROM meta WHERE `key` = 'komposisi_sync_v1'");
  if (flag.length) return;
  if (!fs.existsSync(KOMPOSISI_JSON_PATH)) return;
  const rules = JSON.parse(fs.readFileSync(KOMPOSISI_JSON_PATH, "utf8"));
  let changed = 0;
  for (const r of rules) {
    const where = ["kategori = ?", "nama = ?"];
    const params = [r.kategori, r.nama];
    if (r.varian !== null && r.varian !== undefined) { where.push("varian = ?"); params.push(r.varian); }
    if (r.mode === "fill") {
      const [res] = await pool.query(
        `UPDATE menu_items SET komposisi = ?
          WHERE ${where.join(" AND ")}
            AND (komposisi IS NULL OR TRIM(komposisi) = '' OR LOWER(komposisi) = LOWER(nama)
                 OR LOWER(komposisi) LIKE 'tidak dicantumkan%')`,
        [r.text, ...params]
      );
      changed += res.affectedRows;
    } else {
      const block = KOMPOSISI_MARK + "\n" + r.text;
      const [res] = await pool.query(
        `UPDATE menu_items
            SET komposisi = IF(komposisi IS NULL OR TRIM(komposisi) = '', ?, CONCAT(komposisi, ?))
          WHERE ${where.join(" AND ")}
            AND (komposisi IS NULL OR komposisi NOT LIKE ?)`,
        [block, "\n" + block, ...params, "%" + KOMPOSISI_MARK + "%"]
      );
      changed += res.affectedRows;
    }
  }
  await pool.query("INSERT INTO meta (`key`, `value`) VALUES ('komposisi_sync_v1', ?)", [String(Date.now())]);
  console.log(`Sinkron komposisi dari Excel: ${changed} baris menu diperbarui.`);
}

// Tahap 2: detail tambahan dari Excel "Bahan Makanan" (merek selai, bahan Chocolate Fountain, daftar
// belanja angkringan, dst.). Aturannya ada di data/komposisi_v2.json dan dijalankan SEKALI per database.
// Komposisi yang sudah diedit admin dari aplikasi tidak ditimpa (lihat src/komposisiRules.js).
const KOMPOSISI_V2_PATH = path.join(__dirname, "..", "data", "komposisi_v2.json");
async function syncKomposisiV2() {
  const [flag] = await pool.query("SELECT `value` FROM meta WHERE `key` = 'komposisi_sync_v2'");
  if (flag.length) return;
  if (!fs.existsSync(KOMPOSISI_V2_PATH)) return;
  const rules = JSON.parse(fs.readFileSync(KOMPOSISI_V2_PATH, "utf8"));
  let changed = 0;
  for (const r of rules) {
    const where = ["kategori = ?", "nama = ?"];
    const params = [r.kategori, r.nama];
    if (r.varian !== null && r.varian !== undefined) { where.push("varian = ?"); params.push(r.varian); }
    const [rows] = await pool.query(`SELECT id, komposisi FROM menu_items WHERE ${where.join(" AND ")}`, params);
    for (const row of rows) {
      const next = applyRule(row.komposisi, r);
      if (next === null) continue;
      // "<=>" supaya perubahan batal otomatis kalau admin baru saja mengedit baris yang sama.
      const [res] = await pool.query("UPDATE menu_items SET komposisi = ? WHERE id = ? AND komposisi <=> ?", [next, row.id, row.komposisi]);
      changed += res.affectedRows;
    }
  }
  await pool.query("INSERT INTO meta (`key`, `value`) VALUES ('komposisi_sync_v2', ?)", [String(Date.now())]);
  console.log(`Sinkron detail bahan tahap 2: ${changed} baris menu diperbarui.`);
}

async function seedAccounts() {
  if ((await tableCount("accounts")) > 0) return;
  const defaults = [
    // Di server online, isi SEED_*_PASSWORD di .env SEBELUM pertama kali dijalankan
    // supaya tidak memakai password bawaan.
    { username: "admin.dapur", password: process.env.SEED_ADMIN_PASSWORD || "Admin123!", role: "admin", name: "Admin Dapur" },
    { username: "dapur.dedi", password: process.env.SEED_DAPUR_PASSWORD || "Dapur123!", role: "dapur", name: "Dedi (Dapur)" },
    { username: "dedi.kurniawan", password: process.env.SEED_KURIR_PASSWORD || "Kurir123!", role: "kurir", name: "Dedi Kurniawan" }
  ];
  for (const a of defaults) {
    await pool.query(
      "INSERT INTO accounts (username, password_hash, role, name) VALUES (?, ?, ?, ?)",
      [a.username, bcrypt.hashSync(a.password, 10), a.role, a.name]
    );
  }
  console.log("Seeded default accounts (admin.dapur / dapur.dedi / dedi.kurniawan).");
}

async function seedMenu() {
  if ((await tableCount("menu_items")) > 0) return;
  if (!fs.existsSync(MENU_JSON_PATH)) {
    console.warn("data/menu.json tidak ditemukan — tabel menu_items dikosongkan.");
    return;
  }
  const items = JSON.parse(fs.readFileSync(MENU_JSON_PATH, "utf8"));
  const values = items.map((it) => [
    it.kategori, it.nama, it.varian || "", it.harga, it.jumlah || "", it.satuan || "", it.komposisi || ""
  ]);
  await pool.query(
    "INSERT INTO menu_items (kategori, nama, varian, harga, jumlah, satuan, komposisi) VALUES ?",
    [values]
  );
  console.log(`Seeded ${items.length} menu item dari data/menu.json.`);
}

// onlyActive: menu yang dinonaktifkan tidak bisa dipesan baru.
async function findMenu(nama, varian, onlyActive = true) {
  const [rows] = await pool.query(
    `SELECT * FROM menu_items WHERE nama = ? AND varian = ? ${onlyActive ? "AND aktif = 1" : ""} LIMIT 1`,
    [nama, varian || ""]
  );
  return rows[0] || null;
}

async function findMenuById(id, onlyActive = true) {
  const [rows] = await pool.query(
    `SELECT * FROM menu_items WHERE id = ? ${onlyActive ? "AND aktif = 1" : ""} LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// Nomor pesanan "DN-xxx" dijamin unik & urut walau ada beberapa request bersamaan,
// pakai transaksi + row lock di tabel meta.
async function nextOrderId() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("INSERT IGNORE INTO meta (`key`, `value`) VALUES ('order_seq', '215')");
    const [rows] = await conn.query("SELECT `value` FROM meta WHERE `key` = 'order_seq' FOR UPDATE");
    const seq = parseInt(rows[0].value, 10);
    await conn.query("UPDATE meta SET `value` = ? WHERE `key` = 'order_seq'", [String(seq + 1)]);
    await conn.commit();
    return "DN-" + seq;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function seedDemoOrders() {
  if ((await tableCount("orders")) > 0) return;

  const now = Date.now();
  const demo = [
    { customer: "Budi Santoso", addr: "Jl. Kenanga No. 12, Jaksel", notes: "", status: "baru", placedAt: now - 2 * 60000, items: [["Cotton Candy Character", "Harga satuan", 1]] },
    { customer: "Siti Rahma", addr: "Jl. Melati Raya No. 5, Jaktim", notes: "Tidak terlalu manis, ya.", status: "baru", placedAt: now - 6 * 60000, items: [["Popcorn Butter", "Paket 1", 1]] },
    { customer: "Andi Wijaya", addr: "Jl. Anggrek Blok C2, Jakbar", notes: "", status: "dimasak", placedAt: now - 11 * 60000, items: [["Nasi Soto Betawi", "Paket 1", 1]] },
    { customer: "Dewi Lestari", addr: "Jl. Mawar No. 30, Jakut", notes: "Tolong tanpa kacang, ada tamu alergi.", status: "dimasak", placedAt: now - 15 * 60000, items: [["Chocolate Fountain", "Paket 1", 1]] },
    { customer: "Rian Pratama", addr: "Jl. Dahlia No. 8, Jakpus", notes: "", status: "siap", placedAt: now - 22 * 60000, readyAt: now - 10 * 60000, pickupLocation: "Rak penyajian A2, dekat pintu dapur", items: [["Waffle", "Paket 1", 1]] },
    { customer: "Maya Anggraini", addr: "Jl. Kamboja No. 21, Jaksel", notes: "", status: "siap", placedAt: now - 9 * 60000, readyAt: now - 2 * 60000, pickupLocation: "Meja checkout dapur", items: [["Bakso Malang", "Paket 1", 1]] },
    { customer: "Fajar Nugroho", addr: "Jl. Flamboyan No. 14, Jaktim", notes: "", status: "diantar", placedAt: now - 30 * 60000, readyAt: now - 16 * 60000, pickupLocation: "Rak penyajian A1", courier: "Dedi Kurniawan", items: [["Sate Ayam + Lontong", "Paket 1", 1]] },
    { customer: "Lestari Putri", addr: "Jl. Cempaka No. 3, Jakbar", notes: "", status: "selesai", placedAt: now - 55 * 60000, readyAt: now - 40 * 60000, pickupLocation: "Rak penyajian A2", courier: "Dedi Kurniawan", deliveredAt: now - 20 * 60000, items: [["Nasi Uduk + Semur", "Paket 1", 1]] },
    { customer: "Hendra Saputra", addr: "Jl. Kenanga No. 12, Jaksel", notes: "", status: "selesai", placedAt: now - 70 * 60000, readyAt: now - 52 * 60000, pickupLocation: "Meja checkout dapur", courier: "Dedi Kurniawan", deliveredAt: now - 35 * 60000, items: [["Dimsum Original", "Paket 1", 1], ["Nasi Rendang", "Paket 1", 1]] }
  ];

  for (const o of demo) {
    const id = await nextOrderId();
    let total = 0;
    const resolvedItems = [];
    for (const [nama, varian, qty] of o.items) {
      const m = await findMenu(nama, varian);
      if (!m) continue;
      total += m.harga * qty;
      resolvedItems.push({ nama: m.nama, varian: m.varian, qty, harga: m.harga, satuan: m.satuan, komposisi: m.komposisi });
    }
    await pool.query(
      `INSERT INTO orders (id, customer, addr, notes, status, placed_at, pickup_location, ready_at, courier, delivered_at, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, o.customer, o.addr, o.notes || "", o.status, o.placedAt, o.pickupLocation || null, o.readyAt || null, o.courier || null, o.deliveredAt || null, total]
    );
    for (const it of resolvedItems) {
      await pool.query(
        `INSERT INTO order_items (order_id, nama, varian, qty, harga, satuan, komposisi) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, it.nama, it.varian, it.qty, it.harga, it.satuan, it.komposisi]
      );
    }
  }
  console.log(`Seeded ${demo.length} contoh pesanan.`);
}

// Bikin database otomatis kalau belum ada (biar gak wajib bikin manual di phpMyAdmin).
async function ensureDatabase() {
  const dbName = dbConfig.database;
  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`
    );
  } finally {
    await conn.end();
  }
}

async function init() {
  try {
    await ensureDatabase();
  } catch (e) {
    // Di hosting, user MySQL biasanya tidak boleh CREATE DATABASE (database sudah dibuat dari panel).
    // Tidak masalah: lanjut saja. Kalau database-nya memang belum ada, error muncul di langkah berikutnya.
    console.warn("Lewati pembuatan database otomatis:", e.message);
  }
  await migrate();
  await seedAccounts();
  await seedMenu();
  await syncKomposisi();
  await syncKomposisiV2();
  // Di server sungguhan set SEED_DEMO_ORDERS=false supaya tidak ada pesanan contoh.
  if (process.env.SEED_DEMO_ORDERS !== "false") {
    await seedDemoOrders();
  }
}

module.exports = { pool, init, findMenu, findMenuById, nextOrderId };
