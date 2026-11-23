require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const dbConfig = require("./src/dbConfig");
const { init } = require("./src/db");
const authRoutes = require("./src/routes/auth");
const accountsRoutes = require("./src/routes/accounts");
const menuRoutes = require("./src/routes/menu");
const ordersRoutes = require("./src/routes/orders");
const reportsRoutes = require("./src/routes/reports");
const appConfigRoutes = require("./src/routes/appConfig");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "8mb" })); // dilonggarkan supaya foto bukti antar (base64) muat

// Di belakang proxy hosting (HTTPS), Express perlu percaya header proxy supaya cookie "secure" jalan.
app.set("trust proxy", 1);

// Semua yang butuh database dipasang SETELAH init() selesai, supaya penyimpanan sesi
// tidak mencoba konek ke database yang belum sempat dibuat.
function mountApp() {
  // Sesi login disimpan di MySQL (tabel "sessions" dibuat otomatis), jadi user tidak
  // ter-logout setiap kali server restart.
  const sessionStore = new MySQLStore({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    createDatabaseTable: true
  });

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-secret-ganti-ini",
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: "auto", // otomatis aman di HTTPS, tetap jalan di http://localhost
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 hari
      }
    })
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/accounts", accountsRoutes);
  app.use("/api/menu", menuRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/config", appConfigRoutes);

  app.use(express.static(path.join(__dirname, "public")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // Error handler global — supaya error MySQL (koneksi gagal, dll) tidak bikin server crash
  // dan tetap mengembalikan respons JSON yang rapi ke frontend.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Terjadi kesalahan pada server. Cek terminal untuk detail." });
  });
}

(async function start() {
  try {
    await init(); // bikin tabel & isi data awal kalau database masih kosong
    mountApp();
    app.listen(PORT, () => {
      console.log(`Dapur Nusantara jalan di port ${PORT}`);
    });
  } catch (e) {
    console.error("Gagal konek/menyiapkan database MySQL:");
    console.error(e.message);
    console.error("\nCek lagi: MySQL sudah jalan? Database sudah dibuat? Kredensial di .env sudah benar?");
    process.exit(1);
  }
})();
