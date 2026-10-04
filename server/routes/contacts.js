// Клиенты и поставщики: карточка, история, долги
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { str, isAdmin } = require('../lib');

const router = express.Router();
router.use(requireAuth);

const CLIENT_STATS = `
  (SELECT COUNT(*) FROM sales s WHERE s.contact_id = c.id AND s.status = 'done') AS orders,
  (SELECT COALESCE(SUM(total),0) FROM sales s WHERE s.contact_id = c.id AND s.status = 'done') AS spent,
  (SELECT MAX(${db.local('s.created_at')}) FROM sales s WHERE s.contact_id = c.id AND s.status = 'done') AS last_at,
  (SELECT COALESCE(SUM(s.total),0) - COALESCE((SELECT SUM(CASE WHEN o.type='in' THEN o.amount ELSE -o.amount END) FROM cash_ops o JOIN sales s2 ON s2.id = o.sale_id WHERE s2.contact_id = c.id AND s2.status = 'done'),0)
     FROM sales s WHERE s.contact_id = c.id AND s.status = 'done') AS debt`;
const SUPPLIER_STATS = `
  (SELECT COUNT(*) FROM purchases p WHERE p.contact_id = c.id AND p.status = 'done') AS orders,
  (SELECT COALESCE(SUM(total),0) FROM purchases p WHERE p.contact_id = c.id AND p.status = 'done') AS spent,
  (SELECT MAX(${db.local('p.created_at')}) FROM purchases p WHERE p.contact_id = c.id AND p.status = 'done') AS last_at,
  (SELECT COALESCE(SUM(p.total),0) - COALESCE((SELECT SUM(CASE WHEN o.type='out' THEN o.amount ELSE -o.amount END) FROM cash_ops o JOIN purchases p2 ON p2.id = o.purchase_id WHERE p2.contact_id = c.id AND p2.status = 'done'),0)
     FROM purchases p WHERE p.contact_id = c.id AND p.status = 'done') AS debt`;

router.get('/', (req, res) => {
  const type = req.query.type === 'supplier' ? 'supplier' : 'client';
  if (type === 'supplier' && !isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const w = ['c.type = ?'], p = [type];
  if (req.query.q) { w.push('(c.name LIKE ? OR c.phone LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  let rows = db.prepare(`SELECT c.*, ${type === 'client' ? CLIENT_STATS : SUPPLIER_STATS} FROM contacts c WHERE ${w.join(' AND ')}
    ORDER BY last_at IS NULL, last_at DESC, c.name COLLATE NOCASE LIMIT 1000`).all(...p);
  if (req.query.debt) rows = rows.filter(r => r.debt > 0);
  if (!isAdmin(req)) rows = rows.map(({ spent, ...r }) => r);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  if (c.type === 'supplier' && !isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const stats = db.prepare(`SELECT ${c.type === 'client' ? CLIENT_STATS : SUPPLIER_STATS} FROM contacts c WHERE c.id = ?`).get(c.id);
  res.json({ ...c, ...stats });
});

router.post('/', (req, res) => {
  const name = str(req.body.name);
  if (!name) return res.status(400).json({ error: 'name_required' });
  const type = req.body.type === 'supplier' ? 'supplier' : 'client';
  if (type === 'supplier' && !isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const id = db.prepare('INSERT INTO contacts (type, name, phone, note) VALUES (?,?,?,?)').run(type, name, str(req.body.phone) || null, str(req.body.note) || null).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});
router.patch('/:id', (req, res) => {
  const b = req.body || {};
  const f = [], v = [];
  for (const k of ['name', 'phone', 'note']) if (b[k] !== undefined) { f.push(k + ' = ?'); v.push(str(b[k]) || null); }
  if (f.length) { v.push(req.params.id); db.prepare(`UPDATE contacts SET ${f.join(', ')} WHERE id = ?`).run(...v); }
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id));
});
router.delete('/:id', requireAdmin, (req, res) => {
  const used = db.prepare('SELECT 1 FROM sales WHERE contact_id = ? UNION SELECT 1 FROM purchases WHERE contact_id = ? LIMIT 1').get(req.params.id, req.params.id);
  if (used) return res.status(409).json({ error: 'has_history' });
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
