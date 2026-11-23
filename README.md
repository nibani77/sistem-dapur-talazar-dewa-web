# Dapur Nusantara

Sistem operasional pesanan untuk 3 peran: **Admin**, **Dapur**, **Kurir**.
Server **Node.js + Express**, database **MySQL** (bisa dikelola lewat **phpMyAdmin**).

## Yang dibutuhkan

1. **Node.js** versi 18 atau lebih baru: https://nodejs.org
2. **MySQL + phpMyAdmin**, paling gampang lewat salah satu paket ini:
   - XAMPP: https://www.apachefriends.org
   - Laragon: https://laragon.org

## Cara menjalankan

1. Nyalakan **MySQL** (di XAMPP: tekan *Start* pada baris MySQL).
2. Buka folder proyek ini di **VS Code** (`File > Open Folder...`).
3. Salin `.env.example` menjadi `.env`. Isi bawaannya sudah cocok untuk XAMPP/Laragon standar
   (user `root`, tanpa password). Kalau MySQL kamu pakai password, isi di `DB_PASSWORD`.
4. Buka terminal VS Code (`Terminal > New Terminal`), lalu jalankan:

   ```
   npm install
   npm start
   ```

5. Buka http://localhost:3000

Saat pertama kali jalan, aplikasi **otomatis**:
- membuat database `dapur_nusantara` (kalau belum ada),
- membuat semua tabel,
- mengisi 136 menu dari `data/menu.json`, 3 akun awal, dan beberapa contoh pesanan.

Setelah itu buka http://localhost/phpmyadmin, pilih database `dapur_nusantara`, dan semua tabelnya bisa dilihat/diedit di sana.

## Mau dipakai online tanpa menyalakan MySQL sendiri?

Cara di atas untuk dicoba di komputer sendiri. Untuk pemakaian sehari-hari oleh tim, pasang aplikasi
ini di hosting supaya selalu menyala.

- **Pemula, paling mudah:** ikuti **[RAILWAY.md](RAILWAY.md)** (Node.js + MySQL di satu tempat).
- **Alternatif** (hosting cPanel atau VPS): **[DEPLOY.md](DEPLOY.md)**.

Netlify tidak bisa dipakai untuk menjalankan server dan MySQL proyek ini.

## Akun awal

| Peran | Username         | Password   |
|-------|------------------|------------|
| Admin | `admin.dapur`    | `Admin123!`|
| Dapur | `dapur.dedi`     | `Dapur123!`|
| Kurir | `dedi.kurniawan` | `Kurir123!`|

Di server online, atur password awalnya lewat `SEED_*_PASSWORD` di `.env` (lihat DEPLOY.md). Segera ganti passwordnya lewat tombol **🔒 Password** (tiap akun) atau **🔑 Kelola akun** (admin).
Password disimpan dalam bentuk hash (bcrypt), jadi di phpMyAdmin tampilnya kode acak, bukan password asli.

## Tabel database

| Tabel         | Isi                                                        |
|---------------|------------------------------------------------------------|
| `accounts`    | Akun login (username, hash password, peran, nama)          |
| `menu_items`  | Katalog menu + harga + komposisi                           |
| `orders`      | Pesanan: pelanggan, alamat, catatan, status, lokasi, kurir, foto bukti |
| `order_items` | Item menu di tiap pesanan                                  |
| `meta`        | Penghitung nomor pesanan (DN-xxx)                          |

Mau mengubah harga/menu? Edit langsung tabel `menu_items` di phpMyAdmin, lalu refresh halaman aplikasi.

## Struktur folder

```
server.js            titik masuk server
src/db.js            koneksi MySQL, pembuatan tabel, data awal
src/routes/          auth, accounts, menu, orders (API)
src/middleware/      pengecekan login & peran
public/              tampilan (index.html + app.js)
data/menu.json       sumber data menu untuk pengisian awal
```

## Troubleshooting

- **"Gagal konek/menyiapkan database MySQL"**: pastikan MySQL sudah *Start*, lalu cek `DB_USER`/`DB_PASSWORD`/`DB_PORT` di `.env`.
- **`ECONNREFUSED`**: MySQL belum jalan, atau port-nya bukan 3306 (cek di panel XAMPP).
- **Foto bukti antar gagal tersimpan ("max_allowed_packet")**: foto sudah otomatis diperkecil, tapi kalau masih gagal, buka `my.ini` (XAMPP: *Config > my.ini*), set `max_allowed_packet=16M`, lalu restart MySQL.
- **Reset semua data**: di phpMyAdmin, hapus database `dapur_nusantara`, lalu jalankan `npm start` lagi.
- **Mau dipakai online (hosting)**: ganti `SESSION_SECRET` di `.env` dengan teks acak panjang, dan pakai kredensial MySQL dari penyedia hosting.
