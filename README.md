# AegisChat - Secure E2EE Messaging Platform

Aplikasi chat end-to-end encrypted dengan autentikasi OTP email dan enkripsi AES-256 manual di sisi klien.

## 🚀 Fitur Utama

- **Autentikasi Terpisah**: Register → OTP Email → Verifikasi → Login
- **End-to-End Encryption**: AES-256 manual dengan CryptoJS (client-side)
- **Real-time Chat**: WebSocket menggunakan Socket.io
- **UI Modern & Profesional**: Palet warna gelap berkelas (charcoal/navy)
- **Privacy-First**: Server hanya menerima dan menyimpan ciphertext

## 📋 Persyaratan

- Node.js v14+
- NPM atau Yarn
- SMTP Email (Gmail/Outlook untuk OTP)

## 🛠️ Instalasi

1. Clone repository
```bash
cd aegis-chat
```

2. Install dependencies
```bash
npm install
```

3. Konfigurasi Email SMTP

Edit file `.env` dan isi dengan kredensial email Anda:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

APP_NAME=AegisChat
APP_URL=http://localhost:3000
```

**Catatan untuk Gmail:**
- Gunakan App Password, bukan password akun biasa
- Cara membuat: Google Account → Security → 2-Step Verification → App passwords

4. Jalankan server
```bash
npm start
```

Server akan berjalan di `http://localhost:3000`

## 📱 Cara Penggunaan

### 1. Registrasi Akun
- Buka `http://localhost:3000`
- Isi Username, Email, dan Password
- Klik **CREATE ACCOUNT**
- Cek email untuk kode OTP (6 digit)

### 2. Verifikasi Email
- Masukkan kode OTP yang diterima via email
- Klik **VERIFY**
- Akun akan diaktifkan

### 3. Login
- Masukkan Username dan Password
- Klik **LOGIN**

### 4. Chat dengan Enkripsi E2EE

**Mengirim Pesan:**
1. Pilih kontak dari sidebar kiri
2. Ketik pesan di kolom input
3. Masukkan **Secret Key** (password enkripsi)
4. Klik tombol **ENCRYPT**
5. Klik tombol **▶** untuk mengirim

**Menerima & Dekripsi Pesan:**
1. Pesan masuk akan tampil sebagai ciphertext (kode acak)
2. Klik tombol **DECRYPT** pada pesan
3. Masukkan **Secret Key** yang sama dengan pengirim
4. Pesan akan terdekripsi dan tampil plaintext

## 🏗️ Struktur Arsitektur

```
aegis-chat/
├── server.js                 # Entry point server
├── database/
│   └── db.js                # SQLite schema & connection
├── routes/
│   ├── auth.js              # Register, OTP verify, Login
│   └── chat.js              # Chat history & users
├── socket/
│   └── handler.js           # WebSocket events
├── utils/
│   └── email.js             # OTP email sender
└── public/
    ├── register.html        # Halaman pendaftaran
    ├── verify-otp.html      # Halaman verifikasi OTP
    ├── login.html           # Halaman login
    ├── chat.html            # Halaman chat
    ├── styles.css           # Styling modern
    └── js/
        ├── crypto-handler.js # AES-256 encryption/decryption
        └── chat-app.js       # Chat logic & WebSocket
```

## 🔐 Keamanan

- **Password Hashing**: bcrypt dengan salt rounds 10
- **Client-Side Encryption**: AES-256 dengan CryptoJS
- **Server Storage**: Hanya ciphertext yang disimpan di database
- **OTP Expiry**: 10 menit setelah generate
- **Email Verification**: Akun tidak bisa login sebelum verifikasi

## 🎨 Design Philosophy

- **Anti AI-Slop**: Tanpa border-radius berlebihan atau glow effect
- **Professional Dark Theme**: Charcoal (#242837) & Navy (#1a1d29)
- **Accent Color**: Teal (#00d4aa)
- **Typography**: Inter untuk UI, JetBrains Mono untuk ciphertext

## 📦 Dependencies

- `express` - Web framework
- `socket.io` - Real-time WebSocket
- `sqlite3` - Database
- `bcrypt` - Password hashing
- `nodemailer` - Email sending
- `dotenv` - Environment variables
- `crypto-js` (CDN) - Client-side encryption

## 🧪 Testing

1. Buat 2 akun berbeda
2. Login dengan akun pertama di browser biasa
3. Login dengan akun kedua di incognito/private window
4. Test enkripsi/dekripsi dengan secret key yang sama dan berbeda

## ⚠️ Catatan Penting

- **Secret Key** harus sama antara pengirim dan penerima untuk dekripsi
- Secret key TIDAK disimpan di server manapun (fully client-side)
- Jika lupa secret key, pesan tidak dapat didekripsi (ini fitur, bukan bug!)
- Pastikan SMTP credentials valid agar OTP email terkirim

## 📝 License

MIT License

## 👨‍💻 Developer Notes

Sistem ini dibangun dengan fokus pada:
- Separation of concerns (routes, socket, database terpisah)
- Privacy by design (zero-knowledge encryption)
- Clean & maintainable code structure
- Professional UI/UX (anti-AI generic design)
