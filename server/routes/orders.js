const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['new', 'confirmed', 'shipped', 'done', 'cancelled'];

function loadOrderWithItems(id) {
  const order = db.prepare(`
    SELECT o.*, c.name AS contractor_name, c.phone AS contractor_phone, c.address AS contractor_address,
           c.contact_person AS contractor_contact, u.name AS created_by_name
    FROM orders o
    JOIN contractors c ON c.id = o.contractor_id
    LEFT JOIN users u ON u.id = o.created_by
    WHERE o.id = ?
  `).get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  order.total = order.items.reduce((sum, it) => sum + (it.price || 0) * it.qty, 0);
  return order;
}

// GET /api/orders?status=&contractor_id=&q=
router.get('/', (req, res) => {
  const { status, contractor_id, q } = req.query;
  let sql = `
    SELECT o.*, c.name AS contractor_name, u.name AS created_by_name
    FROM orders o
    JOIN contractors c ON c.id = o.contractor_id
    LEFT JOIN users u ON u.id = o.created_by
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (contractor_id) { sql += ' AND o.contractor_id = ?'; params.push(Number(contractor_id)); }
  if (q) { sql += ' AND c.name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY o.created_at DESC';

  const rows = db.prepare(sql).all(...params);
  const ids = rows.map(r => r.id);
  let itemsByOrder = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`).all(...ids);
    for (const it of items) {
      (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
    }
  }
  const result = rows.map(r => {
    const items = itemsByOrder[r.id] || [];
    return { ...r, items, total: items.reduce((s, it) => s + (it.price || 0) * it.qty, 0) };
  });
  res.json(result);
});

router.get('/:id', (req, res) => {
  const order = loadOrderWithItems(req.params.id);
  if (!order) return res.status(404).json({ error: 'not_found' });
  res.json(order);
});

// POST /api/orders  { contractor_id, note, items: [{product_id?, product_name, price, qty}] }
router.post('/', (req, res) => {
  const { contractor_id, note, items } = req.body || {};
  if (!contractor_id) return res.status(400).json({ error: 'contractor_id_required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items_required' });

  const contractor = db.prepare('SELECT id FROM contractors WHERE id = ?').get(contractor_id);
  if (!contractor) return res.status(400).json({ error: 'invalid_contractor' });

  const createOrder = db.transaction(() => {
    const info = db.prepare('INSERT INTO orders (contractor_id, note, created_by) VALUES (?,?,?)')
      .run(contractor_id, note || null, req.user.id);
    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, price, qty, unit) VALUES (?,?,?,?,?,?)
    `);
    for (const it of items) {
      if (!it.product_name) throw new Error('item_name_required');
      insertItem.run(orderId, it.product_id || null, it.product_name, it.price ?? null, it.qty || 1, it.unit || 'шт');
    }
    return orderId;
  });

  try {
    const orderId = createOrder();
    res.status(201).json(loadOrderWithItems(orderId));
  } catch (e) {
    res.status(400).json({ error: 'invalid_items' });
  }
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { status, note, items } = req.body || {};
  const fields = [];
  const values = [];

  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    fields.push('status = ?'); values.push(status);
  }
  if (note !== undefined) { fields.push('note = ?'); values.push(note); }

  const applyUpdate = db.transaction(() => {
    if (fields.length) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    if (Array.isArray(items)) {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, price, qty, unit) VALUES (?,?,?,?,?,?)
      `);
      for (const it of items) {
        insertItem.run(id, it.product_id || null, it.product_name, it.price ?? null, it.qty || 1, it.unit || 'шт');
      }
      db.prepare("UPDATE orders SET updated_at = datetime('now') WHERE id = ?").run(id);
    }
  });
  applyUpdate();

  res.json(loadOrderWithItems(id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
