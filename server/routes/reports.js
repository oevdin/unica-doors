// Аналитика для владельца: ВП, маржа, наценка, расходы, чистая прибыль, ABC, деньги, склад, долги
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isDate } = require('../lib');
const { balances } = require('./cash');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// не являются операционными расходами: закуп (это товар), возвраты, переводы, изъятие владельца
const NOT_OPEX = ['Закуп товара', 'Возврат покупателю', 'Изъятие владельцем'];
const notOpexSql = NOT_OPEX.map(() => '?').join(',');

function shiftDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5) + 1; }

function core(from, to) {
  const LS = db.local('s.created_at'), LO = db.local('o.created_at');
  const S = `s.status = 'done' AND date(${LS}) BETWEEN ? AND ?`;
  const k = db.prepare(`SELECT COUNT(*) sales, COALESCE(SUM(total),0) revenue, COALESCE(SUM(cost_total),0) cost, COALESCE(SUM(discount),0) discount
    FROM sales s WHERE ${S}`).get(from, to);
  k.units = db.prepare(`SELECT COALESCE(SUM(i.qty),0) u FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${S}`).get(from, to).u;
  k.opex = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM cash_ops o WHERE o.type = 'out' AND o.category NOT IN (${notOpexSql}) AND date(${LO}) BETWEEN ? AND ?`).get(...NOT_OPEX, from, to).v;
  k.withdrawn = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM cash_ops o WHERE o.type = 'out' AND o.category = 'Изъятие владельцем' AND date(${LO}) BETWEEN ? AND ?`).get(from, to).v;
  k.gp = k.revenue - k.cost;
  k.net = k.gp - k.opex;
  k.margin = k.revenue ? k.gp / k.revenue * 100 : 0;
  k.markup = k.cost ? k.gp / k.cost * 100 : 0;
  k.net_margin = k.revenue ? k.net / k.revenue * 100 : 0;
  k.avg = k.sales ? Math.round(k.revenue / k.sales) : 0;
  return k;
}

router.get('/summary', (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from_to_required' });
  const LS = db.local('s.created_at'), LO = db.local('o.created_at');
  const S = `s.status = 'done' AND date(${LS}) BETWEEN ? AND ?`;
  const P = [from, to];

  const kpi = core(from, to);
  const len = daysBetween(from, to);
  const prev = core(shiftDays(from, -len), shiftDays(from, -1));

  const days = db.prepare(`SELECT date(${LS}) day, COUNT(*) sales, SUM(total) revenue, SUM(cost_total) cost FROM sales s WHERE ${S} GROUP BY day`).all(...P);
  const opexDays = db.prepare(`SELECT date(${LO}) day, SUM(amount) opex FROM cash_ops o WHERE o.type='out' AND o.category NOT IN (${notOpexSql}) AND date(${LO}) BETWEEN ? AND ? GROUP BY day`).all(...NOT_OPEX, ...P);
  const cashDays = db.prepare(`SELECT date(${LO}) day, SUM(CASE WHEN type='in' THEN amount ELSE 0 END) cin, SUM(CASE WHEN type='out' THEN amount ELSE 0 END) cout
    FROM cash_ops o WHERE date(${LO}) BETWEEN ? AND ? GROUP BY day`).all(...P);

  // скидка распределяется по строкам пропорционально сумме строки
  const lineRev = `(i.price * i.qty) * (CASE WHEN s.subtotal > 0 THEN s.total * 1.0 / s.subtotal ELSE 1 END)`;
  const products = db.prepare(`SELECT COALESCE(i.product_id, -i.id) pid, MAX(i.name) name, MAX(i.unit) unit, SUM(i.qty) qty,
      ROUND(SUM(${lineRev})) revenue, ROUND(SUM(${lineRev} - i.cost * i.qty)) gp
    FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${S} GROUP BY pid ORDER BY revenue DESC`).all(...P);
  // ABC: A — товары, дающие первые 80% выручки, B — следующие 15%, C — остальное
  const totalRev = products.reduce((a, r) => a + r.revenue, 0) || 1;
  let acc = 0;
  for (const r of products) { acc += r.revenue; const share = acc / totalRev; r.abc = share <= 0.8 || r === products[0] ? 'A' : share <= 0.95 ? 'B' : 'C'; r.share = r.revenue / totalRev * 100; }
  const abc = ['A', 'B', 'C'].map(c => { const l = products.filter(r => r.abc === c); return { cls: c, count: l.length, revenue: l.reduce((a, r) => a + r.revenue, 0), gp: l.reduce((a, r) => a + r.gp, 0) }; });

  const categories = db.prepare(`SELECT COALESCE(c.name,'Без раздела') name, SUM(i.qty) qty, ROUND(SUM(${lineRev})) revenue, ROUND(SUM(${lineRev} - i.cost * i.qty)) gp
    FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN categories c ON c.id = i.category_id WHERE ${S} GROUP BY i.category_id ORDER BY revenue DESC`).all(...P);
  const sellers = db.prepare(`SELECT COALESCE(u.name,'—') name, COUNT(*) sales, SUM(total) revenue, SUM(total - cost_total) gp
    FROM sales s LEFT JOIN users u ON u.id = s.seller_id WHERE ${S} GROUP BY s.seller_id ORDER BY revenue DESC`).all(...P);
  const hours = db.prepare(`SELECT CAST(strftime('%H', ${LS}) AS INTEGER) hour, COUNT(*) sales, SUM(total) revenue FROM sales s WHERE ${S} GROUP BY hour`).all(...P);
  const weekdays = db.prepare(`SELECT CAST(strftime('%w', ${LS}) AS INTEGER) wd, COUNT(*) sales, SUM(total) revenue FROM sales s WHERE ${S} GROUP BY wd`).all(...P);
  const expenses = db.prepare(`SELECT category, SUM(amount) amount, COUNT(*) n FROM cash_ops o WHERE o.type='out' AND o.category NOT IN (${notOpexSql}) AND date(${LO}) BETWEEN ? AND ?
    GROUP BY category ORDER BY amount DESC`).all(...NOT_OPEX, ...P);
  const cashflow = db.prepare(`SELECT type, category, SUM(amount) amount FROM cash_ops o WHERE o.type IN ('in','out') AND date(${LO}) BETWEEN ? AND ? GROUP BY type, category ORDER BY amount DESC`).all(...P);

  const receivables = db.prepare(`SELECT s.id, COALESCE(c.name, s.customer_name, 'Без имени') name, c.phone, c.id contact_id, ${LS} local_at,
      s.total - COALESCE((SELECT SUM(CASE WHEN o.type='in' THEN o.amount ELSE -o.amount END) FROM cash_ops o WHERE o.sale_id = s.id),0) debt
    FROM sales s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.status = 'done' AND debt > 0 ORDER BY s.id`).all();
  const payables = db.prepare(`SELECT p.id, COALESCE(c.name,'Поставщик') name, c.id contact_id, ${db.local('p.created_at')} local_at,
      p.total - COALESCE((SELECT SUM(CASE WHEN o.type='out' THEN o.amount ELSE -o.amount END) FROM cash_ops o WHERE o.purchase_id = p.id),0) debt
    FROM purchases p LEFT JOIN contacts c ON c.id = p.contact_id WHERE p.status = 'done' AND debt > 0 ORDER BY p.id`).all();
  const stock = db.prepare(`SELECT COUNT(*) items, COALESCE(SUM(CASE WHEN stock > 0 THEN stock * cost END),0) at_cost, COALESCE(SUM(CASE WHEN stock > 0 THEN stock * price END),0) at_price,
      SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END) low FROM products WHERE active = 1`).get();
  const noCost = db.prepare(`SELECT COUNT(*) n FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${S} AND i.cost = 0`).get(...P).n;

  res.json({ from, to, kpi, prev, days, opexDays, cashDays, products: products.slice(0, 50), abc, categories, sellers, hours, weekdays,
    expenses, cashflow, receivables, payables, stock, accounts: balances(), no_cost_lines: noCost });
});

module.exports = router;
