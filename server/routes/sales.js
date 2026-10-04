// Продажи: чек, оплата (можно частями и на разные счета), долг, отмена
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { int, num, str, isAdmin, dateRange, salePaid, moveStock } = require('../lib');

const router = express.Router();
router.use(requireAuth);

const L = db.local('s.created_at');
const PAID_SQL = `(SELECT COALESCE(SUM(CASE WHEN o.type='in' THEN o.amount ELSE -o.amount END),0) FROM cash_ops o WHERE o.sale_id = s.id)`;

function findOrCreateClient(name, phone) {
  const digits = str(phone).replace(/\D/g, '');
  if (digits.length >= 6) {
    const ex = db.prepare(`SELECT * FROM contacts WHERE type = 'client' AND replace(replace(replace(replace(phone,' ',''),'+',''),'-',''),'(','') LIKE ?`).get('%' + digits.slice(-9));
    if (ex) { if (name && !ex.name) db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(name, ex.id); return ex.id; }
  }
  if (!name && digits.length < 6) return null;
  return db.prepare("INSERT INTO contacts (type, name, phone) VALUES ('client', ?, ?)").run(name || 'Покупатель ' + digits.slice(-4), str(phone) || null).lastInsertRowid;
}

function loadSale(id, req) {
  const s = db.prepare(`SELECT s.*, ${L} AS local_at, ${PAID_SQL} AS paid, u.name AS seller_name, c.name AS contact_name, c.phone AS contact_phone
    FROM sales s LEFT JOIN users u ON u.id = s.seller_id LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.id = ?`).get(id);
  if (!s) return null;
  s.debt = s.status === 'done' ? Math.max(0, s.total - s.paid) : 0;
  s.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(id);
  s.payments = db.prepare(`SELECT o.id, o.type, o.amount, o.category, a.name AS account_name, ${db.local('o.created_at')} AS local_at
    FROM cash_ops o JOIN accounts a ON a.id = o.account_id WHERE o.sale_id = ? ORDER BY o.id`).all(id);
  if (!isAdmin(req)) { delete s.cost_total; s.items.forEach(i => delete i.cost); }
  return s;
}

/* POST /api/sales
   { items:[{product_id, name, variant, unit, qty, price}], discount,
     payments:[{account_id, amount}], contact_id | customer_name + customer_phone, note } */
router.post('/', (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'items_required' });
  const getP = db.prepare('SELECT * FROM products WHERE id = ?');
  const lines = [];
  for (const it of items) {
    const qty = num(it.qty);
    if (!(qty > 0)) return res.status(400).json({ error: 'bad_qty' });
    const p = it.product_id ? getP.get(it.product_id) : null;
    const name = str(it.name) || (p && p.name);
    if (!name) return res.status(400).json({ error: 'name_required' });
    lines.push({ p, name, variant: str(it.variant) || null, unit: str(it.unit) || (p && p.unit) || 'шт', qty, price: Math.max(0, int(it.price)), cost: p ? p.cost : 0 });
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const discount = Math.min(subtotal, Math.max(0, int(b.discount)));
  const total = subtotal - discount;
  const costTotal = Math.round(lines.reduce((s, l) => s + l.cost * l.qty, 0));
  const pays = (Array.isArray(b.payments) ? b.payments : []).map(x => ({ account_id: int(x.account_id), amount: Math.max(0, int(x.amount)) })).filter(x => x.account_id && x.amount);
  const paidSum = pays.reduce((s, x) => s + x.amount, 0);
  if (paidSum > total) return res.status(400).json({ error: 'overpaid' });

  const id = db.transaction(() => {
    let contactId = b.contact_id ? int(b.contact_id) : null;
    if (!contactId && (str(b.customer_name) || str(b.customer_phone))) contactId = findOrCreateClient(str(b.customer_name), str(b.customer_phone));
    if (paidSum < total && !contactId) throw Object.assign(new Error('debt_needs_client'), { code: 400 });
    const info = db.prepare(`INSERT INTO sales (seller_id, contact_id, customer_name, customer_phone, subtotal, discount, total, cost_total, note)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id, contactId, str(b.customer_name) || null, str(b.customer_phone) || null, subtotal, discount, total, costTotal, str(b.note) || null);
    const sid = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO sale_items (sale_id, product_id, category_id, name, variant, unit, qty, price, cost) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const l of lines) {
      ins.run(sid, l.p ? l.p.id : null, l.p ? l.p.category_id : null, l.name, l.variant, l.unit, l.qty, l.price, l.cost);
      if (l.p) moveStock(l.p.id, -l.qty, 'sale', sid, req.user.id);
    }
    const op = db.prepare("INSERT INTO cash_ops (type, account_id, amount, category, sale_id, contact_id, user_id) VALUES ('in',?,?,'Продажа',?,?,?)");
    for (const x of pays) op.run(x.account_id, x.amount, sid, contactId, req.user.id);
    return sid;
  });
  try { res.status(201).json(loadSale(id(), req)); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

// GET /api/sales?from&to&q&debt=1&contact_id
router.get('/', (req, res) => {
  const { from, to, q, debt, contact_id } = req.query;
  const w = [], p = [];
  dateRange('s', from, to, w, p);
  if (!isAdmin(req)) { w.push('s.seller_id = ?'); p.push(req.user.id); }
  if (contact_id) { w.push('s.contact_id = ?'); p.push(Number(contact_id)); }
  if (q) { w.push('(c.name LIKE ? OR s.customer_name LIKE ? OR c.phone LIKE ? OR CAST(s.id AS TEXT) = ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`, String(q).replace(/\D/g, '')); }
  let rows = db.prepare(`SELECT s.id, s.total, s.discount, s.status, s.seller_id, s.contact_id, ${isAdmin(req) ? 's.cost_total,' : ''}
      ${L} AS local_at, ${PAID_SQL} AS paid, u.name AS seller_name, COALESCE(c.name, s.customer_name) AS buyer,
      (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS lines
    FROM sales s LEFT JOIN users u ON u.id = s.seller_id LEFT JOIN contacts c ON c.id = s.contact_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY s.id DESC LIMIT 1000`).all(...p);
  rows.forEach(r => { r.debt = r.status === 'done' ? Math.max(0, r.total - r.paid) : 0; });
  if (debt) rows = rows.filter(r => r.debt > 0);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const s = loadSale(Number(req.params.id), req);
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req) && s.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  res.json(s);
});

// принять оплату по долгу
router.post('/:id/pay', (req, res) => {
  const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!s || s.status !== 'done') return res.status(404).json({ error: 'not_found' });
  const debt = s.total - salePaid(s.id);
  const amount = Math.min(debt, Math.max(0, int(req.body.amount)));
  const acc = int(req.body.account_id);
  if (!(amount > 0) || !acc) return res.status(400).json({ error: 'bad_amount' });
  db.prepare("INSERT INTO cash_ops (type, account_id, amount, category, sale_id, contact_id, user_id) VALUES ('in',?,?,'Оплата долга',?,?,?)")
    .run(acc, amount, s.id, s.contact_id, req.user.id);
  res.json(loadSale(s.id, req));
});

// отмена: товар возвращается на склад, деньги — покупателю (расход «Возврат покупателю»)
router.post('/:id/cancel', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!s || s.status !== 'done') return res.status(404).json({ error: 'not_found' });
  db.transaction(() => {
    db.prepare("UPDATE sales SET status = 'cancelled' WHERE id = ?").run(s.id);
    for (const it of db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(s.id)) if (it.product_id) moveStock(it.product_id, it.qty, 'cancel', s.id, req.user.id);
    const byAcc = db.prepare(`SELECT account_id, SUM(CASE WHEN type='in' THEN amount ELSE -amount END) net FROM cash_ops WHERE sale_id = ? GROUP BY account_id`).all(s.id);
    for (const a of byAcc) if (a.net > 0) db.prepare("INSERT INTO cash_ops (type, account_id, amount, category, sale_id, contact_id, user_id, note) VALUES ('out',?,?,'Возврат покупателю',?,?,?,?)")
      .run(a.account_id, a.net, s.id, s.contact_id, req.user.id, 'Отмена продажи №' + s.id);
  })();
  res.json(loadSale(s.id, req));
});

module.exports = router;
