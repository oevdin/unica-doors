// Касса: счета, приход, расход, перевод между счетами
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { int, str, isAdmin, dateRange } = require('../lib');
const { getCategories } = require('./settings');

const router = express.Router();
router.use(requireAuth);

// служебные статьи — создаются автоматически, вручную их не выбирают
const SYSTEM = ['Продажа', 'Оплата долга', 'Возврат покупателю', 'Закуп товара', 'Возврат от поставщика', 'Перевод'];

function balances() {
  return db.prepare(`SELECT a.*,
      COALESCE((SELECT SUM(amount) FROM cash_ops WHERE account_id = a.id AND type = 'in'), 0)
    - COALESCE((SELECT SUM(amount) FROM cash_ops WHERE account_id = a.id AND type IN ('out','transfer')), 0)
    + COALESCE((SELECT SUM(amount) FROM cash_ops WHERE to_account_id = a.id AND type = 'transfer'), 0) AS balance
    FROM accounts a WHERE a.active = 1 ORDER BY a.sort, a.id`).all();
}

router.get('/accounts', (req, res) => res.json(balances()));
router.post('/accounts', requireAdmin, (req, res) => {
  const name = str(req.body.name);
  if (!name) return res.status(400).json({ error: 'name_required' });
  const kind = req.body.kind === 'bank' ? 'bank' : 'cash';
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 s FROM accounts').get().s;
  db.prepare('INSERT INTO accounts (name, kind, sort) VALUES (?,?,?)').run(name, kind, sort);
  res.status(201).json(balances());
});
router.patch('/accounts/:id', requireAdmin, (req, res) => {
  if (req.body.name !== undefined) db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(str(req.body.name), req.params.id);
  if (req.body.active !== undefined) db.prepare('UPDATE accounts SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, req.params.id);
  res.json(balances());
});

// GET /api/cash/ops?from&to&type&account_id&category
router.get('/ops', (req, res) => {
  const { from, to, type, account_id, category } = req.query;
  const w = [], p = [];
  dateRange('o', from, to, w, p);
  if (['in', 'out', 'transfer'].includes(type)) { w.push('o.type = ?'); p.push(type); }
  if (account_id) { w.push('(o.account_id = ? OR o.to_account_id = ?)'); p.push(Number(account_id), Number(account_id)); }
  if (category) { w.push('o.category = ?'); p.push(category); }
  if (!isAdmin(req)) { w.push('o.user_id = ?'); p.push(req.user.id); }
  const rows = db.prepare(`SELECT o.*, ${db.local('o.created_at')} AS local_at, a.name AS account_name, t.name AS to_account_name,
      u.name AS user_name, c.name AS contact_name
    FROM cash_ops o JOIN accounts a ON a.id = o.account_id LEFT JOIN accounts t ON t.id = o.to_account_id
    LEFT JOIN users u ON u.id = o.user_id LEFT JOIN contacts c ON c.id = o.contact_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 1000`).all(...p);
  const sum = (t) => rows.filter(r => r.type === t).reduce((s, r) => s + r.amount, 0);
  res.json({ ops: rows, total_in: sum('in'), total_out: sum('out'), accounts: balances() });
});

// приход / расход / перевод вручную
router.post('/ops', (req, res) => {
  const b = req.body || {};
  const type = b.type;
  const amount = int(b.amount);
  const acc = int(b.account_id);
  if (!['in', 'out', 'transfer'].includes(type) || !(amount > 0) || !acc) return res.status(400).json({ error: 'bad_op' });
  let category = str(b.category);
  if (type === 'transfer') {
    const to = int(b.to_account_id);
    if (!to || to === acc) return res.status(400).json({ error: 'bad_transfer' });
    db.prepare("INSERT INTO cash_ops (type, account_id, to_account_id, amount, category, user_id, note) VALUES ('transfer',?,?,?,'Перевод',?,?)")
      .run(acc, to, amount, req.user.id, str(b.note) || null);
  } else {
    const cats = getCategories();
    const allowed = type === 'in' ? cats.income : cats.expense;
    if (!allowed.includes(category)) category = type === 'in' ? 'Прочий приход' : 'Прочие расходы';
    db.prepare('INSERT INTO cash_ops (type, account_id, amount, category, contact_id, user_id, note) VALUES (?,?,?,?,?,?,?)')
      .run(type, acc, amount, category, b.contact_id ? int(b.contact_id) : null, req.user.id, str(b.note) || null);
  }
  res.status(201).json({ accounts: balances() });
});

// удалить можно только ручную операцию (не продажу/закуп) — администратору
router.delete('/ops/:id', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM cash_ops WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  if (o.sale_id || o.purchase_id) return res.status(409).json({ error: 'linked_op' });
  db.prepare('DELETE FROM cash_ops WHERE id = ?').run(o.id);
  res.json({ ok: true, accounts: balances() });
});

module.exports = router;
module.exports.SYSTEM = SYSTEM;
module.exports.balances = balances;
