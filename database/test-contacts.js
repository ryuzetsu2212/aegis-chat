// Self-check friend request flow (run: node database/test-contacts.js)
const db = require('./db');
const assert = require('assert');

db.serialize(() => {
  const A = 'testuser_a_' + Date.now();
  const B = 'testuser_b_' + Date.now();

  db.run(`INSERT INTO users (username, email, password, is_verified) VALUES (?, ?, 'x', 1), (?, ?, 'x', 1)`,
    [A, A + '@t.local', B, B + '@t.local'], function (err) {
      assert.ifError(err);
      const idA = this.lastID - 1;
      const idB = this.lastID;

      // 1. A sends request to B
      db.run(`INSERT INTO contact_requests (requester_id, target_id) VALUES (?, ?)`, [idA, idB], function (err) {
        assert.ifError(err);
        const reqId = this.lastID;

        // 2. Duplicate pending must be blocked at DB level (unique)
        db.run(`INSERT INTO contact_requests (requester_id, target_id) VALUES (?, ?)`, [idA, idB], (err) => {
          assert.ok(err, 'duplicate pending should violate UNIQUE');

          // 3. B accepts -> both directions stored
          db.run(`UPDATE contact_requests SET status='accepted' WHERE id=?`, [reqId], (err) => {
            assert.ifError(err);
            db.run(`INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?), (?, ?)`,
              [idA, idB, idB, idA], (err) => {
                assert.ifError(err);

                // 4. Contact list query (same as /users/:id endpoint)
                db.all(
                  `SELECT u.username FROM contacts c JOIN users u ON u.id = c.contact_id WHERE c.user_id = ? AND u.is_verified = 1`,
                  [idB], (err, rows) => {
                    assert.ifError(err);
                    assert.strictEqual(rows.length, 1, 'B sees exactly one contact');
                    assert.strictEqual(rows[0].username, A, 'B contact is A');

                    // 5. Socket DM gate: mutual check
                    db.get(
                      `SELECT COUNT(*) as n FROM contacts WHERE user_id = ? AND contact_id = ?`,
                      [idA, idB], (err, r) => {
                        assert.ifError(err);
                        assert.strictEqual(r.n, 1, 'DM gate passes for contacts');

                        // cleanup
                        db.run(`DELETE FROM contacts WHERE user_id IN (?, ?)`, [idA, idB]);
                        db.run(`DELETE FROM contact_requests WHERE requester_id = ? OR target_id = ?`, [idA, idB]);
                        db.run(`DELETE FROM users WHERE id IN (?, ?)`, [idA, idB], () => {
                          console.log('ALL_CONTACT_TESTS_PASSED');
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