// Pengaturan yang bisa diubah lewat variabel lingkungan (Railway: tab Variables), tanpa mengubah kode.

function offsetHours() {
  const n = Number(process.env.REPORT_TZ_OFFSET_HOURS);
  return Number.isFinite(n) ? n : 7; // WIB
}

function company() {
  return {
    name: process.env.COMPANY_NAME || "CV Karya Cinta Talazar",
    address: process.env.COMPANY_ADDRESS || "",
    phone: process.env.COMPANY_PHONE || "",
    note: process.env.COMPANY_NOTE || ""
  };
}

module.exports = { offsetHours, company };
