const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'unica-dev-secret-change-me';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, login: user.login, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

module.exports = { requireAuth, requireAdmin, signToken, JWT_SECRET };
