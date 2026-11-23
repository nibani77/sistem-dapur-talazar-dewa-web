-- Skema database Dapur Nusantara.
--
-- CATATAN: file ini OPSIONAL. Begitu kamu menjalankan `npm start`, aplikasi otomatis
-- membuat semua tabel ini sendiri (dan mengisi data awal) kalau belum ada — jadi kamu
-- TIDAK WAJIB mengimpor file ini. Pakai file ini hanya kalau kamu ingin membuat
-- tabel-tabelnya sendiri lebih dulu lewat phpMyAdmin (tab "Import").
--
-- Sebelum import: buat database kosong dulu bernama `dapur_nusantara` (atau nama lain,
-- asal sama dengan DB_NAME di file .env), collation utf8mb4_general_ci.

CREATE TABLE IF NOT EXISTS accounts (
  username      VARCHAR(100) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','dapur','kurir') NOT NULL,
  name          VARCHAR(150) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS meta (
  `key`   VARCHAR(50) PRIMARY KEY,
  `value` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
