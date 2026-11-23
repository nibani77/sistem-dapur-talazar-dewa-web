// Satu tempat untuk membaca pengaturan MySQL.
// Mendukung nama variabel buatan kita (DB_*) dan nama bawaan Railway (MYSQL*),
// jadi di Railway cukup menyambungkan variabel database ke aplikasi tanpa mengganti namanya.
const env = process.env;

module.exports = {
  host: env.DB_HOST || env.MYSQLHOST || "127.0.0.1",
  port: Number(env.DB_PORT || env.MYSQLPORT) || 3306,
  user: env.DB_USER || env.MYSQLUSER || "root",
  password: env.DB_PASSWORD ?? env.MYSQLPASSWORD ?? "",
  database: env.DB_NAME || env.MYSQLDATABASE || "dapur_nusantara"
};
