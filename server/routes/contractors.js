const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/contractors?q=search
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM contractors
      WHERE name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR email LIKE ?
      ORDER BY name COLLATE NOCASE
    `).all(like, like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM contractors ORDER BY name COLLATE NOCASE').all();
  }
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM contractors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { name, contact_person, phone, email, address, note } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });
  const info = db.prepare(`
    INSERT INTO contractors (name, contact_person, phone, email, address, note, created_by)
    VALUES (?,?,?,?,?,?,?)
  `).run(name.trim(), contact_person || null, phone || null, email || null, address || null, note || null, req.user.id);
  const row = db.prepare('SELECT * FROM contractors WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM contractors WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, contact_person, phone, email, address, note } = req.body || {};
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (contact_person !== undefined) { fields.push('contact_person = ?'); values.push(contact_person); }
  if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (address !== undefined) { fields.push('address = ?'); values.push(address); }
  if (note !== undefined) { fields.push('note = ?'); values.push(note); }
  fields.push("updated_at = datetime('now')");

  values.push(id);
  db.prepare(`UPDATE contractors SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM contractors WHERE id = ?').get(id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE contractor_id = ?').get(id).c;
  if (orderCount > 0) {
    return res.status(409).json({ error: 'has_orders', message: 'У контрагента есть заявки — сначала удалите или перенесите их.' });
  }
  db.prepare('DELETE FROM contractors WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
