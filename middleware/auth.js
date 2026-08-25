// F-01 fix: session cookie HMAC-signed (stdlib), requireAuth, rate limit
// ponytail: tanpa dependensi baru — express-session/jwt tidak ada di package.json;
// upgrade ke express-session + connect-sqlite kalau butuh revocation server-side
const crypto = require('crypto');

const COOKIE_NAME = 'aegis_sid';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
// ponytail: secret acak per boot kalau env kosong — restart memaksa semua user re-login;
// set SESSION_SECRET di .env agar sesi bertahan lintas restart
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function issueSession(res, userId) {
  const value = `${userId}.${Date.now() + SESSION_TTL_MS}`;
  const token = `${value}.${sign(value)}`;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function readSession(reqOrCookie) {
  const cookieHeader = typeof reqOrCookie === 'string' ? reqOrCookie : reqOrCookie.headers.cookie;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;\\s]+)`).exec(cookieHeader || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  try {
    const expected = Buffer.from(sign(`${userId}.${exp}`));
    if (!crypto.timingSafeEqual(expected, Buffer.from(mac))) return null;
  } catch {
    return null;
  }
  if (Number(exp) < Date.now()) return null;
  const id = Number(userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function requireAuth(req, res, next) {
  const uid = readSession(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  req.userId = uid; // satu-satunya sumber identitas server-side
  next();
}

// ponytail: limiter in-memory cukup utk skala ini; ganti express-rate-limit kalau multi-instance
const hits = new Map();
function rateLimit(windowMs, max) {
  return (req, res, next) => {
    if (hits.size > 10000) hits.clear();
    const key = `${req.ip}:${Math.floor(Date.now() / windowMs)}`;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'Too many requests, slow down' });
    next();
  };
}

module.exports = { COOKIE_NAME, issueSession, clearSession, readSession, requireAuth, rateLimit };
