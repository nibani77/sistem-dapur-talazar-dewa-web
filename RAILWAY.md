# Panduan Pasang di Railway (untuk pemula)

Hasil akhirnya: aplikasi punya alamat web sendiri (misalnya `https://dapur-nusantara.up.railway.app`)
yang bisa dibuka tim CV dari HP atau komputer kapan saja. Aplikasi **dan** database MySQL menyala
sendiri di server Railway, jadi kamu tidak perlu membuka XAMPP, MySQL, atau VS Code lagi.

Railway dipilih karena menyediakan Node.js **dan** MySQL di satu tempat. Netlify tidak dipakai di jalur ini.

## Biaya (cek ulang sebelum mulai)

Menurut dokumentasi Railway saat panduan ini ditulis: akun baru dapat kredit percobaan sekali
sebesar US$5, dan setelah itu paket Hobby US$5 per bulan (sudah termasuk pemakaian sebesar US$5).
Harga dan batasan bisa berubah, jadi cek halaman **Pricing** di railway.com sebelum mendaftar.
Kalau CV yang menanggung biayanya, sampaikan ini ke mereka dari awal.

## Yang disiapkan

- Akun **GitHub** (gratis): github.com
- Akun **Railway**: railway.com (daftar pakai akun GitHub paling mudah)
- File proyek ini sudah diekstrak dari ZIP

---

## Langkah 1 — Unggah proyek ke GitHub

1. Di GitHub klik **New repository**. Beri nama `dapur-nusantara`. Pilih **Private** (supaya kode tidak terbuka untuk umum). Klik **Create repository**.
2. Di halaman repository baru klik link **uploading an existing file**.
3. Buka folder proyek yang sudah diekstrak, pilih **semua isi di dalamnya** (`package.json`, `server.js`, folder `src`, `public`, `data`, dst.), lalu seret ke halaman GitHub.
   - Yang diseret adalah *isi* foldernya, jangan folder `dapur-nusantara` itu sendiri. `package.json` harus ada di tingkat paling atas repository.
   - Jangan ikut mengunggah file `.env` (kalau kamu pernah membuatnya) atau folder `node_modules`.
4. Klik **Commit changes**.

## Langkah 2 — Buat project di Railway

1. Login ke Railway, klik **New Project** → **Deploy from GitHub repo**, lalu pilih repository `dapur-nusantara`. Izinkan akses kalau diminta.
2. Railway otomatis mengenali proyek Node.js dan mencoba menjalankannya. **Deploy pertama ini akan gagal atau crash. Itu normal**, karena database-nya belum ada.

## Langkah 3 — Tambah database MySQL

1. Di halaman project klik **+ New** → **Database** → **MySQL**.
2. Tunggu sampai database-nya berjalan. Catat **nama service** database itu (biasanya `MySQL`).

## Langkah 4 — Sambungkan aplikasi ke database

1. Klik service aplikasimu (yang dari GitHub), buka tab **Variables**.
2. Klik **RAW Editor**, lalu tempel isi di bawah ini. Kalau nama service database kamu bukan `MySQL`, ganti bagian `MySQL` pada `${{MySQL....}}` dengan nama yang sebenarnya.

   ```
   MYSQLHOST=${{MySQL.MYSQLHOST}}
   MYSQLPORT=${{MySQL.MYSQLPORT}}
   MYSQLUSER=${{MySQL.MYSQLUSER}}
   MYSQLPASSWORD=${{MySQL.MYSQLPASSWORD}}
   MYSQLDATABASE=${{MySQL.MYSQLDATABASE}}
   SESSION_SECRET=ISI_DENGAN_TEKS_ACAK_PANJANG_MINIMAL_32_KARAKTER
   SEED_DEMO_ORDERS=false
   SEED_ADMIN_PASSWORD=PASSWORD_ADMIN_PILIHANMU
   SEED_DAPUR_PASSWORD=PASSWORD_DAPUR_PILIHANMU
   SEED_KURIR_PASSWORD=PASSWORD_KURIR_PILIHANMU
   ```

3. Ganti nilai yang berhuruf besar dengan isi milikmu:
   - `SESSION_SECRET`: teks acak yang panjang, misalnya ketik asal 40 karakter huruf dan angka. Jangan dibagikan ke siapa pun.
   - Tiga `SEED_*_PASSWORD`: password awal untuk akun Admin, Dapur, dan Kurir. **Wajib diisi sekarang**, karena akun dibuat hanya sekali saat aplikasi pertama kali berhasil jalan.
   - `SEED_DEMO_ORDERS=false` supaya pesanan contoh (Budi Santoso, dll.) tidak muncul.
4. Perubahan variabel ditampung dulu. Klik **Deploy** untuk menerapkannya.

## Langkah 5 — Buat alamat web

1. Di service aplikasi buka **Settings** → **Networking** → **Public Networking**, lalu klik **Generate Domain**.
2. Railway memberi alamat berakhiran `.railway.app`, sudah **HTTPS** otomatis.
3. Buka alamat itu. Saat pertama jalan, aplikasi otomatis membuat tabel dan mengisi 136 menu dari Excel kamu.

## Langkah 6 — Coba dan amankan

1. Login dengan username (`admin.dapur`, `dapur.dedi`, `dedi.kurniawan`) dan password yang kamu isi di langkah 4.
2. Buat satu pesanan percobaan sebagai Admin, proses di Dapur, antar di Kurir (termasuk foto).
3. Ganti password lewat tombol 🔒 (tiap akun) atau 🔑 Kelola akun (admin) kalau perlu.
4. Bagikan alamat webnya ke tim CV.

---

## Kalau ada masalah

| Gejala | Yang dicek |
|--------|-----------|
| Halaman "Application failed to respond" | Buka tab **Deployments** → **Deploy Logs**. Kalau ada tulisan `Gagal konek/menyiapkan database MySQL`, periksa lagi nama service di variabel `${{MySQL....}}` |
| Domain minta nomor port | Tambahkan variabel `PORT=3000` di aplikasi, lalu deploy ulang |
| Login pakai password bawaan (`Admin123!`) padahal sudah isi `SEED_*_PASSWORD` | Variabel baru diisi setelah akun terlanjur dibuat. Buka service MySQL → tab **Data**, kosongkan tabel `accounts`, lalu deploy ulang aplikasinya |
| Aplikasi tidak mulai | Di **Settings** service aplikasi, isi **Start Command** dengan `npm start` |

## Melihat dan mengubah data (pengganti phpMyAdmin)

Railway tidak punya phpMyAdmin. Untuk melihat atau mengubah tabel (misalnya harga di `menu_items`),
buka service MySQL di Railway lalu tab **Data**. Kalau mau memakai aplikasi desktop seperti DBeaver
atau TablePlus, aktifkan dulu **Public Access** di Settings → Networking service MySQL, dan matikan lagi
setelah selesai. Dokumentasi Railway menyebut akses publik ini dikenai biaya trafik keluar.

## Fitur-fitur di dalam aplikasi

| Fitur | Di mana |
|-------|---------|
| Buat, **ubah**, dan **batalkan** pesanan (alasan wajib, riwayat tetap tersimpan) | Admin → tombol Detail pada pesanan |
| **Cetak nota** per pesanan (bisa untuk pelanggan / finance) dan cetak daftar sesuai filter | Admin → Detail / Nota, dan "Cetak daftar" |
| **Laporan** per hari / minggu / bulan, lengkap dengan komposisi bahan per menu, unduh **Excel** atau **Word**, atau cetak | Admin → 📊 Laporan |
| **Kelola menu**: tambah menu baru (nama, harga, komposisi), ubah harga, nonaktifkan, hapus | Admin → 📋 Kelola menu |
| **Kelola akun**: tambah akun Dapur / Kurir / Admin baru, ganti password, hapus | Admin → 👥 Kelola akun |
| Bunyi dan pemberitahuan saat ada pesanan baru / siap diambil / dibatalkan | Tombol 🔔 di pojok atas (tiap perangkat) |
| Pencarian dan filter pesanan | Admin (status, tanggal, kata kunci), Dapur, Kurir |

Satu akun boleh dipakai login di beberapa HP/komputer sekaligus. Kalau butuh 2-3 kurir, buat akun
Kurir terpisah lewat Kelola akun; tiap pengantaran tercatat atas nama kurir yang mengambilnya.
Mengubah menu atau harga hanya berlaku untuk pesanan **baru**; nota dan laporan lama tidak berubah.

Variabel opsional (Railway → Variables) untuk kop nota dan laporan:
`COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_PHONE`, `COMPANY_NOTE`, dan `REPORT_TZ_OFFSET_HOURS` (default 7 = WIB).

Detail bahan dari Excel "Bahan Makanan" (merek selai, bahan Chocolate Fountain, daftar belanja angkringan, dll.)
dimasukkan otomatis **sekali** saat versi ini pertama menyala. Komposisi yang sudah kamu edit lewat Kelola menu
tidak ditimpa. Pesanan lama tidak berubah (komposisinya sudah tersimpan saat pesanan dibuat); hanya pesanan baru
yang memakai detail terbaru.

## Memasang pembaruan kode

1. Ganti file yang berubah di folder proyek (VS Code), lalu di Source Control klik **Commit** dan **Sync Changes**.
2. Railway otomatis membangun ulang dalam 1-3 menit. Data pesanan dan akun **tidak terhapus**.
   Kolom atau tabel baru dibuat otomatis oleh aplikasi saat menyala.
3. Kalau status berubah merah (Crashed), buka **Deployments → Deploy Logs** dan baca baris error terakhir.

## Memperbarui aplikasi

Ubah file di GitHub (atau unggah versi baru), lalu Railway biasanya otomatis memasang versi terbarunya.
Data di database tidak ikut terhapus.

## Backup (penting)

Data pesanan dan foto bukti hanya ada di database. Cek tab **Backups** pada service MySQL di Railway
untuk fitur backup yang tersedia di paketmu, dan ekspor datanya secara berkala (misalnya tiap minggu)
lewat DBeaver atau TablePlus. Simpan salinannya di tempat lain.

## Serah terima ke CV (checklist)

- [ ] Alamat web bisa dibuka dari HP dan komputer lain
- [ ] Tiga peran sudah dicoba login dan berfungsi
- [ ] Password awal sudah diganti ke yang hanya diketahui pemiliknya
- [ ] Akun Railway dan GitHub diserahkan atau dibagikan ke pihak yang bertanggung jawab di CV
- [ ] Ada rencana backup, dan CV tahu siapa yang membayar biaya Railway tiap bulan
