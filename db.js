const Database = require("better-sqlite3");
const path = require("node:path");

const dbPath = process.env.DATABASE_FILE || path.join(__dirname, "learnsphere.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'reader' CHECK(role IN ('reader','admin')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Unknown',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'General',
  price_kes INTEGER NOT NULL DEFAULT 400,
  is_free INTEGER NOT NULL DEFAULT 0,
  file_name TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  book_id INTEGER NOT NULL REFERENCES books(id),
  amount_kes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','PROCESSING','PENDING_VERIFICATION','PAID','FAILED','CANCELLED','REFUNDED')),
  payment_method TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL CHECK(method IN ('mpesa_stk','manual')),
  status TEXT NOT NULL DEFAULT 'PENDING',
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  mpesa_receipt TEXT UNIQUE,
  submitted_reference TEXT,
  phone TEXT,
  amount_kes INTEGER NOT NULL,
  provider_result TEXT,
  verified_by INTEGER REFERENCES users(id),
  verification_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  book_id INTEGER NOT NULL REFERENCES books(id),
  source TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id)
);
CREATE TABLE IF NOT EXISTS manual_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  transaction_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = db;
