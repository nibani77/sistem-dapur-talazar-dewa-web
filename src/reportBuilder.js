// Menghitung laporan dari daftar pesanan. Bagian murni (tanpa database) supaya mudah diuji.
// Hari/minggu/bulan dihitung menurut zona waktu lokal (default WIB = UTC+7), bukan zona waktu server.

const DAY = 86400000;
const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTH_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const GROUPS = ["day", "week", "month"];
const MAX_RANGE_DAYS = 366;

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// "2026-10-09" -> { y, m, d } atau null kalau bukan tanggal yang sah.
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

// Awal hari (00:00 lokal) dalam milidetik UTC.
function dayStartMs(p, offsetHours) {
  return Date.UTC(p.y, p.m - 1, p.d) - offsetHours * 3600000;
}

function localDate(ms, offsetHours) {
  const dt = new Date(ms + offsetHours * 3600000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay(), h: dt.getUTCHours(), mi: dt.getUTCMinutes() };
}

function todayYmd(offsetHours, nowMs = Date.now()) {
  const l = localDate(nowMs, offsetHours);
  return ymd(l.y, l.m, l.d);
}

function addDays(ymdStr, n) {
  const p = parseYmd(ymdStr);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * DAY);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function weekStartYmd(p) {
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return addDays(ymd(p.y, p.m, p.d), -((dow + 6) % 7)); // Senin
}

function bucketKeyFromYmd(p, group) {
  if (group === "month") return `${p.y}-${pad(p.m)}`;
  if (group === "week") return weekStartYmd(p);
  return ymd(p.y, p.m, p.d);
}

function fmtDay(p) { return `${p.d} ${MONTH_SHORT[p.m - 1]} ${p.y}`; }

function bucketLabel(key, group) {
  if (group === "month") {
    const [y, m] = key.split("-").map(Number);
    return `${MONTH_LONG[m - 1]} ${y}`;
  }
  const p = parseYmd(key);
  if (group === "week") {
    const end = parseYmd(addDays(key, 6));
    return `Minggu ${fmtDay(p)} – ${fmtDay(end)}`;
  }
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${DAY_NAMES[dow]}, ${fmtDay(p)}`;
}

function fmtDateTime(ms, offsetHours) {
  const l = localDate(ms, offsetHours);
  return `${l.d} ${MONTH_SHORT[l.m - 1]} ${l.y} ${pad(l.h)}:${pad(l.mi)}`;
}

// Validasi parameter laporan. Mengembalikan { error } atau { from, to, group, fromMs, toMs }.
function resolveRange({ from, to, group }, offsetHours, nowMs = Date.now()) {
  const g = group || "day";
  if (!GROUPS.includes(g)) return { error: "Pengelompokan harus harian, mingguan, atau bulanan." };
  const today = todayYmd(offsetHours, nowMs);
  const toStr = to || today;
  const fromStr = from || addDays(toStr, -29);
  const pf = parseYmd(fromStr), pt = parseYmd(toStr);
  if (!pf || !pt) return { error: "Format tanggal harus TTTT-BB-HH, misalnya 2026-10-31." };
  if (fromStr > toStr) return { error: "Tanggal mulai tidak boleh setelah tanggal akhir." };
  const fromMs = dayStartMs(pf, offsetHours);
  const toMs = dayStartMs(pt, offsetHours) + DAY; // tanggal akhir ikut dihitung penuh
  if ((toMs - fromMs) / DAY > MAX_RANGE_DAYS) return { error: `Rentang laporan maksimal ${MAX_RANGE_DAYS} hari.` };
  return { from: fromStr, to: toStr, group: g, fromMs, toMs };
}

function bucketKeysInRange(fromStr, toStr, group) {
  const keys = [];
  const seen = new Set();
  for (let cur = fromStr; cur <= toStr; cur = addDays(cur, 1)) {
    const k = bucketKeyFromYmd(parseYmd(cur), group);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  return keys;
}

function itemsText(o) {
  return o.items.map((i) => `${i.nama}${i.varian && i.varian !== "-" ? " (" + i.varian + ")" : ""} x${i.qty}`).join("\n");
}

// orders: pesanan yang dibuat pada rentang laporan, lengkap dengan items.
function buildReport(orders, range, offsetHours) {
  const { from, to, group } = range;
  const periods = new Map(bucketKeysInRange(from, to, group).map((k) => [k, {
    key: k, label: bucketLabel(k, group), orders: 0, revenue: 0, cancelled: 0
  }]));

  const menus = new Map();
  const summary = {
    orderCount: 0, revenue: 0, avgOrder: 0, itemCount: 0,
    deliveredCount: 0, activeCount: 0, cancelledCount: 0, cancelledValue: 0
  };

  // Urut terbaru dulu supaya komposisi yang dipakai di rekap menu = salinan paling baru.
  const newestFirst = orders.slice().sort((a, b) => b.placedAt - a.placedAt);

  for (const o of newestFirst) {
    const l = localDate(o.placedAt, offsetHours);
    const period = periods.get(bucketKeyFromYmd(l, group));
    if (o.status === "batal") {
      summary.cancelledCount++;
      summary.cancelledValue += o.total;
      if (period) period.cancelled++;
      continue;
    }
    summary.orderCount++;
    summary.revenue += o.total;
    if (o.status === "selesai") summary.deliveredCount++; else summary.activeCount++;
    if (period) { period.orders++; period.revenue += o.total; }

    for (const it of o.items) {
      const key = (it.nama + "|" + (it.varian || "")).toLowerCase();
      let m = menus.get(key);
      if (!m) {
        m = { nama: it.nama, varian: it.varian && it.varian !== "-" ? it.varian : "", qty: 0, orders: 0, revenue: 0, satuan: it.satuan || "", komposisi: "" };
        menus.set(key, m);
      }
      m.qty += it.qty;
      m.orders += 1;
      m.revenue += it.harga * it.qty;
      if (!m.komposisi && it.komposisi) m.komposisi = it.komposisi;
      summary.itemCount += it.qty;
    }
  }
  summary.avgOrder = summary.orderCount ? Math.round(summary.revenue / summary.orderCount) : 0;

  return {
    range: { from, to, group },
    summary,
    periods: Array.from(periods.values()),
    menus: Array.from(menus.values()).sort((a, b) => b.qty - a.qty || a.nama.localeCompare(b.nama)),
    orders: orders.slice().sort((a, b) => a.placedAt - b.placedAt).map((o) => ({
      id: o.id,
      date: fmtDateTime(o.placedAt, offsetHours),
      customer: o.customer,
      addr: o.addr,
      itemsText: itemsText(o),
      status: o.status,
      total: o.total,
      cancelReason: o.cancelReason || ""
    }))
  };
}

module.exports = {
  GROUPS, MAX_RANGE_DAYS, parseYmd, todayYmd, addDays, resolveRange, buildReport,
  bucketLabel, bucketKeyFromYmd, fmtDateTime, localDate, dayStartMs
};
