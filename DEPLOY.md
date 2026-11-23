# Panduan Deploy — supaya bisa dipakai tanpa menyalakan apa pun

> **Baru belajar membuat aplikasi?** Pakai **[RAILWAY.md](RAILWAY.md)**, langkahnya lebih sederhana.
> Dokumen ini untuk hosting cPanel atau VPS.

Tujuan: aplikasi dan database **online 24 jam di server hosting**. Tim CV Karya Cinta Talazar
tinggal membuka alamat web (misalnya `https://pesanan.namadomain.com`) dari HP atau komputer
masing-masing. Kamu tidak perlu membuka XAMPP, MySQL, atau VS Code lagi.

## Yang dibutuhkan dari hosting

Aplikasi ini butuh **dua hal** sekaligus:

1. **Node.js** versi 18 ke atas
2. **MySQL / MariaDB**

Hosting PHP biasa (yang hanya ada WordPress/phpMyAdmin) **belum tentu** mendukung Node.js.
Sebelum membeli, tanyakan ke penyedia: *"Apakah paket ini bisa menjalankan aplikasi Node.js
(Express) dan dapat MySQL?"* Cek juga harga dan fitur paket terbaru di situs penyedianya,
karena bisa berubah.

Dua jalur yang umum dipakai:

| Jalur | Cocok kalau | Catatan |
|-------|-------------|---------|
| **A. Hosting cPanel dengan menu "Setup Node.js App"** | Mau yang paling mudah, tanpa ngurus server | Hanya ada di paket tertentu. Database dibuat lewat menu MySQL Databases di cPanel |
| **B. VPS (Ubuntu)** | Mau kontrol penuh, atau hosting A tidak ada Node.js | Perlu sedikit pakai terminal. Langkahnya ada di bawah |

---

## Persiapan (berlaku untuk A dan B)

1. Di folder proyek, salin `.env.example` menjadi `.env`, lalu isi:

   ```
   PORT=3000
   SESSION_SECRET=<teks acak panjang, minimal 32 karakter>
   DB_HOST=<host MySQL dari hosting>
   DB_PORT=3306
   DB_USER=<user MySQL dari hosting>
   DB_PASSWORD=<password MySQL dari hosting>
   DB_NAME=<nama database dari hosting>
   SEED_DEMO_ORDERS=false
   SEED_ADMIN_PASSWORD=<password admin yang kamu pilih>
   SEED_DAPUR_PASSWORD=<password dapur yang kamu pilih>
   SEED_KURIR_PASSWORD=<password kurir yang kamu pilih>
   ```

   - `SEED_DEMO_ORDERS=false` supaya tidak ada pesanan contoh (Budi Santoso, dll).
   - Tiga `SEED_*_PASSWORD` **wajib diisi** sebelum pertama kali dijalankan di server online.
     Kalau tidak, akun dibuat dengan password bawaan yang sudah beredar di dokumentasi.
     Password ini hanya dipakai **sekali**, saat tabel akun masih kosong.

2. Jangan ikut mengunggah folder `node_modules` (akan dibuat di server lewat `npm install`).

---

## Jalur A — Hosting cPanel dengan Node.js

1. Di cPanel buka **MySQL Databases**:
   - buat database baru,
   - buat user baru beserta password,
   - tambahkan user itu ke database dengan hak akses **ALL PRIVILEGES**.
   Di hosting, nama database dan user biasanya diberi awalan akun, misalnya `akunku_dapur`.
   Pakai nama lengkap itu di `.env`. `DB_HOST` biasanya `localhost`.
2. Unggah semua file proyek (kecuali `node_modules`) ke satu folder lewat **File Manager**,
   misalnya `dapur-nusantara/`. Buat file `.env` di folder itu.
3. Buka **Setup Node.js App** → **Create Application**:
   - Node.js version: 18 atau lebih baru
   - Application root: `dapur-nusantara`
   - Application startup file: `server.js`
   - Application URL: domain atau subdomain yang kamu mau
4. Klik **Run NPM Install**, lalu **Restart**.
5. Buka alamat web-nya. Tabel dan 136 menu terisi otomatis saat pertama jalan.

Kalau ada error, buka file log aplikasi di folder itu (biasanya `stderr.log`).

---

## Jalur B — VPS Ubuntu

Contoh untuk Ubuntu 22.04 atau 24.04. Jalankan sebagai user dengan `sudo`.

```bash
# 1) Node.js 20 + MySQL + Nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs mysql-server nginx

# 2) Buat database dan user
sudo mysql -e "CREATE DATABASE dapur_nusantara CHARACTER SET utf8mb4;"
sudo mysql -e "CREATE USER 'dapur'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_DB';"
sudo mysql -e "GRANT ALL PRIVILEGES ON dapur_nusantara.* TO 'dapur'@'localhost'; FLUSH PRIVILEGES;"

# 3) Taruh proyek di server (unggah via SFTP / git), lalu:
cd /var/www/dapur-nusantara
cp .env.example .env && nano .env      # isi sesuai bagian "Persiapan"
npm install --omit=dev

# 4) Jalankan permanen dengan PM2 (nyala lagi otomatis setelah server restart)
sudo npm install -g pm2
pm2 start server.js --name dapur-nusantara
pm2 save
pm2 startup        # jalankan perintah yang ditampilkan, lalu: pm2 save
```

Nginx sebagai pintu masuk (isi `/etc/nginx/sites-available/dapur-nusantara`):

```nginx
server {
    server_name pesanan.namadomain.com;
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dapur-nusantara /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS gratis (arahkan dulu DNS domain ke IP server)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pesanan.namadomain.com
```

Setelah ini MySQL dan aplikasi menyala sendiri setiap server hidup. Kamu tidak perlu
membuka apa-apa lagi.

---

## Serah terima ke CV (checklist)

- [ ] Alamat web sudah bisa dibuka dari HP dan komputer lain
- [ ] Login ke tiga peran berhasil, lalu **ganti password** lewat tombol 🔒 / 🔑
- [ ] `SEED_DEMO_ORDERS=false` (tidak ada data contoh)
- [ ] Backup database aktif (lihat di bawah)
- [ ] Catat siapa yang memegang akun hosting dan domain, serahkan ke pihak CV

## Backup data (penting)

Data pesanan dan foto bukti tersimpan di MySQL. Kalau server rusak tanpa backup, data hilang.

- **cPanel**: aktifkan fitur Backup di panel, atau unduh backup database secara berkala.
- **VPS**: backup harian dengan cron:

  ```bash
  # crontab -e
  0 2 * * * mysqldump -u dapur -pGANTI_PASSWORD_DB dapur_nusantara | gzip > /var/backups/dapur-$(date +\%F).sql.gz
  ```

  Simpan salinannya juga di tempat lain (Google Drive, dll), bukan hanya di server yang sama.

## Mengubah menu atau harga

Edit tabel `menu_items` lewat phpMyAdmin (ada di panel hosting cPanel) atau langsung ke
database. Setelah itu muat ulang halaman aplikasi. Menu dari Excel hanya dimasukkan **sekali**
saat tabel masih kosong, jadi perubahan di database tidak akan ditimpa.
