# Setup Guide untuk AegisChat

## Konfigurasi SMTP Email (Penting!)

### Opsi 1: Gmail (Recommended)

1. **Enable 2-Factor Authentication**
   - Buka [Google Account Security](https://myaccount.google.com/security)
   - Aktifkan "2-Step Verification"

2. **Generate App Password**
   - Buka [App Passwords](https://myaccount.google.com/apppasswords)
   - Pilih "Mail" dan "Other (Custom name)"
   - Beri nama "AegisChat"
   - Copy 16-digit password yang di-generate

3. **Update .env file**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=youremail@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx  # App Password dari langkah 2
```

### Opsi 2: Outlook/Hotmail

```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=youremail@outlook.com
SMTP_PASS=your-password
```

### Opsi 3: Custom SMTP

```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-password
```

## Testing Checklist

### 1. Test Registration & OTP
- [ ] Register dengan username unik
- [ ] Cek email masuk (check spam folder juga)
- [ ] Copy kode OTP 6 digit
- [ ] Verify OTP di halaman verifikasi
- [ ] Redirect ke login page setelah sukses

### 2. Test Login
- [ ] Login dengan username dan password yang benar
- [ ] Test dengan password salah (harus error)
- [ ] Test dengan akun belum verified (harus ditolak)

### 3. Test Chat & Encryption
- [ ] Register 2 akun berbeda (User A & User B)
- [ ] Login User A di browser normal
- [ ] Login User B di incognito/private window

**Test Scenario:**
1. User A pilih User B di contact list
2. User A ketik pesan: "Hello secret message"
3. User A input secret key: "mykey123"
4. Klik ENCRYPT → pesan jadi ciphertext
5. Klik ▶ untuk send
6. User B akan menerima ciphertext
7. User B klik DECRYPT, masukkan "mykey123"
8. Pesan terdekripsi jadi plaintext

**Test dengan Wrong Key:**
1. User B coba decrypt dengan key berbeda
2. Harus gagal dengan error message

### 4. Test Real-time Updates
- [ ] User A kirim pesan
- [ ] User B langsung menerima tanpa refresh
- [ ] Check timestamp pada pesan

## Troubleshooting

### Email OTP tidak terkirim

**Problem:** Error "Failed to send OTP email"

**Solution:**
1. Cek SMTP credentials di `.env`
2. Pastikan App Password sudah benar (bukan password biasa)
3. Test koneksi SMTP:
```javascript
// Tambah di utils/email.js untuk testing
transporter.verify((error, success) => {
  if (error) {
    console.log('SMTP Error:', error);
  } else {
    console.log('SMTP Ready');
  }
});
```

### Database Error

**Problem:** "SQLITE_ERROR: no such table"

**Solution:**
```bash
# Hapus database lama dan restart
rm database/aegis.db
npm start
```

### Port Already in Use

**Problem:** "Error: listen EADDRINUSE: address already in use :::3000"

**Solution:**
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Atau gunakan port lain di .env
PORT=3001
```

### WebSocket Connection Failed

**Problem:** Chat tidak real-time

**Solution:**
1. Pastikan server running
2. Cek browser console untuk error
3. Test socket connection:
```javascript
// Di browser console
socket.on('connect', () => console.log('Connected!'));
socket.on('disconnect', () => console.log('Disconnected!'));
```

## Production Deployment

### Environment Variables
```env
NODE_ENV=production
PORT=3000
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=production@yourdomain.com
SMTP_PASS=your-app-password
APP_NAME=AegisChat
APP_URL=https://yourdomain.com
```

### Security Checklist
- [ ] Gunakan HTTPS untuk production
- [ ] Enable rate limiting untuk API endpoints
- [ ] Implement CSRF protection
- [ ] Set secure cookies
- [ ] Regular database backups
- [ ] Monitor failed login attempts

### Recommended Hosting
- **Backend:** Heroku, Railway, Render, DigitalOcean
- **Database:** Persistent volume atau PostgreSQL untuk production
- **Domain:** Cloudflare untuk SSL/TLS

## Performance Tips

1. **Database Indexing**
```sql
CREATE INDEX idx_messages_users ON messages(sender_id, receiver_id);
CREATE INDEX idx_users_username ON users(username);
```

2. **Message Pagination**
Implement lazy loading untuk chat history (load 50 messages pertama)

3. **WebSocket Rooms**
Gunakan Socket.io rooms untuk mengirim pesan hanya ke recipient tertentu

## Security Best Practices

1. **Never log sensitive data**
   - Jangan log password atau secret keys
   - Jangan log ciphertext di production

2. **Input Validation**
   - Sudah ada: username min 3 chars, password min 6 chars
   - Consider: email validation, XSS sanitization

3. **Rate Limiting**
   - Implement untuk login endpoint (prevent brute force)
   - Implement untuk OTP generation (prevent spam)

4. **Session Management**
   - Consider JWT tokens untuk production
   - Implement token expiration
   - Add refresh token mechanism

## Development Tips

### Hot Reload
```bash
npm install -g nodemon
nodemon server.js
```

### Debug Mode
```javascript
// Tambah di server.js
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev')); // HTTP request logger
}
```

### Database Viewer
```bash
npm install -g sqlite3
sqlite3 database/aegis.db
.tables
SELECT * FROM users;
```

## FAQ

**Q: Apakah pesan bisa didekripsi oleh server?**
A: Tidak. Enkripsi dilakukan 100% di client-side. Server hanya menerima dan menyimpan ciphertext.

**Q: Bagaimana jika lupa Secret Key?**
A: Pesan tidak dapat didekripsi. Ini by design untuk keamanan maksimal.

**Q: Apakah bisa kirim file/gambar?**
A: Versi saat ini hanya text. Untuk file, perlu tambahan:
- Multer untuk upload
- Encrypt file di client sebelum upload
- Store encrypted file di server

**Q: Database production sebaiknya apa?**
A: SQLite cukup untuk <100 concurrent users. Untuk scale lebih besar, migrasi ke PostgreSQL.
