const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Все даты в базе — UTC. Группировка и фильтры — по местному времени магазина.
const TZ_MIN = Number(process.env.TZ_OFFSET_MINUTES || 360); // Бишкек, UTC+6
const LOCAL = `datetime(s.created_at, '${TZ_MIN >= 0 ? '+' : ''}${TZ_MIN} minutes')`;
const PAYMENTS = ['cash', 'transfer', 'debt'];
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function loadSale(id) {
  const sale = db.prepare(`
    SELECT s.*, u.name AS seller_name, c.name AS contractor_name, c.phone AS contractor_phone,
           c.address AS contractor_address, ${LOCAL} AS local_at
    FROM sales s
    LEFT JOIN users u ON u.id = s.seller_id
    LEFT JOIN contractors c ON c.id = s.contractor_id
    WHERE s.id = ?
  `).get(id);
  if (!sale) return null;
  sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(id);
  return sale;
}

// себестоимость и прибыль — только для администратора
function forViewer(sale, user) {
  if (!sale || user.role === 'admin') return sale;
  const { cost_total, ...rest } = sale;
  return { ...rest, items: sale.items.map(({ cost, ...it }) => it) };
}

// POST /api/sales  { items:[{product_id, product_name, unit, qty, price}], discount, payment, customer_name, customer_phone, contractor_id, note }
router.post('/', (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'items_required' });
  const payment = PAYMENTS.includes(b.payment) ? b.payment : 'cash';

  const getProd = db.prepare('SELECT id, category_id, cost FROM products WHERE id = ?');
  const lines = [];
  for (const it of items) {
    const qty = Math.max(1, Math.round(Number(it.qty) || 0));
    const price = Math.max(0, Math.round(Number(it.price) || 0));
    if (!it.product_name || !String(it.product_name).trim()) return res.status(400).json({ error: 'item_name_required' });
    const p = it.product_id ? getProd.get(it.product_id) : null;
    lines.push({
      product_id: p ? p.id : null,
      category_id: p ? p.category_id : null,
      product_name: String(it.product_name).trim(),
      unit: (it.unit && String(it.unit).trim()) || 'шт',
      qty, price,
      cost: p && p.cost != null ? p.cost : 0,
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = Math.min(subtotal, Math.max(0, Math.round(Number(b.discount) || 0)));
  const total = subtotal - discount;
  const costTotal = lines.reduce((s, l) => s + l.cost * l.qty, 0);

  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO sales (seller_id, contractor_id, customer_name, customer_phone, payment, subtotal, discount, total, cost_total, note, paid_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, CASE WHEN ? = 'debt' THEN NULL ELSE datetime('now') END)
    `).run(req.user.id, b.contractor_id || null, (b.customer_name || '').trim() || null, (b.customer_phone || '').trim() || null,
      payment, subtotal, discount, total, costTotal, (b.note || '').trim() || null, payment);
    const ins = db.prepare('INSERT INTO sale_items (sale_id, product_id, category_id, product_name, unit, qty, price, cost) VALUES (?,?,?,?,?,?,?,?)');
    for (const l of lines) ins.run(info.lastInsertRowid, l.product_id, l.category_id, l.product_name, l.unit, l.qty, l.price, l.cost);
    return info.lastInsertRowid;
  });
  const id = create();
  res.status(201).json(forViewer(loadSale(id), req.user));
});

// GET /api/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&payment=&q=
// продавец видит только свои продажи, администратор — все
router.get('/', (req, res) => {
  const { from, to, payment, q } = req.query;
  const where = [], params = [];
  if (isDate(from)) { where.push(`date(${LOCAL}) >= ?`); params.push(from); }
  if (isDate(to)) { where.push(`date(${LOCAL}) <= ?`); params.push(to); }
  if (PAYMENTS.includes(payment)) { where.push('s.payment = ?'); params.push(payment); }
  if (req.user.role !== 'admin') { where.push('s.seller_id = ?'); params.push(req.user.id); }
  if (q) {
    where.push('(s.customer_name LIKE ? OR s.customer_phone LIKE ? OR CAST(s.id AS TEXT) = ?)');
    params.push(`%${q}%`, `%${q}%`, String(q).replace(/\D/g, ''));
  }
  const rows = db.prepare(`
    SELECT s.*, u.name AS seller_name, c.name AS contractor_name, ${LOCAL} AS local_at,
           (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS lines
    FROM sales s
    LEFT JOIN users u ON u.id = s.seller_id
    LEFT JOIN contractors c ON c.id = s.contractor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.id DESC LIMIT 500
  `).all(...params);
  res.json(req.user.role === 'admin' ? rows : rows.map(({ cost_total, ...r }) => r));
});

router.get('/:id', (req, res) => {
  const sale = loadSale(Number(req.params.id));
  if (!sale) return res.status(404).json({ error: 'not_found' });
  if (req.user.role !== 'admin' && sale.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  res.json(forViewer(sale, req.user));
});

// PATCH /api/sales/:id  { paid: true } — погасить долг; { status:'cancelled' } — отменить (админ)
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (b.status !== undefined) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    if (!['done', 'cancelled'].includes(b.status)) return res.status(400).json({ error: 'bad_status' });
    db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(b.status, id);
  }
  if (b.paid === true && sale.payment === 'debt' && !sale.paid_at) {
    if (req.user.role !== 'admin' && sale.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    db.prepare("UPDATE sales SET paid_at = datetime('now') WHERE id = ?").run(id);
  }
  res.json(forViewer(loadSale(id), req.user));
});

/* ---------------- аналитика (только администратор) ---------------- */
router.get('/stats/summary', requireAdmin, (req, res) => {
  let { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from_to_required' });
  const W = `s.status = 'done' AND date(${LOCAL}) BETWEEN ? AND ?`;
  const P = [from, to];

  const kpi = db.prepare(`
    SELECT COUNT(*) AS sales, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(cost_total),0) AS cost,
           COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(total - cost_total),0) AS profit
    FROM sales s WHERE ${W}`).get(...P);
  kpi.avg = kpi.sales ? Math.round(kpi.revenue / kpi.sales) : 0;
  kpi.margin = kpi.revenue ? Math.round((kpi.profit / kpi.revenue) * 1000) / 10 : 0;
  kpi.units = db.prepare(`SELECT COALESCE(SUM(i.qty),0) AS u FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${W}`).get(...P).u;

  const days = db.prepare(`
    SELECT date(${LOCAL}) AS day, COUNT(*) AS sales, SUM(total) AS revenue, SUM(cost_total) AS cost, SUM(total - cost_total) AS profit
    FROM sales s WHERE ${W} GROUP BY day ORDER BY day`).all(...P);

  const hours = db.prepare(`
    SELECT CAST(strftime('%H', ${LOCAL}) AS INTEGER) AS hour, COUNT(*) AS sales, SUM(total) AS revenue
    FROM sales s WHERE ${W} GROUP BY hour ORDER BY hour`).all(...P);

  // скидка распределяется по строкам пропорционально их сумме
  const lineRevenue = `(i.price * i.qty) * (CASE WHEN s.subtotal > 0 THEN (s.total * 1.0 / s.subtotal) ELSE 1 END)`;
  const products = db.prepare(`
    SELECT i.product_id, COALESCE(p.name, i.product_name) AS name, SUM(i.qty) AS qty, ROUND(SUM(${lineRevenue})) AS revenue,
           ROUND(SUM(${lineRevenue} - i.cost * i.qty)) AS profit
    FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products p ON p.id = i.product_id
    WHERE ${W} GROUP BY COALESCE(i.product_id, i.product_name) ORDER BY revenue DESC LIMIT 10`).all(...P);

  const categories = db.prepare(`
    SELECT COALESCE(c.name, 'Без раздела') AS name, SUM(i.qty) AS qty, ROUND(SUM(${lineRevenue})) AS revenue,
           ROUND(SUM(${lineRevenue} - i.cost * i.qty)) AS profit
    FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN categories c ON c.id = i.category_id
    WHERE ${W} GROUP BY c.id ORDER BY revenue DESC`).all(...P);

  const sellers = db.prepare(`
    SELECT COALESCE(u.name, '—') AS name, COUNT(*) AS sales, SUM(total) AS revenue, SUM(total - cost_total) AS profit
    FROM sales s LEFT JOIN users u ON u.id = s.seller_id WHERE ${W} GROUP BY s.seller_id ORDER BY revenue DESC`).all(...P);

  const payments = db.prepare(`
    SELECT payment, COUNT(*) AS sales, SUM(total) AS revenue FROM sales s WHERE ${W} GROUP BY payment`).all(...P);

  // долги — все неоплаченные на сегодня, независимо от периода
  const debts = db.prepare(`
    SELECT s.id, s.total, s.customer_name, s.customer_phone, c.name AS contractor_name, ${LOCAL} AS local_at
    FROM sales s LEFT JOIN contractors c ON c.id = s.contractor_id
    WHERE s.status = 'done' AND s.payment = 'debt' AND s.paid_at IS NULL ORDER BY s.id DESC`).all();

  const noCost = db.prepare(`
    SELECT COUNT(*) AS n FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${W} AND i.cost = 0`).get(...P).n;

  res.json({ from, to, kpi, days, hours, products, categories, sellers, payments, debts, no_cost_lines: noCost });
});

/* ---------------- демо-продажи: заполнить / удалить (админ) ---------------- */
router.post('/demo/fill', requireAdmin, (req, res) => {
  const prods = db.prepare('SELECT id, category_id, name, price, cost, unit, options FROM products WHERE active = 1 AND price > 0').all();
  if (!prods.length) return res.status(400).json({ error: 'no_products' });
  const users = db.prepare('SELECT id FROM users WHERE active = 1').all();
  const names = ['Бакыт', 'Айгуль', 'Нурлан', 'Эркин', 'Гульнара', 'Азамат', 'Мирлан', 'Жылдыз', null, null, null];
  const doors = prods.filter(p => /двер/i.test(p.name));
  const parts = prods.filter(p => !/двер/i.test(p.name));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const insSale = db.prepare(`INSERT INTO sales (seller_id, customer_name, payment, subtotal, discount, total, cost_total, status, paid_at, created_at, demo)
    VALUES (?,?,?,?,?,?,?,'done',?,?,1)`);
  const insItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, category_id, product_name, unit, qty, price, cost) VALUES (?,?,?,?,?,?,?,?)');
  let n = 0;
  db.transaction(() => {
    for (let d = 29; d >= 0; d--) {
      const weekday = new Date(Date.now() - d * 864e5).getDay();
      const count = Math.round((weekday === 0 ? 2 : weekday === 6 ? 9 : 5) * (0.6 + Math.random() * 0.8));
      for (let k = 0; k < count; k++) {
        const hourLocal = 9 + Math.floor(Math.random() * 9);
        const at = new Date(Date.now() - d * 864e5);
        at.setUTCHours(hourLocal - TZ_MIN / 60, Math.floor(Math.random() * 60), 0, 0);
        const ts = at.toISOString().slice(0, 19).replace('T', ' ');
        const lines = [];
        if (doors.length && Math.random() < 0.7) {
          const door = pick(doors), q = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1;
          lines.push([door, q]);
          for (const p of parts) if (Math.random() < 0.35) lines.push([p, /Наличник/.test(p.name) ? q * 2 : q]);
        } else {
          for (let j = 0; j < 1 + Math.floor(Math.random() * 3); j++) lines.push([pick(parts.length ? parts : prods), 1 + Math.floor(Math.random() * 4)]);
        }
        const subtotal = lines.reduce((s, [p, q]) => s + p.price * q, 0);
        const discount = Math.random() < 0.25 ? Math.round(subtotal * 0.03 / 10) * 10 : 0;
        const costTotal = lines.reduce((s, [p, q]) => s + (p.cost || 0) * q, 0);
        const r = Math.random();
        const payment = r < 0.55 ? 'cash' : r < 0.92 ? 'transfer' : 'debt';
        const paid = payment === 'debt' && d < 6 ? null : ts;
        const info = insSale.run(pick(users).id, pick(names), payment, subtotal, discount, subtotal - discount, costTotal, paid, ts);
        for (const [p, q] of lines) {
          let label = p.name;
          try { const o = p.options ? JSON.parse(p.options) : null; if (o) label += ' (' + Object.values(o).map(v => v[0]).join(' · ') + ')'; } catch (e) {}
          insItem.run(info.lastInsertRowid, p.id, p.category_id, label, p.unit || 'шт', q, p.price, p.cost || 0);
        }
        n++;
      }
    }
  })();
  res.json({ ok: true, created: n });
});

router.delete('/demo/all', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM sales WHERE demo = 1').run();
  res.json({ ok: true, deleted: info.changes });
});

module.exports = router;
