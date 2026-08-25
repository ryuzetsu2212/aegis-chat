// Self-check F-05 (Node >= 20, WebCrypto global): roundtrip GCM, tamper, wrong key, legacy fallback
// Jalankan: node tests/test-crypto-handler.mjs
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const alerts = [];
globalThis.appAlert = (m) => alerts.push(m);

// Stub CryptoJS minimal (browser memuatnya dari CDN) — dekripsi OpenSSL passphrase-mode via node:crypto
let _encUtf8;
function utf8FromOpenSSL(blobB64, password) {
  const raw = Buffer.from(blobB64, 'base64');
  if (!raw.subarray(0, 8).equals(Buffer.from('Salted__'))) throw new Error('not openssl blob');
  const d = evpBytesToKey(password, raw.subarray(8, 16));
  const dc = crypto.createDecipheriv('aes-256-cbc', d.subarray(0, 32), d.subarray(32, 48));
  return Buffer.concat([dc.update(raw.subarray(16)), dc.final()]).toString('utf8');
}
_encUtf8 = Symbol('utf8');
globalThis.CryptoJS = {
  enc: { Utf8: _encUtf8 },
  AES: { decrypt: (ct, pass) => ({ toString: (enc) => (enc === _encUtf8 ? utf8FromOpenSSL(ct, pass) : '') }) }
};

const src = readFileSync(path.join(here, '..', 'public', 'js', 'crypto-handler.js'), 'utf8')
  .replace(/^window\.(encrypt|decrypt)Message.*$/gm, '');
(0, eval)(src); // sloppy indirect eval -> deklarasi jadi global

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('ok  :', msg);
}

// Replika persis passphrase-mode CryptoJS (OpenSSL EVP_BytesToKey MD5 x1 + AES-256-CBC)
function evpBytesToKey(password, salt, keyLen = 32, ivLen = 16) {
  const pass = Buffer.from(password, 'utf8');
  const parts = [];
  let prev = Buffer.alloc(0);
  while (Buffer.concat(parts).length < keyLen + ivLen) {
    prev = crypto.createHash('md5').update(Buffer.concat([prev, pass, salt])).digest();
    parts.push(prev);
  }
  return Buffer.concat(parts);
}

function makeLegacyBlob(plaintext, password) {
  const salt = crypto.randomBytes(8);
  const d = evpBytesToKey(password, salt);
  const c = crypto.createCipheriv('aes-256-cbc', d.subarray(0, 32), d.subarray(32, 48));
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);
  return Buffer.concat([Buffer.from('Salted__'), salt, ct]).toString('base64');
}

const e = await encryptMessage('halo dunia ☺ <b>aman</b>', 's3cr3t-k3y');
assert(e.startsWith('agcv1.'), 'format baru agcv1');

assert((await decryptMessage(e, 's3cr3t-k3y')) === 'halo dunia ☺ <b>aman</b>', 'roundtrip GCM');

alerts.length = 0;
assert((await decryptMessage(e, 'kunci-salah')) === null && alerts.length === 1, 'wrong key -> null + alert');

const tampered = e.slice(0, -4) + (e.endsWith('AAAA') ? 'BBBB' : 'AAAA');
alerts.length = 0;
assert((await decryptMessage(tampered, 's3cr3t-k3y')) === null && alerts.length === 1, 'tampered ciphertext ditolak (GCM tag)');

const legacy = makeLegacyBlob('pesan lama terenkripsi', 'kunci-lama');
assert(legacy.startsWith('U2FsdGVkX1'), 'fixture legacy berformat OpenSSL');
assert((await decryptMessage(legacy, 'kunci-lama')) === 'pesan lama terenkripsi', 'fallback decrypt pesan lama CryptoJS');

alerts.length = 0;
await encryptMessage('', 'x');
await decryptMessage('', '');
assert(alerts.length === 2, 'argumen kosong -> alert, tanpa throw');

console.log('\nSemua self-check F-05 lolos.');