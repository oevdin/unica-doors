const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const seedPath = path.join(__dirname, 'seed_data.json');

function seedCatalog() {
  if (!fs.existsSync(seedPath)) {
    console.log('No seed_data.json found — skipping catalog seed.');
    return;
  }
  const { categories, products } = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  // categories: insert new ones, leave existing name/icon/sort_order untouched
  // (admins may have customized icons in the UI — a data refresh shouldn't undo that)
  const insertCat = db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?,?,?,?)');
  const getCatBySlug = db.prepare('SELECT id FROM categories WHERE slug = ?');
  const slugToId = {};
  const upsertCats = db.transaction((cats) => {
    for (const c of cats) {
      const existing = getCatBySlug.get(c.slug);
      if (existing) {
        slugToId[c.slug] = existing.id;
      } else {
        const info = insertCat.run(c.name, c.slug, c.icon, c.sort_order);
        slugToId[c.slug] = info.lastInsertRowid;
      }
    }
  });
  upsertCats(categories);

  // products: matched by (category, name) — update price/description/photo if
  // the product already exists, insert if it's new. This makes it safe to
  // re-run `npm run seed` whenever the price list changes.
  const findProd = db.prepare('SELECT id, photo FROM products WHERE category_id = ? AND name = ?');
  const insertProd = db.prepare('INSERT INTO products (category_id, name, price, photo, description, unit, options) VALUES (?,?,?,?,?,?,?)');
  const updateProd = db.prepare('UPDATE products SET price = ?, description = ?, photo = COALESCE(?, photo), unit = ?, options = ? WHERE id = ?');
  const opts = (p) => (p.options && Object.keys(p.options).length ? JSON.stringify(p.options) : null);
  let inserted = 0, updated = 0;
  const upsertProds = db.transaction((prods) => {
    for (const p of prods) {
      const catId = slugToId[p.category_slug];
      if (!catId) continue;
      const existing = findProd.get(catId, p.name);
      if (existing) {
        updateProd.run(p.price, p.description || null, p.photo || null, p.unit || 'шт', opts(p), existing.id);
        updated++;
      } else {
        insertProd.run(catId, p.name, p.price, p.photo, p.description || null, p.unit || 'шт', opts(p));
        inserted++;
      }
    }
  });
  upsertProds(products);

  console.log(`Catalog synced: ${inserted} new products, ${updated} updated.`);
}

function seedAdmin() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) {
    console.log('Users already exist — skipping admin seed.');
    return;
  }
  const login = process.env.SEED_ADMIN_LOGIN || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || '123456';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (name, login, password_hash, role) VALUES (?,?,?,?)')
    .run('Администратор', login, hash, 'admin');
  console.log(`Created admin user — login: "${login}", password: "${password}". Change this after first login.`);
}

seedCatalog();
seedAdmin();
console.log('Seed complete.');
