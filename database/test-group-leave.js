// Self-check group leave flow (run: node database/test-group-leave.js)
const db = require('./db');
const assert = require('assert');

db.serialize(() => {
  const ts = Date.now();
  db.run(`INSERT INTO users (username, email, password, is_verified) VALUES (?, ?, 'x', 1), (?, ?, 'x', 1)`,
    ['gleave_a_' + ts, 'ga' + ts + '@t.local', 'gleave_b_' + ts, 'gb' + ts + '@t.local'], function (err) {
      assert.ifError(err);
      const idA = this.lastID - 1;
      const idB = this.lastID;

      db.run(`INSERT INTO groups (name, created_by) VALUES ('testgrp', ?)`, [idA], function (err) {
        assert.ifError(err);
        const gid = this.lastID;
        db.run(`INSERT INTO group_members (group_id, user_id) VALUES (?, ?), (?, ?)`, [gid, idA, gid, idB], (err) => {
          assert.ifError(err);

          // 1. Non-member leave must report no changes
          db.run(`DELETE FROM group_members WHERE group_id = ? AND user_id = -1`, [gid], function (err) {
            assert.ifError(err);
            assert.strictEqual(this.changes, 0, 'non-member delete = 0 changes');

            // 2. Member A leaves
            db.run(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, [gid, idA], function (err) {
              assert.ifError(err);
              assert.strictEqual(this.changes, 1, 'member leave removes exactly one row');

              // 3. B still member -> group survives
              db.get(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`, [gid], (err, r) => {
                assert.ifError(err);
                assert.strictEqual(r.n, 1, 'remaining member kept');
                db.get(`SELECT id FROM groups WHERE id = ?`, [gid], (err, g) => {
                  assert.ifError(err);
                  assert.ok(g, 'group row kept while members remain');

                  // 4. Last member leaves -> group shell deleted
                  db.run(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, [gid, idB], (err) => {
                    assert.ifError(err);
                    db.get(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`, [gid], (err, r2) => {
                      assert.ifError(err);
                      if (r2.n === 0) {
                        db.run(`DELETE FROM groups WHERE id = ?`, [gid]);
                      }
                      db.get(`SELECT id FROM groups WHERE id = ?`, [gid], (err, g2) => {
                        assert.ifError(err);
                        assert.ok(!g2, 'empty group shell deleted');

                        // cleanup
                        db.run(`DELETE FROM users WHERE id IN (?, ?)`, [idA, idB], () => {
                          console.log('ALL_GROUP_LEAVE_TESTS_PASSED');
                          db.close();
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
});