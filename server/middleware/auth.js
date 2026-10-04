const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'unica-dev-secret-change-me';

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'invalid_token' }); }
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}
function signToken(u) {
  return jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role }, JWT_SECRET, { expiresIn: '60d' });
}
module.exports = { requireAuth, requireAdmin, signToken };
