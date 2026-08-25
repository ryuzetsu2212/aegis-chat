const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'aegis.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users table with email and OTP verification
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT 'avatar1',
    is_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // OTP table for email verification
  db.run(`CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    is_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Messages table (stores ciphertext only)
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    ciphertext TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
  )`);

  // Blocked users table
  db.run(`CREATE TABLE IF NOT EXISTS blocked_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    blocked_user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(blocked_user_id) REFERENCES users(id),
    UNIQUE(user_id, blocked_user_id)
  )`);

  // Contacts (mutual friendship — stored both directions)
  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    user_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, contact_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(contact_id) REFERENCES users(id)
  )`);

  // Friend requests
  db.run(`CREATE TABLE IF NOT EXISTS contact_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(requester_id) REFERENCES users(id),
    FOREIGN KEY(target_id) REFERENCES users(id),
    UNIQUE(requester_id, target_id)
  )`);

  // Group invites (approval required before joining)
  db.run(`CREATE TABLE IF NOT EXISTS group_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    inviter_id INTEGER NOT NULL,
    invitee_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, invitee_id),
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(inviter_id) REFERENCES users(id),
    FOREIGN KEY(invitee_id) REFERENCES users(id)
  )`);

  // Groups (metadata only — server never sees plaintext)
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  // Group membership (role: 'admin' = creator, 'member' = regular)
  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    role TEXT DEFAULT 'member',
    PRIMARY KEY(group_id, user_id),
    FOREIGN KEY(group_id) REFERENCES groups(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Migration: add role column + backfill for installs created before admins existed
  db.all(`SELECT role FROM group_members LIMIT 1`, [], (err) => {
    const backfill = () => {
      // ponytail: idempotent — creator selalu admin sesuai invariant POST /groups; jalur aman karena
      // creator tak bisa di-kick/demote (cumulative), dan kalau sudah keluar row-nya tidak ada
      db.run(`UPDATE group_members SET role = 'admin' WHERE user_id IN (SELECT g.created_by FROM groups g WHERE g.id = group_members.group_id)`);
    };
    if (err && /no such column/i.test(err.message)) {
      db.run(`ALTER TABLE group_members ADD COLUMN role TEXT DEFAULT 'member'`, backfill);
    } else {
      backfill(); // kolom sudah ada dari boot sebelumnya — tetap backfill grup lama
    }
  });

  // Migration F-03: attempts counter utk OTP lockout
  db.all(`PRAGMA table_info(otp_codes)`, (err, cols) => {
    if (err) {
      console.error('[DB] PRAGMA otp_codes error:', err);
      return;
    }
    if (cols && Array.isArray(cols) && !cols.some(c => c.name === 'attempts')) {
      db.run(`ALTER TABLE otp_codes ADD COLUMN attempts INTEGER DEFAULT 0`, (e) => {
        if (e) console.error('[DB] Error adding attempts column:', e);
        else console.log('[DB] Added attempts column');
      });
    }
  });

  // Group messages (ciphertext only)
  db.run(`CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    ciphertext TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(group_id) REFERENCES groups(id)
  )`);

  // Add columns if missing (for existing DB)
  db.all(`PRAGMA table_info(messages)`, (err, cols) => {
    if (err) {
      console.error('[DB] PRAGMA table_info error:', err);
      return;
    }
    if (!cols || !Array.isArray(cols)) {
      console.warn('[DB] No columns returned for messages table, skipping migration');
      return;
    }
    const hasType = cols.some(c => c.name === 'type');
    const hasFileName = cols.some(c => c.name === 'file_name');
    const hasFileSize = cols.some(c => c.name === 'file_size');
    const hasMimeType = cols.some(c => c.name === 'mime_type');
    const hasReadAt = cols.some(c => c.name === 'read_at');
    
    if (!hasType) {
      db.run(`ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'`, (err) => {
        if (err) console.error('[DB] Error adding type column:', err);
        else console.log('[DB] Added type column');
      });
    }
    if (!hasFileName) {
      db.run(`ALTER TABLE messages ADD COLUMN file_name TEXT`, (err) => {
        if (err) console.error('[DB] Error adding file_name column:', err);
        else console.log('[DB] Added file_name column');
      });
    }
    if (!hasFileSize) {
      db.run(`ALTER TABLE messages ADD COLUMN file_size INTEGER`, (err) => {
        if (err) console.error('[DB] Error adding file_size column:', err);
        else console.log('[DB] Added file_size column');
      });
    }
    if (!hasMimeType) {
      db.run(`ALTER TABLE messages ADD COLUMN mime_type TEXT`, (err) => {
        if (err) console.error('[DB] Error adding mime_type column:', err);
        else console.log('[DB] Added mime_type column');
      });
    }
    if (!hasReadAt) {
      db.run(`ALTER TABLE messages ADD COLUMN read_at DATETIME`, (err) => {
        if (err) console.error('[DB] Error adding read_at column:', err);
        else console.log('[DB] Added read_at column');
      });
    }
  });
});

module.exports = db;
