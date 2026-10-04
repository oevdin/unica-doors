const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Реквизиты для шапки накладной и чека
const KEYS = ['company_name', 'company_sub', 'company_inn', 'company_address', 'company_phone', 'receipt_footer'];
const DEFAULTS = {
  company_name: 'UNICA Doors',
  company_sub: 'Межкомнатные и металлические двери, комплектующие',
  company_inn: '',
  company_address: '',
  company_phone: '',
  receipt_footer: 'Спасибо за покупку!',
};

function readAll() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (KEYS.includes(r.key)) out[r.key] = r.value ?? '';
  }
  return out;
}

router.get('/', requireAuth, (req, res) => res.json(readAll()));

router.put('/', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const k of KEYS) if (b[k] !== undefined) up.run(k, String(b[k]).trim());
  })();
  res.json(readAll());
});

module.exports = router;
