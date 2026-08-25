const express = require('express');
const db = require('../database/db');
const notify = require('../socket/notify');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// F-01 fix: semua route chat butuh sesi valid; identitas self diambil
// dari session cookie (HttpOnly), bukan dari params/body klien
router.use(requireAuth);

// Get chat history
router.get('/messages/:userId/:partnerId', (req, res) => {
  const userId = req.userId; // F-01: pemilik riwayat = sesi (param :userId diabaikan)
  const { partnerId } = req.params;

  db.all(
    `SELECT m.id, m.ciphertext, m.created_at, m.type, m.file_name, m.file_size, m.mime_type, m.read_at,
            u.username as sender_username 
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE (m.sender_id = ? AND m.receiver_id = ?) 
        OR (m.sender_id = ? AND m.receiver_id = ?)
     ORDER BY m.created_at ASC`,
    [userId, partnerId, partnerId, userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch messages' });
      }
      res.json({ success: true, messages: rows });
    }
  );
});

// Get accepted contacts only (friend-request system)
router.get('/users/:currentUserId', (req, res) => {
  const currentUserId = req.userId; // F-01: abaikan param dari klien

  db.all(
    `SELECT u.id, u.username, u.email, u.avatar,
            CASE 
              WHEN b1.id IS NOT NULL THEN 1 
              ELSE 0 
            END as is_blocked_by_me,
            CASE 
              WHEN b2.id IS NOT NULL THEN 1 
              ELSE 0 
            END as has_blocked_me
     FROM contacts c
     JOIN users u ON u.id = c.contact_id
     LEFT JOIN blocked_users b1 ON u.id = b1.blocked_user_id AND b1.user_id = ?
     LEFT JOIN blocked_users b2 ON u.id = b2.user_id AND b2.blocked_user_id = ?
     WHERE c.user_id = ? 
     AND u.is_verified = 1`,
    [currentUserId, currentUserId, currentUserId],
    (err, rows) => {
      if (err) {
        console.error('[API] Error fetching users:', err);
        return res.status(500).json({ error: 'Failed to fetch users' });
      }
      console.log('[API] Users found:', rows);
      res.json({ success: true, users: rows });
    }
  );
});

// ===== CONTACTS / FRIEND REQUESTS =====

// Search verified users by username (for sending friend requests)
router.get('/contacts/search/:currentUserId', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, users: [] });
  const me = req.userId; // F-01: abaikan param dari klien
  db.all(
    `SELECT u.id, u.username, u.avatar,
       CASE
         WHEN EXISTS (SELECT 1 FROM contacts c WHERE c.user_id = ? AND c.contact_id = u.id) THEN 'contacts'
         WHEN EXISTS (SELECT 1 FROM contact_requests r WHERE r.requester_id = ? AND r.target_id = u.id AND r.status = 'pending') THEN 'pending_out'
         WHEN EXISTS (SELECT 1 FROM contact_requests r WHERE r.requester_id = u.id AND r.target_id = ? AND r.status = 'pending') THEN 'pending_in'
         ELSE 'none'
       END as relation
     FROM users u
     WHERE u.id != ? AND u.is_verified = 1 AND u.username LIKE ?
     LIMIT 10`,
    [me, me, me, me, `%${q}%`],
    (err, rows) => {
      if (err) {
        console.error('[API] Error searching users:', err);
        return res.status(500).json({ error: 'Failed to search users' });
      }
      res.json({ success: true, users: rows });
    }
  );
});

// Send friend request
router.post('/contacts/request', (req, res) => {
  const requesterId = req.userId; // F-01: pengirim selalu dari sesi
  const { username } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }

  db.get(
    `SELECT id FROM users WHERE username = ? AND is_verified = 1`,
    [username.trim()],
    (err, target) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (target.id === requesterId) return res.status(400).json({ error: 'Cannot add yourself' });

      db.get(
        `SELECT 1 AS x FROM contacts
         WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)`,
        [requesterId, target.id, target.id, requesterId],
        (err, already) => {
          if (already) return res.status(409).json({ error: 'Already contacts' });

          db.get(
            `SELECT id, requester_id, status FROM contact_requests
             WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)`,
            [requesterId, target.id, target.id, requesterId],
            (err, reqRow) => {
              if (reqRow && reqRow.status === 'pending') {
                return res.status(409).json({
                  error: reqRow.requester_id === requesterId
                    ? 'Request already sent'
                    : 'This user already sent you a request'
                });
              }

              db.get(
                `SELECT 1 AS x FROM blocked_users
                 WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)`,
                [requesterId, target.id, target.id, requesterId],
                (err, blocked) => {
                  if (blocked) return res.status(403).json({ error: 'Cannot send request (blocked)' });

                  const done = (e) => {
                    if (e) {
                      console.error('[API] Request error:', e);
                      return res.status(500).json({ error: 'Failed to send request' });
                    }
                    notify.toUser(target.id, 'invites_changed', {});
                    res.json({ success: true });
                  };

                  if (reqRow && reqRow.requester_id === requesterId) {
                    // own previously-rejected row -> reactivate as pending
                    db.run(
                      `UPDATE contact_requests SET status = 'pending', created_at = CURRENT_TIMESTAMP WHERE id = ?`,
                      [reqRow.id],
                      done
                    );
                  } else {
                    db.run(
                      `INSERT INTO contact_requests (requester_id, target_id) VALUES (?, ?)`,
                      [requesterId, target.id],
                      done
                    );
                  }
                }
              );
            }
          );
        }
      );
    }
  );
});

// ===== GROUPS =====

// Incoming pending friend requests
router.get('/contacts/requests/:userId', (req, res) => {
  db.all(
    `SELECT r.id, r.requester_id, r.created_at,
            u.username AS requester_username, u.avatar AS requester_avatar
     FROM contact_requests r
     JOIN users u ON u.id = r.requester_id
     WHERE r.target_id = ? AND r.status = 'pending'
     ORDER BY r.created_at DESC`,
    [req.userId],
    (err, incoming) => {
      if (err) {
        console.error('[API] Error fetching requests:', err);
        return res.status(500).json({ error: 'Failed to fetch requests' });
      }
      res.json({ success: true, incoming });
    }
  );
});

// Accept or reject a friend request
router.post('/contacts/respond', (req, res) => {
  const requestId = Number(req.body.requestId);
  const userId = req.userId; // F-01: penerima request = sesi
  const { action } = req.body; // 'accept' | 'reject'
  if (!requestId || !['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'requestId, action are required' });
  }

  db.get(
    `SELECT * FROM contact_requests WHERE id = ? AND target_id = ? AND status = 'pending'`,
    [requestId, userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!row) return res.status(404).json({ error: 'Request not found' });

      db.run(
        `UPDATE contact_requests SET status = ? WHERE id = ?`,
        [action === 'accept' ? 'accepted' : 'rejected', requestId],
        (err2) => {
          if (err2) return res.status(500).json({ error: 'Failed to update request' });
          if (action !== 'accept') return res.json({ success: true });

          // mutual: store both directions
          db.run(
            `INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?), (?, ?)`,
            [row.requester_id, row.target_id, row.target_id, row.requester_id],
            (err3) => err3
              ? res.status(500).json({ error: 'Failed to add contact' })
              : res.json({ success: true })
          );
        }
      );
    }
  );
});

// Create group
router.post('/groups', (req, res) => {
  const { name, memberIds } = req.body;
  const creatorId = req.userId; // F-01: creator dari sesi

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  // ponytail: creator auto-included; dupes collapsed via Set
  const members = [...new Set([creatorId, ...(memberIds || []).map(Number)])];

  db.run(
    `INSERT INTO groups (name, created_by) VALUES (?, ?)`,
    [name.trim(), creatorId],
    function (err) {
      if (err) {
        console.error('[API] Error creating group:', err);
        return res.status(500).json({ error: 'Failed to create group' });
      }
      const groupId = this.lastID;
      // Creator becomes admin
      const placeholders = members.map(() => '(?, ?, ?)').join(', ');
      const params = members.flatMap(id => [groupId, id, id === Number(creatorId) ? 'admin' : 'member']);
      db.run(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES ${placeholders}`,
        params,
        (err2) => {
          if (err2) {
            console.error('[API] Error adding group members:', err2);
            return res.status(500).json({ error: 'Failed to add group members' });
          }
          res.json({ success: true, groupId });
        }
      );
    }
  );
});

// List groups the user belongs to (with members + roles)
router.get('/groups/:userId', (req, res) => {
  const userId = req.userId; // F-01: abaikan param dari klien
  db.all(
    `SELECT g.id, g.name, g.created_by FROM groups g
     WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
     ORDER BY g.created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('[API] Error fetching groups:', err);
        return res.status(500).json({ error: 'Failed to fetch groups' });
      }
      if (rows.length === 0) return res.json({ success: true, groups: [] });

      let done = 0;
      rows.forEach(g => {
        db.all(
          `SELECT u.id, u.username, u.avatar, gm.role FROM group_members gm
           JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?`,
          [g.id],
          (err2, members) => {
            g.members = err2 ? [] : members;
            if (++done === rows.length) res.json({ success: true, groups: rows });
          }
        );
      });
    }
  );
});

// Admin guard helper
function requireGroupAdmin(groupId, requesterId, cb) {
  db.get(
    `SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'admin'`,
    [groupId, requesterId],
    (err, row) => cb(err, !!row)
  );
}

// Add a member to a group (admin only) -> creates a pending invite the target must accept
router.post('/groups/add-member', (req, res) => {
  const groupId = Number(req.body.groupId);
  const requesterId = req.userId; // F-01: admin dari sesi
  const userId = Number(req.body.userId); // target — boleh dari body
  if (!groupId || !userId) {
    return res.status(400).json({ error: 'groupId and userId are required' });
  }

  requireGroupAdmin(groupId, requesterId, (err, isAdmin) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!isAdmin) return res.status(403).json({ error: 'Only the admin can add members' });

    // Target must be an existing user and not already a member
    db.get(`SELECT id FROM users WHERE id = ?`, [userId], (err2, user) => {
      if (err2) return res.status(500).json({ error: 'Database error' });
      if (!user) return res.status(404).json({ error: 'User not found' });

      db.get(`SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?`, [groupId, userId], (err3, m) => {
        if (err3) return res.status(500).json({ error: 'Database error' });
        if (m) return res.status(409).json({ error: 'Already a member' });

        // ponytail: REPLACE juga memunculkan kembali undangan yang ditolak (status reset pending)
        db.run(
          `INSERT OR REPLACE INTO group_invites (group_id, inviter_id, invitee_id, status)
           VALUES (?, ?, ?, 'pending')`,
          [groupId, requesterId, userId],
          (err4) => {
            if (err4) return res.status(500).json({ error: 'Failed to create invite' });
            notify.toUser(userId, 'invites_changed', {});
            res.json({ success: true, invited: true });
          }
        );
      });
    });
  });
});

// Remove a member from a group (admin only; admin cannot remove self — use leave)
router.post('/groups/remove-member', (req, res) => {
  const groupId = Number(req.body.groupId);
  const requesterId = req.userId; // F-01: admin dari sesi
  const userId = Number(req.body.userId); // target — boleh dari body
  if (!groupId || !userId) {
    return res.status(400).json({ error: 'groupId and userId are required' });
  }
  if (userId === requesterId) {
    return res.status(400).json({ error: 'Use leave to remove yourself' });
  }

  requireGroupAdmin(groupId, requesterId, (err, isAdmin) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!isAdmin) return res.status(403).json({ error: 'Only the admin can remove members' });

    db.run(
      `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, userId],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'Failed to remove member' });
        if (this.changes === 0) return res.status(404).json({ error: 'Not a member of this group' });
        res.json({ success: true });
      }
    );
  });
});

// Dissolve a group entirely (admin only)
router.post('/groups/dissolve', (req, res) => {
  const groupId = Number(req.body.groupId);
  const requesterId = req.userId; // F-01: admin dari sesi
  if (!groupId) {
    return res.status(400).json({ error: 'groupId is required' });
  }

  requireGroupAdmin(groupId, requesterId, (err, isAdmin) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!isAdmin) return res.status(403).json({ error: 'Only the admin can dissolve the group' });

    // ambil penerima undangan pending dulu — badge mereka harus turun saat grup lenyap
    db.all(`SELECT DISTINCT invitee_id FROM group_invites WHERE group_id = ?`, [groupId], (errI0, rowsI0) => {
      const pendingInvitees = errI0 ? [] : rowsI0.map(r => r.invitee_id);

      db.run(`DELETE FROM group_messages WHERE group_id = ?`, [groupId], (err2) => {
      if (err2) return res.status(500).json({ error: 'Failed to dissolve group' });
      db.run(`DELETE FROM group_invites WHERE group_id = ?`, [groupId], (errI) => {
        if (errI) return res.status(500).json({ error: 'Failed to dissolve group' });
        db.run(`DELETE FROM group_members WHERE group_id = ?`, [groupId], (err3) => {
          if (err3) return res.status(500).json({ error: 'Failed to dissolve group' });
          db.run(`DELETE FROM groups WHERE id = ?`, [groupId], function (err4) {
            if (err4) return res.status(500).json({ error: 'Failed to dissolve group' });
            if (this.changes === 0) return res.status(404).json({ error: 'Group not found' });
            pendingInvitees.forEach(id => notify.toUser(id, 'invites_changed', {}));
            res.json({ success: true });
          });
        });
      });
    });
    });
  });
});

// Leave a group. If the leaver is the admin and other members remain,
// newAdminId is required and that member is promoted before removal.
// Last member leaving (or dissolved membership) drops the group + its messages.
router.post('/groups/leave', (req, res) => {
  const groupId = Number(req.body.groupId);
  const userId = req.userId; // F-01: yang keluar = sesi
  const newAdminId = req.body.newAdminId ? Number(req.body.newAdminId) : null;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId is required' });
  }

  db.get(
    `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId],
    (err, row) => {
      if (err) {
        console.error('[API] Error leaving group:', err);
        return res.status(500).json({ error: 'Failed to leave group' });
      }
      if (!row) return res.status(404).json({ error: 'Not a member of this group' });

      const finishLeave = () => {
        // Group empty -> drop shell + orphaned ciphertext
        db.get(
          `SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`,
          [groupId],
          (err2, cnt) => {
            if (!err2 && cnt && cnt.n === 0) {
              db.run(`DELETE FROM group_messages WHERE group_id = ?`, [groupId]);
              db.run(`DELETE FROM group_invites WHERE group_id = ?`, [groupId]);
              db.run(`DELETE FROM groups WHERE id = ?`, [groupId]);
            }
            res.json({ success: true });
          }
        );
      };

      if (row.role !== 'admin') {
        db.run(
          `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
          [groupId, userId],
          function (err2) {
            if (err2) return res.status(500).json({ error: 'Failed to leave group' });
            if (this.changes === 0) return res.status(404).json({ error: 'Not a member of this group' });
            finishLeave();
          }
        );
        return;
      }

      // Admin leaving: check for remaining members
      db.all(
        `SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?`,
        [groupId, userId],
        (err3, others) => {
          if (err3) return res.status(500).json({ error: 'Failed to leave group' });

          if (others.length === 0) {
            // Admin is alone -> just remove; cleanup drops the group
            db.run(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, [groupId, userId], () => finishLeave());
            return;
          }

          if (!newAdminId) {
            return res.status(400).json({ error: 'Admin must appoint a successor (newAdminId)' });
          }
          if (!others.some(o => o.user_id === newAdminId)) {
            return res.status(400).json({ error: 'Successor must be a member of this group' });
          }

          db.serialize(() => {
            db.run(
              `UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?`,
              [groupId, newAdminId],
              (err4) => {
                if (err4) return res.status(500).json({ error: 'Failed to transfer admin' });
                db.run(
                  `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
                  [groupId, userId],
                  (err5) => err5
                    ? res.status(500).json({ error: 'Failed to leave group' })
                    : finishLeave()
                );
              }
            );
          });
        }
      );
    }
  );
});

// Group message history (ciphertext only)
router.get('/group-messages/:groupId', (req, res) => {
  // F-07 fix: cek membership sebelum kasih riwayat grup
  db.get(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
    [Number(req.params.groupId), req.userId],
    (errM, member) => {
      if (errM) return res.status(500).json({ error: 'Database error' });
      if (!member) return res.status(403).json({ error: 'Not a member of this group' });

  db.all(
    `SELECT m.id, m.ciphertext, m.created_at, m.type, m.file_name, m.file_size, m.mime_type,
            u.username as sender_username
     FROM group_messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.group_id = ?
     ORDER BY m.created_at ASC`,
    [req.params.groupId],
    (err, rows) => {
      if (err) {
        console.error('[API] Error fetching group messages:', err);
        return res.status(500).json({ error: 'Failed to fetch group messages' });
      }
      res.json({ success: true, messages: rows });
    }
  );
    }
  );
});

// Pending group invites for a user (with group + inviter names)
router.get('/invites/:userId', (req, res) => {
  db.all(
    `SELECT gi.id, gi.group_id, g.name AS group_name,
            u.username AS inviter_username, u.avatar AS inviter_avatar
     FROM group_invites gi
     JOIN groups g ON gi.group_id = g.id
     JOIN users u ON gi.inviter_id = u.id
     WHERE gi.invitee_id = ? AND gi.status = 'pending'
     ORDER BY gi.created_at DESC`,
    [req.userId],
    (err, rows) => {
      if (err) {
        console.error('[API] Error fetching invites:', err);
        return res.status(500).json({ error: 'Failed to fetch invites' });
      }
      res.json({ success: true, invites: rows });
    }
  );
});

// Respond to a group invite (invitee only): accept -> joins as member, decline -> marked declined
router.post('/invites/respond', (req, res) => {
  const inviteId = Number(req.body.inviteId);
  const userId = req.userId; // F-01: invitee dari sesi
  const action = req.body.action;
  if (!inviteId || !['accept', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'inviteId, action (accept|decline) are required' });
  }

  db.get(`SELECT * FROM group_invites WHERE id = ?`, [inviteId], (err, inv) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!inv || inv.invitee_id !== userId) return res.status(404).json({ error: 'Invite not found' });
    if (inv.status !== 'pending') return res.status(409).json({ error: 'Invite already handled' });

    if (action === 'decline') {
      return db.run(`UPDATE group_invites SET status = 'declined' WHERE id = ?`, [inviteId],
        (e) => e ? res.status(500).json({ error: 'Failed to decline invite' }) : res.json({ success: true }));
    }

    // Accept: group must still exist and user not already a member
    db.get(`SELECT id FROM groups WHERE id = ?`, [inv.group_id], (err2, grp) => {
      if (err2) return res.status(500).json({ error: 'Database error' });
      if (!grp) {
        return db.run(`UPDATE group_invites SET status = 'declined' WHERE id = ?`, [inviteId],
          () => res.status(404).json({ error: 'Group no longer exists' }));
      }
      db.run(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`,
        [inv.group_id, userId],
        function (err3) {
          if (err3) return res.status(500).json({ error: 'Failed to join group' });
          db.run(`UPDATE group_invites SET status = 'accepted' WHERE id = ?`, [inviteId], (err4) =>
            err4
              ? res.status(500).json({ error: 'Failed to update invite' })
              : res.json({ success: true, groupId: inv.group_id })
          );
        }
      );
    });
  });
});

// Get conversation previews (DMs + groups sorted by last activity)
router.get('/conversations', (req, res) => {
  const userId = req.userId;
  db.all(
    `SELECT u.id, u.username, u.avatar, 'dm' as type,
       (SELECT m.ciphertext FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?) ORDER BY m.created_at DESC LIMIT 1) as last_ciphertext,
       (SELECT m.created_at FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?) ORDER BY m.created_at DESC LIMIT 1) as last_created_at
     FROM contacts c
     JOIN users u ON u.id = c.contact_id
     WHERE c.user_id = ?
     UNION
     SELECT g.id, g.name as username, 'group' as avatar, 'group' as type,
       (SELECT gm.ciphertext FROM group_messages gm WHERE gm.group_id = g.id ORDER BY gm.created_at DESC LIMIT 1) as last_ciphertext,
       (SELECT gm.created_at FROM group_messages gm WHERE gm.group_id = g.id ORDER BY gm.created_at DESC LIMIT 1) as last_created_at
     FROM groups g
     JOIN group_members gm_user ON gm_user.group_id = g.id
     WHERE gm_user.user_id = ?
     ORDER BY last_created_at DESC`,
    [userId, userId, userId, userId, userId, userId],
    (err, rows) => {
      if (err) {
        console.error('[API] Conversations error:', err);
        return res.status(500).json({ error: 'Failed to fetch conversations' });
      }
      res.json({ success: true, conversations: rows });
    }
  );
});

module.exports = router;
