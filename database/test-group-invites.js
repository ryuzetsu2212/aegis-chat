// Self-check group invite flow at SQL level (run: node database/test-group-invites.js)
const assert = require('assert');
const s = require('sqlite3');
const db = new s.Database(':memory:');
db.serialize(() => {
  db.run(`CREATE TABLE groups(id INTEGER PRIMARY KEY, created_by INTEGER)`);
  db.run(`CREATE TABLE group_members(group_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member', PRIMARY KEY(group_id,user_id))`);
  db.run(`CREATE TABLE group_invites(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    inviter_id INTEGER NOT NULL,
    invitee_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    UNIQUE(group_id, invitee_id)
  )`);

  // 1. Invite created pending
  db.run(`INSERT OR REPLACE INTO group_invites (group_id, inviter_id, invitee_id, status) VALUES (1, 7, 8, 'pending')`, function (err) {
    assert.ifError(err);
    const inviteId = this.lastID;

    // 2. Re-invite same person -> REPLACE resets to pending, no duplicate row
    db.run(`INSERT OR REPLACE INTO group_invites (group_id, inviter_id, invitee_id, status) VALUES (1, 7, 8, 'pending')`, function (err2) {
      assert.ifError(err2);
      db.get(`SELECT COUNT(*) AS n FROM group_invites WHERE group_id = 1 AND invitee_id = 8`, (err3, r) => {
        assert.ifError(err3);
        assert.strictEqual(r.n, 1, 'no duplicate invite row');

        // 3. Decline -> not a member
        db.run(`UPDATE group_invites SET status = 'declined' WHERE id = ?`, [inviteId], (err4) => {
          assert.ifError(err4);
          db.get(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = 1 AND user_id = 8`, (err5, m1) => {
            assert.ifError(err5);
            assert.strictEqual(m1.n, 0, 'decline adds no membership');

            // 4. Accept path -> member inserted once even if run twice (INSERT OR IGNORE)
            const accept = (cb) => db.run(
              `INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (1, 8, 'member')`,
              cb
            );
            accept(function (err6) { assert.strictEqual(this.changes, 1, 'accept inserts membership'); });
            accept(function (err7) {
              assert.ifError(err7);
              assert.strictEqual(this.changes, 0, 'second accept is no-op');
              db.get(`SELECT role FROM group_members WHERE group_id = 1 AND user_id = 8`, (err8, m2) => {
                assert.ifError(err8);
                assert.strictEqual(m2.role, 'member', 'joined as regular member');
                console.log('ALL_GROUP_INVITE_TESTS_PASSED');
                db.close();
              });
            });
          });
        });
      });
    });
  });
});
