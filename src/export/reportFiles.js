// Menyusun file laporan (Excel dan Word) dari hasil buildReport().
const { buildXlsx } = require("./xlsx");
const { buildDocx } = require("./docx");

const STATUS_LABEL = { baru: "Baru", dimasak: "Dimasak", siap: "Siap diambil", diantar: "Diantar", selesai: "Selesai", batal: "Dibatalkan" };
const GROUP_LABEL = { day: "per hari", week: "per minggu", month: "per bulan" };
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const rupiah = (n) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");

function niceDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

function rangeText(report) {
  const r = report.range;
  return `Periode ${niceDate(r.from)} s/d ${niceDate(r.to)} · ${GROUP_LABEL[r.group]}`;
}

const NOTE_BASIS = "Dihitung berdasarkan tanggal pesanan dibuat. Pesanan yang dibatalkan tidak masuk omzet.";
const NOTE_BAHAN = "Komposisi di bawah adalah bahan untuk 1 paket menu. Kebutuhan total = komposisi x jumlah dipesan.";

function summaryRows(s) {
  return [
    ["Jumlah pesanan (tidak termasuk batal)", s.orderCount, "number"],
    ["Total omzet", s.revenue, "money"],
    ["Rata-rata nilai per pesanan", s.avgOrder, "money"],
    ["Total paket/porsi dipesan", s.itemCount, "number"],
    ["Pesanan selesai diantar", s.deliveredCount, "number"],
    ["Pesanan masih berjalan", s.activeCount, "number"],
    ["Pesanan dibatalkan", s.cancelledCount, "number"],
    ["Nilai pesanan dibatalkan", s.cancelledValue, "money"]
  ];
}

function buildReportXlsx(report, company) {
  const s = report.summary;

  const ringkasan = [
    [{ v: `Laporan Pesanan — ${company.name}`, s: "title" }],
    [{ v: rangeText(report), s: "boldPlain" }],
    [{ v: NOTE_BASIS, s: "muted" }],
    [],
    [{ v: "Ringkasan", s: "header" }, { v: "Nilai", s: "header" }],
    ...summaryRows(s).map(([label, value, kind]) => [{ v: label, s: "text" }, { v: value, s: kind }]),
    [],
    [{ v: "Periode", s: "header" }, { v: "Jumlah pesanan", s: "header" }, { v: "Omzet", s: "header" }, { v: "Dibatalkan", s: "header" }],
    ...report.periods.map((p) => [{ v: p.label, s: "text" }, { v: p.orders, s: "number" }, { v: p.revenue, s: "money" }, { v: p.cancelled, s: "number" }]),
    [{ v: "TOTAL", s: "labelTotal" }, { v: s.orderCount, s: "number" }, { v: s.revenue, s: "moneyTotal" }, { v: s.cancelledCount, s: "number" }]
  ];

  const rekap = [
    [{ v: "Rekap Menu & Komposisi Bahan", s: "title" }],
    [{ v: rangeText(report), s: "boldPlain" }],
    [{ v: NOTE_BAHAN, s: "muted" }],
    [],
    ["No", "Menu", "Varian", "Jumlah dipesan", "Jumlah pesanan", "Omzet", "Komposisi / bahan per 1 paket"].map((h) => ({ v: h, s: "header" })),
    ...report.menus.map((m, i) => [
      { v: i + 1, s: "number" }, { v: m.nama, s: "bold" }, { v: m.varian, s: "text" },
      { v: m.qty, s: "number" }, { v: m.orders, s: "number" }, { v: m.revenue, s: "money" },
      { v: m.komposisi || "Belum ada detail komposisi", s: "text" }
    ])
  ];

  const daftar = [
    [{ v: "Daftar Pesanan", s: "title" }],
    [{ v: rangeText(report), s: "boldPlain" }],
    [],
    ["No. pesanan", "Tanggal", "Pelanggan", "Alamat", "Menu", "Status", "Total", "Keterangan"].map((h) => ({ v: h, s: "header" })),
    ...report.orders.map((o) => [
      { v: o.id, s: "bold" }, { v: o.date, s: "text" }, { v: o.customer, s: "text" }, { v: o.addr, s: "text" },
      { v: o.itemsText, s: "text" }, { v: STATUS_LABEL[o.status] || o.status, s: "text" }, { v: o.total, s: "money" },
      { v: o.cancelReason ? "Batal: " + o.cancelReason : "", s: "text" }
    ])
  ];

  return buildXlsx([
    { name: "Ringkasan", widths: [42, 18, 20, 14], rows: ringkasan },
    { name: "Rekap Menu & Bahan", widths: [6, 34, 14, 14, 14, 18, 70], freezeRows: 5, rows: rekap },
    { name: "Daftar Pesanan", widths: [14, 20, 24, 34, 44, 14, 16, 30], freezeRows: 4, rows: daftar }
  ]);
}

function buildReportDocx(report, company) {
  const s = report.summary;
  const blocks = [
    { type: "title", text: `Laporan Pesanan — ${company.name}` },
    { type: "sub", text: `${rangeText(report)}. ${NOTE_BASIS}` },

    { type: "h2", text: "Ringkasan" },
    {
      type: "table", widths: [3, 2], header: ["Keterangan", "Nilai"],
      rows: summaryRows(s).map(([label, value, kind]) => [label, { t: kind === "money" ? rupiah(value) : String(value), align: "right" }])
    },

    { type: "h2", text: `Penjualan ${GROUP_LABEL[report.range.group]}` },
    {
      type: "table", widths: [5, 2, 3, 2], header: ["Periode", "Jumlah pesanan", "Omzet", "Dibatalkan"],
      rows: [
        ...report.periods.map((p) => [p.label, { t: String(p.orders), align: "right" }, { t: rupiah(p.revenue), align: "right" }, { t: String(p.cancelled), align: "right" }]),
        [{ t: "TOTAL", bold: true, fill: "F1E4C6" }, { t: String(s.orderCount), align: "right", bold: true, fill: "F1E4C6" }, { t: rupiah(s.revenue), align: "right", bold: true, fill: "F1E4C6" }, { t: String(s.cancelledCount), align: "right", bold: true, fill: "F1E4C6" }]
      ]
    },

    { type: "h2", text: "Rekap menu dan komposisi bahan" },
    { type: "sub", text: NOTE_BAHAN },
    {
      type: "table", widths: [1, 5, 2, 2, 3, 9], header: ["No", "Menu", "Varian", "Jumlah dipesan", "Omzet", "Komposisi / bahan per 1 paket"],
      rows: report.menus.length
        ? report.menus.map((m, i) => [
            { t: String(i + 1), align: "right" }, { t: m.nama, bold: true }, m.varian,
            { t: String(m.qty), align: "right" }, { t: rupiah(m.revenue), align: "right" },
            m.komposisi || "Belum ada detail komposisi"
          ])
        : [["", "Belum ada pesanan pada periode ini", "", "", "", ""]]
    },

    { type: "h2", text: "Daftar pesanan" },
    {
      type: "table", widths: [2, 3, 3, 4, 6, 2, 3], header: ["No. pesanan", "Tanggal", "Pelanggan", "Alamat", "Menu", "Status", "Total"],
      rows: report.orders.length
        ? report.orders.map((o) => [
            { t: o.id, bold: true }, o.date, o.customer, o.addr, o.itemsText,
            STATUS_LABEL[o.status] + (o.cancelReason ? "\n" + o.cancelReason : ""),
            { t: rupiah(o.total), align: "right" }
          ])
        : [["", "Belum ada pesanan pada periode ini", "", "", "", "", ""]]
    }
  ];
  return buildDocx(blocks);
}

function reportFileName(report, ext) {
  return `Laporan-Dapur-Nusantara_${report.range.from}_sd_${report.range.to}.${ext}`;
}

module.exports = { buildReportXlsx, buildReportDocx, reportFileName, STATUS_LABEL, rupiah };
