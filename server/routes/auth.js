const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'missing_fields' });

  const user = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(login.trim());
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, login: user.login, role: user.role },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, login, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json(user);
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing_fields' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'password_too_short' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'wrong_current_password' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

/* ---- admin: manage users ---- */

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, login, role, active, created_at FROM users ORDER BY id').all();
  res.json(users);
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { name, login, password, role } = req.body || {};
  if (!name || !login || !password) return res.status(400).json({ error: 'missing_fields' });
  if (!['admin', 'manager'].includes(role)) return res.status(400).json({ error: 'invalid_role' });

  const exists = db.prepare('SELECT id FROM users WHERE login = ?').get(login.trim());
  if (exists) return res.status(409).json({ error: 'login_taken' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, login, password_hash, role) VALUES (?,?,?,?)')
    .run(name.trim(), login.trim(), hash, role);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, role, active, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  if (id === req.user.id && active === 0) {
    return res.status(400).json({ error: 'cannot_deactivate_self' });
  }

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (role !== undefined) {
    if (!['admin', 'manager'].includes(role)) return res.status(400).json({ error: 'invalid_role' });
    fields.push('role = ?'); values.push(role);
  }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (password) { fields.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10)); }
  if (fields.length === 0) return res.json({ ok: true });

  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
