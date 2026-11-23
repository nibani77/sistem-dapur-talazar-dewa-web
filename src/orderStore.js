// Fungsi baca pesanan dari database yang dipakai bersama oleh route pesanan dan laporan.
const { pool } = require("./db");

// Foto bukti (base64, bisa beberapa MB) sengaja TIDAK ikut daftar pesanan supaya halaman
// tetap ringan; foto diambil lewat GET /api/orders/:id/photo.
const ORDER_COLS = `id, customer, addr, notes, status, placed_at, pickup_location, ready_at, courier,
  delivered_at, total, cancel_reason, cancelled_at, edited_at, (proof_photo IS NOT NULL) AS has_proof`;

function toOrder(row, items) {
  return {
    id: row.id,
    customer: row.customer,
    addr: row.addr,
    notes: row.notes || "",
    status: row.status,
    placedAt: Number(row.placed_at),
    pickupLocation: row.pickup_location,
    readyAt: row.ready_at !== null ? Number(row.ready_at) : null,
    courier: row.courier,
    deliveredAt: row.delivered_at !== null ? Number(row.delivered_at) : null,
    hasProof: !!row.has_proof,
    proofUrl: row.has_proof ? `/api/orders/${encodeURIComponent(row.id)}/photo?v=${row.delivered_at || 0}` : null,
    cancelReason: row.cancel_reason || null,
    cancelledAt: row.cancelled_at !== null && row.cancelled_at !== undefined ? Number(row.cancelled_at) : null,
    editedAt: row.edited_at !== null && row.edited_at !== undefined ? Number(row.edited_at) : null,
    total: row.total,
    items: items || []
  };
}

async function attachItems(rows) {
  if (!rows.length) return [];
  const [items] = await pool.query(
    "SELECT order_id, nama, varian, qty, harga, satuan, komposisi FROM order_items WHERE order_id IN (?) ORDER BY id",
    [rows.map((r) => r.id)]
  );
  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push({
      nama: it.nama, varian: it.varian, qty: it.qty, harga: it.harga, satuan: it.satuan, komposisi: it.komposisi
    });
  }
  return rows.map((r) => toOrder(r, byOrder.get(r.id)));
}

async function fetchOrder(id) {
  const [rows] = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = ?`, [id]);
  if (!rows.length) return null;
  return (await attachItems(rows))[0];
}

// Pesanan yang DIBUAT pada rentang [fromMs, toMs), urut dari yang terlama.
async function fetchOrdersBetween(fromMs, toMs, limit = 20000) {
  const [rows] = await pool.query(
    `SELECT ${ORDER_COLS} FROM orders WHERE placed_at >= ? AND placed_at < ? ORDER BY placed_at ASC LIMIT ?`,
    [fromMs, toMs, limit]
  );
  return attachItems(rows);
}

module.exports = { ORDER_COLS, toOrder, attachItems, fetchOrder, fetchOrdersBetween };
