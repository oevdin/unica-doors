// Первый запуск: администратор и демо-каталог (только если товаров ещё нет)
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
  const login = process.env.SEED_ADMIN_LOGIN || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || '123456';
  db.prepare("INSERT INTO users (name, login, password_hash, role) VALUES ('Владелец', ?, ?, 'admin')").run(login, bcrypt.hashSync(password, 10));
  console.log(`Администратор создан: ${login}`);
}

if (!db.prepare('SELECT COUNT(*) n FROM products').get().n) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog_demo.json'), 'utf-8'));
  db.transaction(() => {
    const bySlug = {};
    data.categories.forEach((c, i) => { bySlug[c.slug] = db.prepare('INSERT INTO categories (name, icon, sort) VALUES (?,?,?)').run(c.name, c.icon, i).lastInsertRowid; });
    const ins = db.prepare('INSERT INTO products (category_id, name, unit, price, cost, options, photo, min_stock) VALUES (?,?,?,?,?,?,?,?)');
    for (const p of data.products) ins.run(bySlug[p.category] || null, p.name, p.unit, p.price, p.cost, p.options ? JSON.stringify(p.options) : null, p.photo, p.min_stock || 0);
  })();
  console.log(`Каталог загружен: ${data.products.length} товаров`);
}
console.log('Готово.');
