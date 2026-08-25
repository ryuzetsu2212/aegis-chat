const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database/db');
const { generateOTP, sendOTPEmail } = require('../utils/email');
const { issueSession, clearSession, requireAuth, rateLimit } = require('../middleware/auth');

const router = express.Router();

// F-03 fix: lockout per-OTP — 5x salah lalu OTP mati, minta baru
const OTP_MAX_ATTEMPTS = 5;
function checkOtp(email, otp, cb) {
  db.get(
    'SELECT * FROM otp_codes WHERE email = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1',
    [email],
    (err, row) => {
      if (err) return cb(err);
      if (!row || new Date(row.expires_at).getTime() <= Date.now()) return cb(null, null);
      if ((row.attempts || 0) >= OTP_MAX_ATTEMPTS) return cb(null, { locked: true });
      if (String(row.otp_code) !== String(otp)) {
        return db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id], () => cb(null, null));
      }
      cb(null, row);
    }
  );
}

// Register endpoint
router.post('/register', async (req, res) => {
  const { username, email, password, avatar } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user exists
    db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, email], async (err, row) => {
      if (row) {
        return res.status(400).json({ error: 'Username or email already exists' });
      }

      // Generate OTP
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // F-03 fix: invalidasi OTP lama sebelum generate baru
      db.run('UPDATE otp_codes SET is_used = 1 WHERE email = ?', [email]);

      // Save OTP to database
      db.run(
        'INSERT INTO otp_codes (email, otp_code, expires_at) VALUES (?, ?, ?)',
        [email, otp, expiresAt.toISOString()],
        async function(err) {
          if (err) {
            console.error('[DB] Error saving OTP:', err);
            return res.status(500).json({ error: 'Failed to generate OTP' });
          }

          // Send OTP via email
          const emailSent = await sendOTPEmail(email, otp);
          if (!emailSent) {
            return res.status(500).json({ error: 'Failed to send OTP email' });
          }

          // Temporarily store user data (not verified yet)
          db.run(
            'INSERT INTO users (username, email, password, avatar, is_verified) VALUES (?, ?, ?, ?, 0)',
            [username, email, hashedPassword, avatar || 'avatar1'],
            function(err) {
              if (err) {
                console.error('[DB] Error creating user:', err);
                return res.status(500).json({ error: 'Registration failed' });
              }

              res.json({ 
                success: true, 
                message: 'OTP sent to email',
                email: email 
              });
            }
          );
        }
      );
    });
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify OTP endpoint
router.post('/verify-otp', rateLimit(15 * 60 * 1000, 30), (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  // F-03 fix: verifikasi via helper (attempt counter + lockout)
  checkOtp(email, otp, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to verify OTP' });
    }
    if (row && row.locked) {
      return res.status(429).json({ error: 'Too many failed attempts. Request a new OTP.' });
    }
    if (!row) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    db.run('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [row.id]);

    // Verify user
    db.run('UPDATE users SET is_verified = 1 WHERE email = ?', [email], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Verification failed' });
      }

      res.json({ success: true, message: 'Email verified successfully' });
    });
  });
});

// Login endpoint
router.post('/login', rateLimit(15 * 60 * 1000, 20), (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  db.get(
    'SELECT id, username, email, password, is_verified FROM users WHERE username = ? OR email = ?',
    [username, username],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!user.is_verified) {
        return res.status(403).json({ error: 'Email not verified. Please verify your email first.' });
      }

      // Compare password
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      issueSession(res, user.id); // F-01: sesi server-side via HttpOnly cookie

      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          username: user.username,
          email: user.email,
          avatar: user.avatar || 'avatar1'
        } 
      });
    }
  );
});

// Logout endpoint — hapus cookie sesi
router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ success: true });
});

// Forgot password endpoint
router.post('/forgot-password', rateLimit(15 * 60 * 1000, 10), (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Check if user exists
  db.get('SELECT id, email, is_verified FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user || !user.is_verified) {
      // F-12: respons seragam — cegah enumerasi akun & status verifikasi
      return res.json({
        success: true,
        message: 'If that email is registered and verified, an OTP has been sent.'
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // F-03 fix: invalidasi OTP lama sebelum generate baru
    db.run('UPDATE otp_codes SET is_used = 1 WHERE email = ?', [email]);

    // Save OTP to database
    db.run(
      'INSERT INTO otp_codes (email, otp_code, expires_at) VALUES (?, ?, ?)',
      [email, otp, expiresAt.toISOString()],
      async function(err) {
        if (err) {
          console.error('[DB] Error saving OTP:', err);
          return res.status(500).json({ error: 'Failed to generate OTP' });
        }

        // Send OTP via email
        const emailSent = await sendOTPEmail(email, otp);
        if (!emailSent) {
          return res.status(500).json({ error: 'Failed to send OTP email' });
        }

        res.json({ 
          success: true, 
          message: 'If that email is registered and verified, an OTP has been sent.'
        });
      }
    );
  });
});

// Reset password endpoint
router.post('/reset-password', rateLimit(15 * 60 * 1000, 30), (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // F-03 fix: verifikasi via helper (attempt counter + lockout)
  checkOtp(email, otp, async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to verify OTP' });
    }
    if (row && row.locked) {
      return res.status(429).json({ error: 'Too many failed attempts. Request a new OTP.' });
    }
    if (!row) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      db.run('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email], function(err) {
        if (err) {
          console.error('[DB] Error updating password:', err);
          return res.status(500).json({ error: 'Failed to reset password' });
        }

        // Mark OTP as used
        db.run('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [row.id]);

        res.json({ success: true, message: 'Password reset successfully' });
      });
  });
});

// Update avatar endpoint
router.put('/update-avatar', requireAuth, (req, res) => {
  const { avatar } = req.body;
  const userId = req.userId; // F-01: identitas dari sesi, bukan body

  // Validate avatar key exists in AVATARS
  const validAvatars = ['avatar1','avatar2','avatar3','avatar4','avatar5','avatar6','avatar7','avatar8','avatar9','avatar10','avatar11','avatar12','avatar13','avatar14','avatar15','avatar16','avatar17','avatar18','avatar19','avatar20'];
  if (!validAvatars.includes(avatar)) {
    return res.status(400).json({ error: 'Invalid avatar' });
  }

  db.run(
    'UPDATE users SET avatar = ? WHERE id = ?',
    [avatar, userId],
    function(err) {
      if (err) {
        console.error('[DB] Error updating avatar:', err);
        return res.status(500).json({ error: 'Failed to update avatar' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ success: true, message: 'Avatar updated', avatar });
    }
  );
});

// Send OTP for profile update
router.post('/send-profile-otp', requireAuth, rateLimit(15 * 60 * 1000, 10), (req, res) => {
  const userId = req.userId; // F-01: identitas dari sesi, bukan body

  db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // F-03 fix: invalidasi OTP lama sebelum generate baru
    db.run('UPDATE otp_codes SET is_used = 1 WHERE email = ?', [user.email]);

    db.run(
      'INSERT INTO otp_codes (email, otp_code, expires_at) VALUES (?, ?, ?)',
      [user.email, otp, expiresAt.toISOString()],
      async function(err) {
        if (err) {
          console.error('[DB] Error saving profile OTP:', err);
          return res.status(500).json({ error: 'Failed to generate OTP' });
        }

        const emailSent = await sendOTPEmail(user.email, otp);
        if (!emailSent) {
          return res.status(500).json({ error: 'Failed to send OTP email' });
        }

        res.json({ success: true, message: 'OTP sent to your email' });
      }
    );
  });
});

// Update profile with OTP verification
router.put('/update-profile', requireAuth, rateLimit(15 * 60 * 1000, 20), (req, res) => {
  const { otp, username, email, password } = req.body;
  const userId = req.userId; // F-01: identitas dari sesi, bukan body

  // Get user first
  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // No OTP: username-only change allowed
    if (!otp) {
      if (!username || username === user.username) {
        return res.status(400).json({ error: 'No changes to update' });
      }
      if (email || password) {
        return res.status(400).json({ error: 'OTP required for email or password changes' });
      }
      if (username.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters' });
      }
      db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (row) return res.status(400).json({ error: 'Username already taken' });
        db.run('UPDATE users SET username = ? WHERE id = ?', [username, userId], function(err) {
          if (err) {
            console.error('[DB] Error updating username:', err);
            return res.status(500).json({ error: 'Failed to update username' });
          }
          db.get('SELECT id, username, email, avatar, is_verified FROM users WHERE id = ?', [userId], (err, updatedUser) => {
            if (err || !updatedUser) {
              return res.status(500).json({ error: 'Failed to fetch updated user' });
            }
            res.json({ success: true, user: updatedUser });
          });
        });
      });
      return;
    }

    // F-03 fix: verifikasi via helper (attempt counter + lockout)
    checkOtp(user.email, otp, async (err, otpRow) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to verify OTP' });
        }
        if (otpRow && otpRow.locked) {
          return res.status(429).json({ error: 'Too many failed attempts. Request a new OTP.' });
        }
        if (!otpRow) {
          return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        // Mark OTP as used
        db.run('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [otpRow.id]);

        // Build update query
        let updates = [];
        let params = [];
        let hasChanges = false;

        // Check username
        if (username && username !== user.username) {
          if (username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
          }
          // Check username not taken
          const existing = await new Promise((resolve) => {
            db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId], (err, row) => {
              resolve(row);
            });
          });
          if (existing) {
            return res.status(400).json({ error: 'Username already taken' });
          }
          updates.push('username = ?');
          params.push(username);
          hasChanges = true;
        }

        // If no OTP provided, only allow username-only changes
        if (!otp) {
          if (hasChanges && updates.length === 1 && updates[0] === 'username = ?') {
            // Execute username update
            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
            params.push(userId);
            db.run(query, params, function(err) {
              if (err) {
                console.error('[DB] Error updating username:', err);
                return res.status(500).json({ error: 'Failed to update username' });
              }
              db.get('SELECT id, username, email, avatar, is_verified FROM users WHERE id = ?', [userId], (err, updatedUser) => {
                if (err || !updatedUser) {
                  return res.status(500).json({ error: 'Failed to fetch updated user' });
                }
                res.json({ success: true, user: updatedUser });
              });
            });
            return;
          } else {
            return res.status(400).json({ error: 'OTP required for email or password changes' });
          }
        }

        // Check email
        if (email && email !== user.email) {
          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
          }
          // Check email not taken
          const existing = await new Promise((resolve) => {
            db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId], (err, row) => {
              resolve(row);
            });
          });
          if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          updates.push('email = ?');
          params.push(email);
          hasChanges = true;
        }

        // Check password
        if (password) {
          if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
          }
          const hashedPassword = await bcrypt.hash(password, 10);
          updates.push('password = ?');
          params.push(hashedPassword);
          hasChanges = true;
        }

        if (!hasChanges) {
          return res.status(400).json({ error: 'No changes to update' });
        }

        // Execute update
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        params.push(userId);

        db.run(query, params, function(err) {
          if (err) {
            console.error('[DB] Error updating profile:', err);
            return res.status(500).json({ error: 'Failed to update profile' });
          }

          // Get updated user (without password)
          db.get('SELECT id, username, email, avatar, is_verified FROM users WHERE id = ?', [userId], (err, updatedUser) => {
            if (err || !updatedUser) {
              return res.status(500).json({ error: 'Failed to fetch updated user' });
            }
            res.json({ success: true, user: updatedUser });
          });
        });
    });
  });
});

module.exports = router;
