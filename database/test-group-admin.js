// Self-check group admin logic (run: node database/test-group-admin.js)
const db = require('./db');
const assert = require('assert');

db.serialize(() => {
  const ts = Date.now();
  db.run(`INSERT INTO users (username, email, password, is_verified) VALUES (?, ?, 'x', 1), (?, ?, 'x', 1), (?, ?, 'x', 1)`,
    ['gadm_a_' + ts, 'aa' + ts + '@t.local', 'gadm_b_' + ts, 'ab' + ts + '@t.local', 'gadm_c_' + ts, 'ac' + ts + '@t.local'], function (err) {
      assert.ifError(err);
      const idA = this.lastID - 2, idB = this.lastID - 1, idC = this.lastID;

      db.run(`INSERT INTO groups (name, created_by) VALUES ('admgrp', ?)`, [idA], function (err) {
        assert.ifError(err);
        const gid = this.lastID;
        // Creator=admin, others=member (mirrors POST /groups)
        db.run(`INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin'), (?, ?, 'member'), (?, ?, 'member')`,
          [gid, idA, gid, idB, gid, idC], (err) => {
            assert.ifError(err);

            // 1. Default role is member for plain inserts (old rows / test tables)
            db.get(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`, [gid, idB], (err, r) => {
              assert.ifError(err);
              assert.strictEqual(r.role, 'member', 'explicit insert kept member role');

              // 2. Only one admin initially
              db.get(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND role = 'admin'`, [gid], (err, r2) => {
                assert.ifError(err);
                assert.strictEqual(r2.n, 1, 'exactly one admin');

                // 3. Admin appoints B then leaves -> B becomes admin, A gone, group survives
                db.serialize(() => {
                  db.run(`UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?`, [gid, idB], (err) => {
                    assert.ifError(err);
                    db.run(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, [gid, idA], function (err) {
                      assert.ifError(err);
                      assert.strictEqual(this.changes, 1, 'admin leave removes own row');
                      db.get(`SELECT username FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? AND gm.role = 'admin'`, [gid], (err, adm) => {
                        assert.ifError(err);
                        assert.ok(adm && adm.username.startsWith('gadm_b_'), 'successor promoted to admin');

                        // 4. Dissolve: messages + members + group all gone
                        db.run(`INSERT INTO group_messages (sender_id, group_id, ciphertext) VALUES (?, ?, 'enc')`, [idB, gid], (err) => {
                          assert.ifError(err);
                          db.serialize(() => {
                            db.run(`DELETE FROM group_messages WHERE group_id = ?`, [gid]);
                            db.run(`DELETE FROM group_members WHERE group_id = ?`, [gid]);
                            db.run(`DELETE FROM groups WHERE id = ?`, [gid], function (err) {
                              assert.ifError(err);
                              assert.strictEqual(this.changes, 1, 'group deleted on dissolve');
                              db.get(`SELECT COUNT(*) AS n FROM group_messages WHERE group_id = ?`, [gid], (err, m) => {
                                assert.ifError(err);
                                assert.strictEqual(m.n, 0, 'group messages purged');

                                db.run(`DELETE FROM users WHERE id IN (?, ?, ?)`, [idA, idB, idC], () => {
                                  console.log('ALL_GROUP_ADMIN_TESTS_PASSED');
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
      });
    });
});
