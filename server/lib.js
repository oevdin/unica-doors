// маленькие помощники для маршрутов
const db = require('./db');

const int = (v, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : def; };
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isAdmin = (req) => req.user && req.user.role === 'admin';

// фильтр по местной дате для колонки created_at таблицы с алиасом a
function dateRange(alias, from, to, where, params) {
  const L = db.local(`${alias}.created_at`);
  if (isDate(from)) { where.push(`date(${L}) >= ?`); params.push(from); }
  if (isDate(to)) { where.push(`date(${L}) <= ?`); params.push(to); }
}

// сколько уже оплачено по продаже / закупке
const salePaid = (saleId) => db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE -amount END),0) s
  FROM cash_ops WHERE sale_id = ?`).get(saleId).s;
const purchasePaid = (pid) => db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='out' THEN amount ELSE -amount END),0) s
  FROM cash_ops WHERE purchase_id = ?`).get(pid).s;

function moveStock(productId, delta, reason, refId, userId, note) {
  if (!productId || !delta) return;
  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, productId);
  db.prepare('INSERT INTO stock_moves (product_id, delta, reason, ref_id, user_id, note) VALUES (?,?,?,?,?,?)')
    .run(productId, delta, reason, refId || null, userId || null, note || null);
}

module.exports = { int, num, str, isDate, isAdmin, dateRange, salePaid, purchasePaid, moveStock };
