// Демо-данные: закупки, продажи за 30 дней, расходы, долги. Удаляются одной кнопкой.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);
const MARK = '[демо]';

function ts(daysAgo, hourLocal, min) {
  const d = new Date(Date.now() - daysAgo * 864e5);
  d.setUTCHours(hourLocal - db.TZ_MIN / 60, min || 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

router.post('/fill', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active = 1 AND price > 0').all();
  if (!products.length) return res.status(400).json({ error: 'no_products' });
  if (db.prepare('SELECT 1 FROM sales WHERE demo = 1 LIMIT 1').get()) return res.status(409).json({ error: 'already' });
  const accs = db.prepare('SELECT * FROM accounts WHERE active = 1 ORDER BY sort').all();
  const cash = accs.find(a => a.kind === 'cash') || accs[0];
  const bank = accs.find(a => a.kind === 'bank') || accs[0];
  const users = db.prepare('SELECT * FROM users WHERE active = 1').all();
  const uid = req.user.id;

  const counts = db.transaction(() => {
    const op = db.prepare('INSERT INTO cash_ops (type, account_id, to_account_id, amount, category, sale_id, purchase_id, contact_id, user_id, note, demo, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)');
    const move = db.prepare('INSERT INTO stock_moves (product_id, delta, reason, ref_id, user_id, note, created_at) VALUES (?,?,?,?,?,?,?)');
    const addContact = (type, name, phone) => db.prepare('INSERT INTO contacts (type, name, phone, note) VALUES (?,?,?,?)').run(type, name, phone, MARK).lastInsertRowid;

    // стартовые деньги
    op.run('in', cash.id, null, 150000, 'Внесение в кассу', null, null, null, uid, 'Стартовый остаток ' + MARK, ts(32, 9));

    // поставщики и два прихода товара
    const sup = [addContact('supplier', 'ОсОО «ДверьСнаб»', '+996 555 120 340'), addContact('supplier', 'ИП Фурнитура Плюс', '+996 700 880 112')];
    let nPurch = 0;
    for (const [daysAgo, factor] of [[31, 1], [12, 0.5]]) {
      for (const s of sup) {
        const mine = products.filter(p => (s === sup[0]) === /двер|короб|налич|добор/i.test(p.name));
        const lines = mine.map(p => ({ p, qty: Math.max(3, Math.round((/двер/i.test(p.name) ? 18 : 45) * factor * (0.7 + Math.random() * 0.6))) }));
        const total = lines.reduce((a, l) => a + l.qty * l.p.cost, 0);
        const pid = db.prepare('INSERT INTO purchases (contact_id, user_id, total, demo, created_at) VALUES (?,?,?,1,?)').run(s, uid, total, ts(daysAgo, 10)).lastInsertRowid;
        for (const l of lines) {
          db.prepare('INSERT INTO purchase_items (purchase_id, product_id, name, qty, cost) VALUES (?,?,?,?,?)').run(pid, l.p.id, l.p.name, l.qty, l.p.cost);
          db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(l.qty, l.p.id);
          move.run(l.p.id, l.qty, 'purchase', pid, uid, null, ts(daysAgo, 10));
        }
        const paid = daysAgo === 12 && s === sup[0] ? Math.round(total * 0.6) : total; // часть второго прихода — в долг поставщику
        // владелец вкладывает деньги под первую закупку
        if (daysAgo === 31) op.run('in', bank.id, null, paid, 'Внесение в кассу', null, null, null, uid, 'Вложение владельца ' + MARK, ts(daysAgo, 9, 30));
        op.run('out', bank.id, null, paid, 'Закуп товара', null, pid, s, uid, null, ts(daysAgo, 11));
        nPurch++;
      }
    }

    // клиенты
    const names = [['Бакыт', '+996 700 111 222'], ['Айгуль', '+996 555 333 444'], ['Нурлан', '+996 707 555 666'], ['Эркин', '+996 772 777 888'],
      ['Гульнара', '+996 501 999 000'], ['Азамат', '+996 700 121 314'], ['ОсОО «Строй Дом»', '+996 312 66 77 88'], ['Мирлан', '+996 555 246 810']];
    const clients = names.map(([n, p]) => addContact('client', n, p));

    // продажи
    // остатки после приходов — продаём только то, что есть на складе
    const left = Object.fromEntries(db.prepare('SELECT id, stock FROM products').all().map(r => [r.id, r.stock]));
    const doors = products.filter(p => /двер/i.test(p.name));
    const parts = products.filter(p => !/двер/i.test(p.name));
    const insSale = db.prepare('INSERT INTO sales (seller_id, contact_id, customer_name, subtotal, discount, total, cost_total, demo, created_at) VALUES (?,?,?,?,?,?,?,1,?)');
    const insItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, category_id, name, variant, unit, qty, price, cost) VALUES (?,?,?,?,?,?,?,?,?)');
    let nSales = 0;
    for (let d = 29; d >= 0; d--) {
      const wd = new Date(Date.now() - d * 864e5).getDay();
      const n = Math.round((wd === 0 ? 2 : wd === 6 ? 8 : 4.5) * (0.6 + Math.random() * 0.8));
      for (let k = 0; k < n; k++) {
        const at = ts(d, 9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60));
        const lines = [];
        if (doors.length && Math.random() < 0.65) {
          const door = pick(doors), q = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 3) : 1;
          lines.push([door, q]);
          for (const p of parts) if (Math.random() < 0.3) lines.push([p, /Наличник/.test(p.name) ? q * 2 : q]);
        } else for (let j = 0; j < 1 + Math.floor(Math.random() * 3); j++) lines.push([pick(parts), 1 + Math.floor(Math.random() * 4)]);
        for (let j = lines.length - 1; j >= 0; j--) { const [p, q] = lines[j]; if ((left[p.id] || 0) < q) lines.splice(j, 1); }
        if (!lines.length) continue;
        for (const [p, q] of lines) left[p.id] -= q;
        const subtotal = lines.reduce((a, [p, q]) => a + p.price * q, 0);
        const discount = Math.random() < 0.25 ? Math.round(subtotal * 0.03 / 10) * 10 : 0;
        const total = subtotal - discount;
        const cost = lines.reduce((a, [p, q]) => a + p.cost * q, 0);
        const withClient = Math.random() < 0.45;
        const contact = withClient ? pick(clients) : null;
        const sid = insSale.run(pick(users).id, contact, null, subtotal, discount, total, cost, at).lastInsertRowid;
        for (const [p, q] of lines) {
          let variant = null;
          try { const o = p.options ? JSON.parse(p.options) : null; if (o) variant = Object.values(o).map(v => pick(v)).join(', '); } catch (e) {}
          insItem.run(sid, p.id, p.category_id, p.name, variant, p.unit, q, p.price, p.cost);
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(q, p.id);
          move.run(p.id, -q, 'sale', sid, uid, null, at);
        }
        const r = Math.random();
        if (contact && r < 0.12) {
          const part = Math.round(total * 0.4 / 100) * 100;
          if (part) op.run('in', cash.id, null, part, 'Продажа', sid, null, contact, uid, null, at);
          if (d > 7 && Math.random() < 0.6) op.run('in', cash.id, null, total - part, 'Оплата долга', sid, null, contact, uid, null, ts(d - 5, 15));
        } else op.run('in', r < 0.6 ? cash.id : bank.id, null, total, 'Продажа', sid, null, contact, uid, null, at);
        nSales++;
      }
    }

    // расходы
    const exp = [[28, 'Аренда', 25000, bank], [27, 'Связь и интернет', 1200, bank], [25, 'Доставка и транспорт', 3500, cash], [20, 'Хозяйственные нужды', 1800, cash],
      [18, 'Доставка и транспорт', 2800, cash], [15, 'Зарплата', 30000, cash], [13, 'Реклама', 5000, bank], [9, 'Доставка и транспорт', 4200, cash],
      [6, 'Хозяйственные нужды', 950, cash], [4, 'Налоги и сборы', 6000, bank], [1, 'Зарплата', 30000, cash], [14, 'Изъятие владельцем', 40000, cash]];
    for (const [d, c, a, acc] of exp) op.run('out', acc.id, null, a, c, null, null, null, uid, MARK, ts(d, 18));
    op.run('transfer', cash.id, bank.id, 100000, 'Перевод', null, null, null, uid, 'Сдали наличные в банк ' + MARK, ts(10, 19));
    return { sales: nSales, purchases: nPurch };
  })();
  res.json({ ok: true, ...counts });
});

router.post('/clear', (req, res) => {
  const r = db.transaction(() => {
    const sales = db.prepare('SELECT id FROM sales WHERE demo = 1').all().map(x => x.id);
    const purch = db.prepare('SELECT id FROM purchases WHERE demo = 1').all().map(x => x.id);
    const delMoves = db.prepare("DELETE FROM stock_moves WHERE ref_id = ? AND reason IN (?, 'cancel')");
    sales.forEach(id => delMoves.run(id, 'sale'));
    purch.forEach(id => delMoves.run(id, 'purchase'));
    db.prepare('DELETE FROM cash_ops WHERE demo = 1').run();
    db.prepare('DELETE FROM sales WHERE demo = 1').run();
    db.prepare('DELETE FROM purchases WHERE demo = 1').run();
    db.prepare(`DELETE FROM contacts WHERE note = ? AND id NOT IN (SELECT contact_id FROM sales WHERE contact_id IS NOT NULL UNION SELECT contact_id FROM purchases WHERE contact_id IS NOT NULL)`).run(MARK);
    db.prepare('UPDATE products SET stock = (SELECT COALESCE(SUM(delta),0) FROM stock_moves m WHERE m.product_id = products.id)').run();
    return { sales: sales.length, purchases: purch.length };
  })();
  res.json({ ok: true, ...r });
});

// полный сброс операций: продажи, приходы, касса, клиенты, движения — каталог товаров остаётся
router.post('/reset', (req, res) => {
  if (String((req.body || {}).confirm || '').trim().toUpperCase() !== 'УДАЛИТЬ') return res.status(400).json({ error: 'confirm_required' });
  db.transaction(() => {
    for (const t of ['cash_ops', 'sale_items', 'sales', 'purchase_items', 'purchases', 'stock_moves', 'contacts']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare('UPDATE products SET stock = 0').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('sales','purchases','cash_ops','contacts')").run();
  })();
  res.json({ ok: true });
});

module.exports = router;
