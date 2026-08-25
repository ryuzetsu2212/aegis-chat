// One-off: verify backfill SQL (run: node database/test-backfill-sql.js)
const assert = require('assert');
const s = require('sqlite3');
const db = new s.Database(':memory:');
db.serialize(() => {
  db.run('CREATE TABLE groups(id INTEGER PRIMARY KEY, created_by INTEGER)');
  db.run(`CREATE TABLE group_members(group_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member')`);
  db.run('INSERT INTO groups(created_by) VALUES (7),(9)');
  db.run(`INSERT INTO group_members VALUES (1,7,'member'),(1,8,'member'),(2,9,'member'),(3,8,'member')`);
  db.run(`UPDATE group_members SET role='admin' WHERE user_id IN (SELECT g.created_by FROM groups g WHERE g.id = group_members.group_id)`, (err) => {
    assert.ifError(err);
    db.all('SELECT * FROM group_members ORDER BY group_id,user_id', (err, rows) => {
      assert.ifError(err);
      // creator 7 -> admin in grp1; creator 9 -> admin in grp2; grp3 has no creator row -> stays member
      assert.deepStrictEqual(rows.map(r => r.role), ['admin', 'member', 'admin', 'member'], JSON.stringify(rows));
      console.log('BACKFILL_SQL_OK', JSON.stringify(rows));
      db.close();
    });
  });
});
