const db = require('../database/db');
const { readSession } = require('../middleware/auth');

module.exports = (io) => {
  const users = new Map(); // Map socketId -> userData

  // F-06: handshake auth — pakai cookie sesi yang sama dengan REST; koneksi anonim ditolak
  io.use((socket, next) => {
    const userId = readSession(socket.handshake.headers.cookie);
    if (!userId) return next(new Error('Unauthorized'));
    db.get('SELECT id, username FROM users WHERE id = ?', [userId], (err, row) => {
      if (err || !row) return next(new Error('Unauthorized'));
      socket.userId = row.id;       // identitas server-side, bukan dari payload klien
      socket.username = row.username;
      next();
    });
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] New connection: ${socket.id} (${socket.username})`);

    // F-06: room per username — semua tab user yang sama; dipakai targeted emit DM/read receipt
    socket.join(socket.username);
    socket.userData = { id: socket.userId, username: socket.username }; // dipakai socket/notify.toUser
    users.set(socket.id, socket.userData);

    // Broadcast daftar online — sekarang hanya ke socket ter-autentikasi
    io.emit('online_users', Array.from(users.values()));

    // Typing indicator (username dari session; hanya ke room penerima)
    socket.on('typing', (data) => {
      if (!data || !data.recipientUsername) return;
      io.to(data.recipientUsername).emit('user_typing', {
        username: socket.username,
        recipientUsername: data.recipientUsername
      });
    });

    socket.on('stop_typing', (data) => {
      if (!data || !data.recipientUsername) return;
      io.to(data.recipientUsername).emit('user_stop_typing', {
        username: socket.username,
        recipientUsername: data.recipientUsername
      });
    });

    // Receive encrypted message (text or file)
    socket.on('send_message', (data) => {
      const sender = socket.username; // F-06: sender dari session, bukan payload klien
      const { receiver, ciphertext, type, fileName, fileSize, mimeType } = data;
      if (!receiver || !ciphertext) return;

      // DM gate: must be mutual contacts; block check stays as second layer
      db.get(
        `SELECT
           (SELECT COUNT(*) FROM blocked_users 
            WHERE (user_id = (SELECT id FROM users WHERE username = ?) 
                   AND blocked_user_id = (SELECT id FROM users WHERE username = ?))
               OR (user_id = (SELECT id FROM users WHERE username = ?) 
                   AND blocked_user_id = (SELECT id FROM users WHERE username = ?))) as blocked_count,
           (SELECT COUNT(*) FROM contacts
            WHERE user_id = (SELECT id FROM users WHERE username = ?)
              AND contact_id = (SELECT id FROM users WHERE username = ?)) as contact_count`,
        [receiver, sender, sender, receiver, sender, receiver],
        (err, row) => {
          if (err) {
            console.error('[DB] Error checking block status:', err);
            socket.emit('message_error', { error: 'Failed to send message' });
            return;
          }

          if (row.blocked_count > 0) {
            console.log(`[Socket] Message blocked: ${sender} -> ${receiver} (blocked)`);
            socket.emit('message_blocked', { 
              message: 'Cannot send message to this user',
              receiver 
            });
            return;
          }

          if (row.contact_count === 0) {
            console.log(`[Socket] Message rejected: ${sender} -> ${receiver} (not contacts)`);
            socket.emit('message_blocked', {
              message: 'You can only message your contacts',
              receiver
            });
            return;
          }

          // Build query based on type
          const isFile = type === 'file';
          const query = isFile
            ? `INSERT INTO messages (sender_id, receiver_id, ciphertext, type, file_name, file_size, mime_type) VALUES (
                (SELECT id FROM users WHERE username = ?),
                (SELECT id FROM users WHERE username = ?),
                ?, ?, ?, ?, ?
              )`
            : `INSERT INTO messages (sender_id, receiver_id, ciphertext, type) VALUES (
                (SELECT id FROM users WHERE username = ?),
                (SELECT id FROM users WHERE username = ?),
                ?, ?
              )`;

          const params = isFile
            ? [sender, receiver, ciphertext, type, fileName || 'file', fileSize || 0, mimeType || 'application/octet-stream']
            : [sender, receiver, ciphertext, type || 'text'];

          db.run(query, params, function(err) {
            if (err) {
              console.error('[DB] Error storing message:', err);
              return;
            }

            // Broadcast to all clients
            const payload = {
              id: this.lastID,
              sender,
              receiver,
              ciphertext,
              type: type || 'text',
              timestamp: new Date().toISOString()
            };
            if (isFile) {
              payload.fileName = fileName || 'file';
              payload.fileSize = fileSize || 0;
              payload.mimeType = mimeType || 'application/octet-stream';
            }
            // F-06: targeted emit — hanya kedua party (semua tab masing-masing), bukan broadcast
            io.to(sender).to(receiver).emit('receive_message', payload);
          });
        }
      );
    });

    // Receive encrypted group message
    socket.on('send_group_message', (data) => {
      const sender = socket.username; // F-06: sender dari session
      const { groupId, ciphertext, type, fileName, fileSize, mimeType } = data;

      if (!groupId || !ciphertext) return;

      // Sender must be a member of the group
      db.get(
        `SELECT 1 FROM group_members
         WHERE group_id = ? AND user_id = (SELECT id FROM users WHERE username = ?)`,
        [groupId, sender],
        (err, row) => {
          if (err || !row) {
            socket.emit('message_error', { error: 'You are not a member of this group' });
            return;
          }

          const isFile = type === 'file';
          const query = isFile
            ? `INSERT INTO group_messages (sender_id, group_id, ciphertext, type, file_name, file_size, mime_type)
               VALUES ((SELECT id FROM users WHERE username = ?), ?, ?, ?, ?, ?, ?)`
            : `INSERT INTO group_messages (sender_id, group_id, ciphertext, type)
               VALUES ((SELECT id FROM users WHERE username = ?), ?, ?, ?)`;

          const params = isFile
            ? [sender, groupId, ciphertext, type, fileName || 'file', fileSize || 0, mimeType || 'application/octet-stream']
            : [sender, groupId, ciphertext, type || 'text'];

          db.run(query, params, function (err2) {
            if (err2) {
              console.error('[DB] Error storing group message:', err2);
              socket.emit('message_error', { error: 'Failed to send message' });
              return;
            }

            const payload = {
              id: this.lastID,
              sender,
              groupId,
              ciphertext,
              type: type || 'text',
              timestamp: new Date().toISOString()
            };
            if (isFile) {
              payload.fileName = fileName || 'file';
              payload.fileSize = fileSize || 0;
              payload.mimeType = mimeType || 'application/octet-stream';
            }

            // Route ciphertext to every online member (including sender for confirmation)
            db.all(
              `SELECT u.username FROM group_members gm
               JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?`,
              [groupId],
              (err3, members) => {
                if (err3) {
                  console.error('[DB] Error fetching group members:', err3);
                  return;
                }
                let sent = 0;
                for (const [sid, userData] of users) {
                  if (members.some(m => m.username === userData.username)) {
                    io.to(sid).emit('group_message', payload);
                    sent++;
                  }
                }
                console.log(`[Socket] Group message routed to ${sent} online member(s) of group ${groupId}`);
              }
            );
          });
        }
      );
    });

    // Mark message as read — F-06: hanya pesan yang ditujukan ke saya
    socket.on('mark_read', (data) => {
      const { messageIds } = data;
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;
      const ids = messageIds.map(Number).filter(Number.isInteger).slice(0, 999); // ponytail: batas placeholder SQLite (F-11)
      if (ids.length === 0) return;

      const placeholders = ids.map(() => '?').join(',');
      db.all(
        `SELECT DISTINCT (SELECT username FROM users WHERE id = m.sender_id) AS sender
         FROM messages m WHERE m.id IN (${placeholders}) AND m.receiver_id = ? AND m.read_at IS NULL`,
        [...ids, socket.userId],
        (err, rows) => {
          if (err) {
            console.error('[DB] Error checking read messages:', err);
            return;
          }
          db.run(
            `UPDATE messages SET read_at = CURRENT_TIMESTAMP
             WHERE id IN (${placeholders}) AND receiver_id = ? AND read_at IS NULL`,
            [...ids, socket.userId],
            (err2) => {
              if (err2) {
                console.error('[DB] Error marking messages as read:', err2);
                return;
              }
              // F-06: receipt hanya ke pengirim terkait + diri sendiri, bukan broadcast
              const targets = new Set([socket.username, ...rows.map(r => r.sender)]);
              targets.forEach(u => io.to(u).emit('messages_read', { messageIds: ids }));
              console.log(`[Socket] Messages marked as read by ${socket.username}:`, ids);
            }
          );
        }
      );
    });

    // Delete message
    socket.on('delete_message', (data) => {
      const username = socket.username; // F-06: identitas dari session
      const messageId = data.messageId;

      // Check if message exists and belongs to user (DM or group), and is within 24 hours
      db.get(
        `SELECT id, created_at, username FROM (
           SELECT m.id, m.created_at, u.username
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id = ?
           UNION ALL
           SELECT g.id, g.created_at, u.username
           FROM group_messages g
           JOIN users u ON g.sender_id = u.id
           WHERE g.id = ?
         )`,
        [messageId, messageId],
        (err, row) => {
          if (err) {
            console.error('[DB] Error checking message:', err);
            socket.emit('delete_error', { error: 'Database error' });
            return;
          }

          if (!row) {
            socket.emit('delete_error', { error: 'Message not found' });
            return;
          }

          if (row.username !== username) {
            socket.emit('delete_error', { error: 'Unauthorized' });
            return;
          }

          // Check 24-hour limit
          const messageTime = new Date(row.created_at).getTime();
          const now = Date.now();
          const hoursDiff = (now - messageTime) / (1000 * 60 * 60);

          if (hoursDiff > 24) {
            socket.emit('delete_error', { error: 'Cannot delete messages older than 24 hours' });
            return;
          }

          // Delete message (DM or group table — one will no-op)
          db.run('DELETE FROM messages WHERE id = ?', [messageId], () => {
            db.run('DELETE FROM group_messages WHERE id = ?', [messageId], (err) => {
              if (err) {
                console.error('[DB] Error deleting message:', err);
                socket.emit('delete_error', { error: 'Failed to delete message' });
                return;
              }

              // Broadcast deletion to all clients
              io.emit('message_deleted', { messageId });
              console.log(`[Socket] Message ${messageId} deleted by ${username}`);
            });
          });
        }
      );
    });

    // Bulk delete messages
    socket.on('bulk_delete_messages', (data) => {
      const username = socket.username; // F-06: identitas dari session
      const messageIds = Array.isArray(data.messageIds)
        ? data.messageIds.map(Number).filter(Number.isInteger).slice(0, 400) // ponytail: x2 placeholder < limit 999 SQLite (F-11)
        : [];
      if (messageIds.length === 0) return;

      // Check all messages belong to user and are within 24 hours
      const placeholders = messageIds.map(() => '?').join(',');
      db.all(
        `SELECT id, created_at, username FROM (
           SELECT m.id, m.created_at, u.username
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id IN (${placeholders})
           UNION ALL
           SELECT g.id, g.created_at, u.username
           FROM group_messages g
           JOIN users u ON g.sender_id = u.id
           WHERE g.id IN (${placeholders})
         )`,
        [...messageIds, ...messageIds],
        (err, rows) => {
          if (err) {
            console.error('[DB] Error checking messages:', err);
            socket.emit('delete_error', { error: 'Database error' });
            return;
          }

          // Validate ownership and 24-hour limit
          const now = Date.now();
          const validIds = [];
          const errors = [];

          rows.forEach(row => {
            if (row.username !== username) {
              errors.push(`Message ${row.id}: Unauthorized`);
              return;
            }
            const messageTime = new Date(row.created_at).getTime();
            const hoursDiff = (now - messageTime) / (1000 * 60 * 60);
            if (hoursDiff > 24) {
              errors.push(`Message ${row.id}: Older than 24 hours`);
              return;
            }
            validIds.push(row.id);
          });

          if (validIds.length === 0) {
            socket.emit('delete_error', { error: 'No valid messages to delete' });
            return;
          }

          // Delete valid messages (DM + group table)
          const deletePlaceholders = validIds.map(() => '?').join(',');
          db.run(
            `DELETE FROM messages WHERE id IN (${deletePlaceholders})`,
            validIds,
            () => {
              db.run(
                `DELETE FROM group_messages WHERE id IN (${deletePlaceholders})`,
                validIds,
                (err) => {
                  if (err) {
                    console.error('[DB] Error bulk deleting messages:', err);
                    socket.emit('delete_error', { error: 'Failed to delete messages' });
                    return;
                  }

                  // Broadcast deletions to all clients
                  io.emit('messages_bulk_deleted', { messageIds: validIds });
                  console.log(`[Socket] Bulk deleted ${validIds.length} messages by ${username}`);

                  if (errors.length > 0) {
                    socket.emit('delete_warning', {
                      message: `Deleted ${validIds.length} messages. ${errors.length} failed.`,
                      errors
                    });
                  }
                }
              );
            }
          );
        }
      );
    });

    // User disconnects
    socket.on('disconnect', () => {
      const userData = users.get(socket.id);
      if (userData) {
        users.delete(socket.id);
        console.log(`[Socket] ${userData.username} disconnected`);
        const onlineUsers = Array.from(users.values());
        io.emit('online_users', onlineUsers);
      }
    });
  });
};
