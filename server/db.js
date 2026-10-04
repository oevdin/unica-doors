// UNICA — учёт магазина: товары и склад, продажи, касса, клиенты/поставщики.
// Деньги хранятся в целых сомах, время — в UTC (datetime('now')).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(process.env.DB_PATH || path.join(DATA_DIR, 'unica-crm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','seller')) DEFAULT 'seller',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL DEFAULT 'шт',
  price INTEGER NOT NULL DEFAULT 0,      -- розничная цена
  cost INTEGER NOT NULL DEFAULT 0,       -- себестоимость (средневзвешенная по приходам)
  stock REAL NOT NULL DEFAULT 0,         -- остаток
  min_stock REAL NOT NULL DEFAULT 0,     -- «заканчивается», если остаток ниже
  options TEXT,                          -- JSON {"Цвет":[...],"Размер":[...]} — выбираются при продаже
  photo TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('client','supplier')) DEFAULT 'client',
  name TEXT NOT NULL,
  phone TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('cash','bank')) DEFAULT 'cash',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('done','cancelled')) DEFAULT 'done',
  note TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  category_id INTEGER,
  name TEXT NOT NULL,
  variant TEXT,
  unit TEXT NOT NULL DEFAULT 'шт',
  qty REAL NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('done','cancelled')) DEFAULT 'done',
  note TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL,
  cost INTEGER NOT NULL
);

-- движение денег: приход / расход / перевод между счетами
CREATE TABLE IF NOT EXISTS cash_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('in','out','transfer')),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  category TEXT NOT NULL,
  sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- история остатков: продажа, приход, инвентаризация, отмена
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta REAL NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('sale','purchase','adjust','cancel')),
  ref_id INTEGER,
  user_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS i_sales_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS i_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS i_ops_at ON cash_ops(created_at);
CREATE INDEX IF NOT EXISTS i_ops_sale ON cash_ops(sale_id);
CREATE INDEX IF NOT EXISTS i_ops_purchase ON cash_ops(purchase_id);
CREATE INDEX IF NOT EXISTS i_moves_product ON stock_moves(product_id);
`);

// счета по умолчанию
if (!db.prepare('SELECT COUNT(*) n FROM accounts').get().n) {
  const ins = db.prepare('INSERT INTO accounts (name, kind, sort) VALUES (?,?,?)');
  ins.run('Наличные', 'cash', 0);
  ins.run('Банк / перевод', 'bank', 1);
}

// местное время магазина (по умолчанию Бишкек, UTC+6)
db.TZ_MIN = Number(process.env.TZ_OFFSET_MINUTES || 360);
db.local = (col) => `datetime(${col}, '${db.TZ_MIN >= 0 ? '+' : ''}${db.TZ_MIN} minutes')`;

module.exports = db;
