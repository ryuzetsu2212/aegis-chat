const express = require('express');
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// F-01 fix: identitas self dari sesi
router.use(requireAuth);

// Block user endpoint
router.post('/block', async (req, res) => {
  const { blockUsername } = req.body;
  const userId = req.userId; // server-side identity

  if (!blockUsername) {
    return res.status(400).json({ success: false, message: 'Missing blockUsername' });
  }

  try {
    // Get blocked user ID
    db.get('SELECT id FROM users WHERE username = ?', [blockUsername], (err, blockedUser) => {
      if (err) {
        console.error('[Block] Database error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!blockedUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const blockedUserId = blockedUser.id;

      // Prevent blocking yourself
      if (userId === blockedUserId) {
        return res.status(400).json({ success: false, message: 'Cannot block yourself' });
      }

      // Insert into blocked_users table
      db.run(
        'INSERT INTO blocked_users (user_id, blocked_user_id) VALUES (?, ?)',
        [userId, blockedUserId],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              return res.status(400).json({ success: false, message: 'User already blocked' });
            }
            console.error('[Block] Insert error:', err);
            return res.status(500).json({ success: false, message: 'Failed to block user' });
          }

          console.log(`[Block] User ${userId} blocked user ${blockedUserId} (${blockUsername})`);
          res.json({ success: true, message: 'User blocked successfully' });
        }
      );
    });
  } catch (err) {
    console.error('[Block] Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Unblock user endpoint
router.post('/unblock', async (req, res) => {
  const { userId, unblockUsername } = req.body;

  if (!userId || !unblockUsername) {
    return res.status(400).json({ success: false, message: 'Missing userId or unblockUsername' });
  }

  try {
    db.get('SELECT id FROM users WHERE username = ?', [unblockUsername], (err, unblockedUser) => {
      if (err) {
        console.error('[Unblock] Database error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!unblockedUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const unblockedUserId = unblockedUser.id;

      db.run(
        'DELETE FROM blocked_users WHERE user_id = ? AND blocked_user_id = ?',
        [userId, unblockedUserId],
        function(err) {
          if (err) {
            console.error('[Unblock] Delete error:', err);
            return res.status(500).json({ success: false, message: 'Failed to unblock user' });
          }

          console.log(`[Unblock] User ${userId} unblocked user ${unblockedUserId} (${unblockUsername})`);
          res.json({ success: true, message: 'User unblocked successfully' });
        }
      );
    });
  } catch (err) {
    console.error('[Unblock] Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
