// Реквизиты компании и статьи прихода/расхода
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { str } = require('../lib');

const router = express.Router();

const DEFAULTS = {
  company_name: 'UNICA Doors',
  company_sub: 'Межкомнатные и металлические двери, комплектующие',
  company_inn: '',
  company_address: '',
  company_phone: '',
  receipt_footer: 'Спасибо за покупку!',
  income_categories: JSON.stringify(['Внесение в кассу', 'Прочий приход']),
  expense_categories: JSON.stringify(['Аренда', 'Зарплата', 'Доставка и транспорт', 'Налоги и сборы', 'Связь и интернет', 'Хозяйственные нужды', 'Реклама', 'Изъятие владельцем', 'Прочие расходы']),
};

function readAll() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (r.key in DEFAULTS) out[r.key] = r.value ?? '';
  return out;
}
function getCategories() {
  const s = readAll();
  const parse = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter(Boolean) : []; } catch (e) { return []; } };
  const income = parse(s.income_categories);
  const expense = parse(s.expense_categories);
  if (!income.includes('Прочий приход')) income.push('Прочий приход');
  if (!expense.includes('Прочие расходы')) expense.push('Прочие расходы');
  return { income, expense };
}
function publicSettings() {
  const s = readAll();
  const c = getCategories();
  return { ...s, income_categories: c.income, expense_categories: c.expense };
}

router.get('/', requireAuth, (req, res) => res.json(publicSettings()));
router.put('/', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const k of Object.keys(DEFAULTS)) {
      if (b[k] === undefined) continue;
      if (k.endsWith('_categories')) {
        const arr = (Array.isArray(b[k]) ? b[k] : String(b[k]).split('\n')).map(str).filter(Boolean);
        up.run(k, JSON.stringify([...new Set(arr)]));
      } else up.run(k, str(b[k]));
    }
  })();
  res.json(publicSettings());
});

module.exports = router;
module.exports.getCategories = getCategories;
