// Self-check F-01 session module — jalankan: node tests/test-session-auth.js
// ponytail: assert-based tanpa framework; hapus kalau pindah ke test runner beneran
const assert = require('assert');
process.env.SESSION_SECRET = 'selfcheck-secret';
const { issueSession, clearSession, readSession, requireAuth } = require('../middleware/auth');

const headers = {};
const res = {
  setHeader: (k, v) => { if (k === 'Set-Cookie') headers.cookie = v; }
};

// roundtrip valid
issueSession(res, 42);
const cookieHeader = headers.cookie; // "aegis_sid=userId.exp.mac; Path=..."
assert.ok(cookieHeader.startsWith('aegis_sid='), 'cookie name');
assert.ok(/HttpOnly/.test(cookieHeader) && /SameSite=Strict/.test(cookieHeader), 'flags HttpOnly+SameSite');
const token = cookieHeader.split(';')[0].split('=')[1];
assert.strictEqual(readSession({ headers: { cookie: `aegis_sid=${token}` } }), 42, 'valid token -> userId');

// tampered mac
const bad = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
assert.strictEqual(readSession({ headers: { cookie: `aegis_sid=${bad}` } }), null, 'tampered -> null');

// garbage cookie
assert.strictEqual(readSession({ headers: { cookie: 'garbage' } }), null, 'garbage -> null');
assert.strictEqual(readSession({ headers: { cookie: '' } }), null, 'empty -> null');

// expired: forge dgn secret test (exp di masa lalu)
const crypto = require('crypto');
function sign(v) { return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(v).digest('base64url'); }
const expired = `7.${Date.now() - 1000}.${sign(`7.${Date.now() - 1000}`)}`;
assert.strictEqual(readSession({ headers: { cookie: `aegis_sid=${expired}` } }), null, 'expired -> null');

// requireAuth reject tanpa cookie
let statusCode = 0;
requireAuth(
  { headers: {} },
  { status: (c) => ({ json: () => { statusCode = c; } }) },
  () => { throw new Error('next harusnya tidak dipanggil'); }
);
assert.strictEqual(statusCode, 401, 'no cookie -> 401');

// clearSession
delete headers.cookie;
clearSession(res);
assert.ok(/Max-Age=0/.test(headers.cookie), 'clear -> Max-Age=0');

console.log('OK: 8/8 session self-check passed');
