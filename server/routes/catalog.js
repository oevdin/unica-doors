const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { requireAuth, requireAdmin, JWT_SECRET } = require('../middleware/auth');

// catalog reads are public; себестоимость is only returned to an admin
function isAdminRequest(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return false;
  try { return jwt.verify(h.slice(7), JWT_SECRET).role === 'admin'; } catch (e) { return false; }
}
function publicProduct(p, admin) {
  if (!p || admin) return p;
  const { cost, ...rest } = p;
  return rest;
}
function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

const router = express.Router();

const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads', 'products')
  : path.join(__dirname, '..', '..', 'public', 'uploads', 'products');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// options arrive as JSON text from the admin form; keep only {group: [non-empty strings]}
function normalizeOptions(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).trim();
    const vals = (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean);
    if (key && vals.length) out[key] = vals;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

/* ---------- categories (public read, admin write) ---------- */

router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  res.json(rows);
});

router.post('/categories', requireAuth, requireAdmin, (req, res) => {
  const { name, icon } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });
  let slug = slugify(name);
  let unique = slug, n = 2;
  while (db.prepare('SELECT id FROM categories WHERE slug = ?').get(unique)) {
    unique = `${slug}-${n++}`;
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories').get().m;
  const info = db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?,?,?,?)')
    .run(name.trim(), unique, icon || 'box', maxOrder + 1);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/categories/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const { name, icon, sort_order } = req.body || {};
  const fields = [], values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
  if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
  if (fields.length) {
    values.push(id);
    db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});

router.delete('/categories/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- products (public read, admin write) ---------- */

router.get('/products', (req, res) => {
  const { category_id, q } = req.query;
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];
  if (category_id) { sql += ' AND category_id = ?'; params.push(Number(category_id)); }
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY name COLLATE NOCASE';
  const admin = isAdminRequest(req);
  res.json(db.prepare(sql).all(...params).map(p => publicProduct(p, admin)));
});

router.post('/products', requireAuth, requireAdmin, upload.single('photo'), async (req, res) => {
  const { name, price, category_id, description, unit, options, cost } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });
  if (!category_id) return res.status(400).json({ error: 'category_id_required' });

  let photoPath = null;
  if (req.file) {
    photoPath = await saveProductPhoto(req.file.buffer);
  }

  const info = db.prepare('INSERT INTO products (category_id, name, price, photo, description, unit, options, cost) VALUES (?,?,?,?,?,?,?,?)')
    .run(Number(category_id), name.trim(), price ? Number(price) : null, photoPath, description || null,
      (unit && unit.trim()) || 'шт', normalizeOptions(options) ?? null, toIntOrNull(cost));
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/products/:id', requireAuth, requireAdmin, upload.single('photo'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { name, price, category_id, description, unit, options, cost } = req.body || {};
  const fields = [], values = [];
  if (cost !== undefined) { fields.push('cost = ?'); values.push(toIntOrNull(cost)); }
  if (unit !== undefined) { fields.push('unit = ?'); values.push((unit && unit.trim()) || 'шт'); }
  if (options !== undefined) { fields.push('options = ?'); values.push(normalizeOptions(options)); }
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (price !== undefined) { fields.push('price = ?'); values.push(price === '' ? null : Number(price)); }
  if (category_id !== undefined) { fields.push('category_id = ?'); values.push(Number(category_id)); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }

  if (req.file) {
    const photoPath = await saveProductPhoto(req.file.buffer);
    fields.push('photo = ?'); values.push(photoPath);
    if (existing.photo) removeOldPhoto(existing.photo);
  }

  if (fields.length) {
    values.push(id);
    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

router.delete('/products/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (existing && existing.photo) removeOldPhoto(existing.photo);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

async function saveProductPhoto(buffer) {
  const fname = `p${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const outPath = path.join(UPLOAD_DIR, fname);
  await sharp(buffer)
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toFile(outPath);
  return `/uploads/products/${fname}`;
}

function removeOldPhoto(photoPath) {
  try {
    const abs = path.join(__dirname, '..', '..', 'public', photoPath.replace(/^\//, ''));
    if (abs.startsWith(UPLOAD_DIR) && fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) { /* ignore */ }
}

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
