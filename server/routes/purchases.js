// Приход товара от поставщика: пополняет склад, пересчитывает себестоимость, оплата из кассы
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { int, num, str, dateRange, purchasePaid, moveStock } = require('../lib');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const PAID = `(SELECT COALESCE(SUM(CASE WHEN o.type='out' THEN o.amount ELSE -o.amount END),0) FROM cash_ops o WHERE o.purchase_id = p.id)`;

function load(id) {
  const p = db.prepare(`SELECT p.*, ${db.local('p.created_at')} AS local_at, ${PAID} AS paid, c.name AS supplier, c.phone AS supplier_phone, u.name AS user_name
    FROM purchases p LEFT JOIN contacts c ON c.id = p.contact_id LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(id);
  if (!p) return null;
  p.debt = p.status === 'done' ? Math.max(0, p.total - p.paid) : 0;
  p.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(id);
  p.payments = db.prepare(`SELECT o.*, a.name AS account_name, ${db.local('o.created_at')} AS local_at FROM cash_ops o JOIN accounts a ON a.id = o.account_id WHERE o.purchase_id = ? ORDER BY o.id`).all(id);
  return p;
}

router.get('/', (req, res) => {
  const w = [], p = [];
  dateRange('p', req.query.from, req.query.to, w, p);
  if (req.query.contact_id) { w.push('p.contact_id = ?'); p.push(Number(req.query.contact_id)); }
  const rows = db.prepare(`SELECT p.*, ${db.local('p.created_at')} AS local_at, ${PAID} AS paid, c.name AS supplier,
      (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = p.id) AS lines
    FROM purchases p LEFT JOIN contacts c ON c.id = p.contact_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 500`).all(...p);
  rows.forEach(r => { r.debt = r.status === 'done' ? Math.max(0, r.total - r.paid) : 0; });
  res.json(rows);
});
router.get('/:id', (req, res) => { const p = load(Number(req.params.id)); p ? res.json(p) : res.status(404).json({ error: 'not_found' }); });

/* POST { contact_id | supplier_name + supplier_phone, items:[{product_id, qty, cost}], payment:{account_id, amount}, note } */
router.post('/', (req, res) => {
  const b = req.body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(x => ({ product_id: int(x.product_id), qty: num(x.qty), cost: Math.max(0, int(x.cost)) })).filter(x => x.product_id && x.qty > 0);
  if (!items.length) return res.status(400).json({ error: 'items_required' });
  const total = Math.round(items.reduce((s, x) => s + x.qty * x.cost, 0));
  const pay = b.payment ? { account_id: int(b.payment.account_id), amount: Math.min(total, Math.max(0, int(b.payment.amount))) } : null;

  const id = db.transaction(() => {
    let contactId = b.contact_id ? int(b.contact_id) : null;
    if (!contactId && str(b.supplier_name)) contactId = db.prepare("INSERT INTO contacts (type, name, phone) VALUES ('supplier', ?, ?)").run(str(b.supplier_name), str(b.supplier_phone) || null).lastInsertRowid;
    const pid = db.prepare('INSERT INTO purchases (contact_id, user_id, total, note) VALUES (?,?,?,?)').run(contactId, req.user.id, total, str(b.note) || null).lastInsertRowid;
    const getP = db.prepare('SELECT * FROM products WHERE id = ?');
    for (const it of items) {
      const prod = getP.get(it.product_id);
      if (!prod) continue;
      db.prepare('INSERT INTO purchase_items (purchase_id, product_id, name, qty, cost) VALUES (?,?,?,?,?)').run(pid, prod.id, prod.name, it.qty, it.cost);
      // средневзвешенная себестоимость
      const have = Math.max(0, prod.stock);
      const newCost = have > 0 ? Math.round((have * prod.cost + it.qty * it.cost) / (have + it.qty)) : it.cost;
      db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(newCost, prod.id);
      moveStock(prod.id, it.qty, 'purchase', pid, req.user.id);
    }
    if (pay && pay.account_id && pay.amount > 0) db.prepare("INSERT INTO cash_ops (type, account_id, amount, category, purchase_id, contact_id, user_id) VALUES ('out',?,?,'Закуп товара',?,?,?)")
      .run(pay.account_id, pay.amount, pid, contactId, req.user.id);
    return pid;
  })();
  res.status(201).json(load(id));
});

router.post('/:id/pay', (req, res) => {
  const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (!p || p.status !== 'done') return res.status(404).json({ error: 'not_found' });
  const amount = Math.min(p.total - purchasePaid(p.id), Math.max(0, int(req.body.amount)));
  if (!(amount > 0) || !int(req.body.account_id)) return res.status(400).json({ error: 'bad_amount' });
  db.prepare("INSERT INTO cash_ops (type, account_id, amount, category, purchase_id, contact_id, user_id) VALUES ('out',?,?,'Закуп товара',?,?,?)")
    .run(int(req.body.account_id), amount, p.id, p.contact_id, req.user.id);
  res.json(load(p.id));
});

router.post('/:id/cancel', (req, res) => {
  const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (!p || p.status !== 'done') return res.status(404).json({ error: 'not_found' });
  db.transaction(() => {
    db.prepare("UPDATE purchases SET status = 'cancelled' WHERE id = ?").run(p.id);
    for (const it of db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(p.id)) if (it.product_id) moveStock(it.product_id, -it.qty, 'cancel', p.id, req.user.id, 'Отмена прихода №' + p.id);
    const byAcc = db.prepare(`SELECT account_id, SUM(CASE WHEN type='out' THEN amount ELSE -amount END) net FROM cash_ops WHERE purchase_id = ? GROUP BY account_id`).all(p.id);
    for (const a of byAcc) if (a.net > 0) db.prepare("INSERT INTO cash_ops (type, account_id, amount, category, purchase_id, contact_id, user_id, note) VALUES ('in',?,?,'Возврат от поставщика',?,?,?,?)")
      .run(a.account_id, a.net, p.id, p.contact_id, req.user.id, 'Отмена прихода №' + p.id);
  })();
  res.json(load(p.id));
});

module.exports = router;
