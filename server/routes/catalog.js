// Разделы, товары, остатки, инвентаризация
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { int, num, str, isAdmin, moveStock } = require('../lib');

const router = express.Router();
router.use(requireAuth);

const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function normOptions(raw) {
  if (raw === undefined) return undefined;
  let o = raw;
  if (typeof raw === 'string') { try { o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const vals = (Array.isArray(v) ? v : []).map(str).filter(Boolean);
    if (str(k) && vals.length) out[str(k)] = vals;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
// продавцу не показываем себестоимость
const view = (req) => (p) => {
  if (!p || isAdmin(req)) return p;
  const { cost, ...rest } = p; return rest;
};

/* ---------- разделы ---------- */
router.get('/categories', (req, res) => {
  res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS count
    FROM categories c ORDER BY sort, id`).all());
});
router.post('/categories', requireAdmin, (req, res) => {
  const name = str(req.body.name);
  if (!name) return res.status(400).json({ error: 'name_required' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 s FROM categories').get().s;
  const info = db.prepare('INSERT INTO categories (name, icon, sort) VALUES (?,?,?)').run(name, str(req.body.icon) || 'box', sort);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});
router.patch('/categories/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  const f = [], v = [];
  if (b.name !== undefined) { f.push('name = ?'); v.push(str(b.name)); }
  if (b.icon !== undefined) { f.push('icon = ?'); v.push(str(b.icon) || 'box'); }
  if (b.sort !== undefined) { f.push('sort = ?'); v.push(int(b.sort)); }
  if (f.length) { v.push(req.params.id); db.prepare(`UPDATE categories SET ${f.join(', ')} WHERE id = ?`).run(...v); }
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});
router.delete('/categories/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- товары ---------- */
router.get('/products', (req, res) => {
  const { q, category_id, low, all } = req.query;
  const w = [], p = [];
  if (!all) w.push('p.active = 1');
  if (category_id) { w.push('p.category_id = ?'); p.push(Number(category_id)); }
  if (q) { w.push('(p.name LIKE ? OR p.sku LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  if (low) w.push('p.stock <= p.min_stock');
  const rows = db.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY c.sort, p.name COLLATE NOCASE`).all(...p);
  res.json(rows.map(view(req)));
});
router.get('/products/:id', (req, res) => {
  const p = db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const moves = db.prepare(`SELECT m.*, ${db.local('m.created_at')} AS local_at, u.name AS user_name FROM stock_moves m
    LEFT JOIN users u ON u.id = m.user_id WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 50`).all(p.id);
  const sold30 = db.prepare(`SELECT COALESCE(SUM(i.qty),0) q FROM sale_items i JOIN sales s ON s.id = i.sale_id
    WHERE i.product_id = ? AND s.status = 'done' AND s.created_at >= datetime('now','-30 days')`).get(p.id).q;
  res.json({ ...view(req)(p), moves, sold30 });
});

function productFields(b) {
  const out = {};
  if (b.name !== undefined) out.name = str(b.name);
  if (b.category_id !== undefined) out.category_id = b.category_id ? int(b.category_id) : null;
  if (b.sku !== undefined) out.sku = str(b.sku) || null;
  if (b.unit !== undefined) out.unit = str(b.unit) || 'шт';
  if (b.price !== undefined) out.price = Math.max(0, int(b.price));
  if (b.cost !== undefined) out.cost = Math.max(0, int(b.cost));
  if (b.min_stock !== undefined) out.min_stock = Math.max(0, num(b.min_stock));
  if (b.options !== undefined) out.options = normOptions(b.options);
  if (b.active !== undefined) out.active = b.active === true || b.active === '1' || b.active === 1 ? 1 : 0;
  return out;
}

router.post('/products', requireAdmin, upload.single('photo'), async (req, res) => {
  const f = productFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: 'name_required' });
  if (req.file) f.photo = await savePhoto(req.file.buffer);
  const keys = Object.keys(f);
  const info = db.prepare(`INSERT INTO products (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => f[k]));
  const startStock = num(req.body.stock);
  if (startStock) moveStock(info.lastInsertRowid, startStock, 'adjust', null, req.user.id, 'Начальный остаток');
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});
router.patch('/products/:id', requireAdmin, upload.single('photo'), async (req, res) => {
  const ex = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'not_found' });
  const f = productFields(req.body || {});
  if (req.file) { f.photo = await savePhoto(req.file.buffer); removePhoto(ex.photo); }
  const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE products SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map(k => f[k]), ex.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(ex.id));
});
router.delete('/products/:id', requireAdmin, (req, res) => {
  // товары с историей не удаляем, а скрываем — чтобы отчёты не «поехали»
  const used = db.prepare('SELECT 1 FROM sale_items WHERE product_id = ? UNION SELECT 1 FROM purchase_items WHERE product_id = ? LIMIT 1').get(req.params.id, req.params.id);
  if (used) db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  else db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true, hidden: !!used });
});

// инвентаризация: задать фактический остаток
router.post('/products/:id/adjust', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const actual = num(req.body.actual, NaN);
  if (!Number.isFinite(actual) || actual < 0) return res.status(400).json({ error: 'bad_qty' });
  const delta = Math.round((actual - p.stock) * 1000) / 1000;
  if (delta) moveStock(p.id, delta, 'adjust', null, req.user.id, str(req.body.note) || 'Инвентаризация');
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(p.id));
});

async function savePhoto(buf) {
  const name = `p${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
  await sharp(buf).rotate().resize(720, 720, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toFile(path.join(UPLOAD_DIR, name));
  return '/uploads/' + name;
}
function removePhoto(p) {
  if (!p || !p.startsWith('/uploads/')) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(p))); } catch (e) {}
}

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
