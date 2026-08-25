const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'aegis.db');
const db = new sqlite3.Database(dbPath);

console.log('[Migration] Adding avatar column to users table...');

db.serialize(() => {
  // Check if avatar column exists
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (err) {
      console.error('[Migration] Error checking table:', err);
      return;
    }

    const hasAvatarColumn = rows.some(row => row.name === 'avatar');
    
    if (!hasAvatarColumn) {
      db.run("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT 'avatar1'", (err) => {
        if (err) {
          console.error('[Migration] Error adding avatar column:', err);
        } else {
          console.log('[Migration] ✓ Avatar column added successfully');
        }
        db.close();
      });
    } else {
      console.log('[Migration] ✓ Avatar column already exists');
      db.close();
    }
  });
});
