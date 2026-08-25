const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
require('dotenv').config();

const db = require('./database/db');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/user');
const socketHandler = require('./socket/handler');

const app = express();
app.disable('x-powered-by'); // ZAP 10037: sembunyikan fingerprint framework
const server = http.createServer(app);
// ponytail: 17MB — ciphertext file membengkak ~1.9x (base64 + AES); cap client 8MB -> ~15MB paket (F-11)
const io = socketIO(server, { maxHttpBufferSize: 17e6 });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// F-09: security headers — stdlib, tanpa dependensi baru
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // ponytail: HSTS hanya efektif saat HTTPS; di belakang proxy TLS tambahkan app.set('trust proxy', 1)
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // ponytail: style 'unsafe-inline' karena UI pakai atribut style=; naik ke nonce kalau CSS dipisah
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  // ponytail: guide.html sengaja di-embed via iframe di chat.html — izinkan frame same-origin hanya untuk file ini
  setHeaders(res, filePath) {
    if (filePath.endsWith('guide.html')) {
      const csp = res.getHeader('Content-Security-Policy');
      if (csp) res.setHeader('Content-Security-Policy', String(csp).replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/user', userRoutes);

// Serve static pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify-otp.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guide.html'));
});

// ZAP 10055: finalhandler menimpa CSP 404/error dengan "default-src 'none'"
// (tanpa frame-ancestors/form-action). Tangani sendiri agar header CSP ketat
// dari middleware atas tetap terpakai di SEMUA respons.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize Socket.io
socketHandler(io);
require('./socket/notify').setIo(io);

// Start server
server.listen(PORT, () => {
  console.log(`✓ [Server] AegisChat running on http://localhost:${PORT}`);
  console.log(`✓ [Database] SQLite database initialized`);
  
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠ [Warning] SMTP credentials not configured. Please set up .env file for OTP email functionality.');
  }
});
