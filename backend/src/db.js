const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "apartment.db");
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS apartments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    joinCode TEXT NOT NULL UNIQUE,
    adminId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'resident')),
    apartmentId TEXT NOT NULL,
    authToken TEXT UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (apartmentId) REFERENCES apartments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    apartmentId TEXT NOT NULL,
    residentId TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    dueDate TEXT NOT NULL,
    notes TEXT DEFAULT '',
    paymentPhone TEXT DEFAULT '',
    qrCode TEXT DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('unpaid', 'paid')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    paidAt TEXT,
    FOREIGN KEY (apartmentId) REFERENCES apartments(id) ON DELETE CASCADE,
    FOREIGN KEY (residentId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    apartmentId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    recipientId TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (apartmentId) REFERENCES apartments(id) ON DELETE CASCADE,
    FOREIGN KEY (senderId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipientId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_users_apartment_role ON users(apartmentId, role);
  CREATE INDEX IF NOT EXISTS idx_users_token ON users(authToken);
  CREATE INDEX IF NOT EXISTS idx_bills_apartment_resident ON bills(apartmentId, residentId);
  CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
  CREATE INDEX IF NOT EXISTS idx_messages_apartment_recipient ON messages(apartmentId, recipientId);
`);

const nowIso = () => new Date().toISOString();

module.exports = { db, nowIso };

