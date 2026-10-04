const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();
const ROLES = ['admin', 'seller'];

router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'missing_fields' });
  const u = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(String(login).trim());
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'invalid_credentials' });
  res.json({ token: signToken(u), user: { id: u.id, name: u.name, login: u.login, role: u.role } });
});

router.get('/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id, name, login, role FROM users WHERE id = ? AND active = 1').get(req.user.id);
  if (!u) return res.status(401).json({ error: 'gone' });
  res.json(u);
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: 'password_too_short' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword || '', u.password_hash)) return res.status(401).json({ error: 'wrong_current_password' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), u.id);
  res.json({ ok: true });
});

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, login, role, active, created_at FROM users ORDER BY id').all());
});
router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { name, login, password, role } = req.body || {};
  if (!name || !login || !password) return res.status(400).json({ error: 'missing_fields' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
  if (db.prepare('SELECT id FROM users WHERE login = ?').get(String(login).trim())) return res.status(409).json({ error: 'login_taken' });
  const info = db.prepare('INSERT INTO users (name, login, password_hash, role) VALUES (?,?,?,?)')
    .run(String(name).trim(), String(login).trim(), bcrypt.hashSync(password, 10), role);
  res.status(201).json({ id: info.lastInsertRowid });
});
router.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, role, active, password } = req.body || {};
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'not_found' });
  if (id === req.user.id && (active === 0 || active === false || (role && role !== 'admin'))) return res.status(400).json({ error: 'cannot_demote_self' });
  const f = [], v = [];
  if (name !== undefined) { f.push('name = ?'); v.push(String(name).trim()); }
  if (role !== undefined) { if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' }); f.push('role = ?'); v.push(role); }
  if (active !== undefined) { f.push('active = ?'); v.push(active ? 1 : 0); }
  if (password) { f.push('password_hash = ?'); v.push(bcrypt.hashSync(password, 10)); }
  if (f.length) { v.push(id); db.prepare(`UPDATE users SET ${f.join(', ')} WHERE id = ?`).run(...v); }
  res.json({ ok: true });
});

module.exports = router;
