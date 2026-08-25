// F-05: WebCrypto AES-256-GCM + PBKDF2-SHA256 (310k iterasi) — pengganti CryptoJS
// passphrase-mode (EVP_BytesToKey MD5 1 iter + CBC tanpa MAC).
// Format baru : "agcv1.<saltB64>.<ivB64>.<ciphertextB64>" (GCM tag menempel di ciphertext).
// Format lama ("U2FsdGVkX1…", CryptoJS OpenSSL) masih bisa didecrypt via fallback —
// pesan lama tidak migrasi, pesan baru otomatis pakai format GCM.
const PBKDF2_ITERATIONS = 310000; // OWASP P3 utk PBKDF2-HMAC-SHA256 interaktif
const AAD = new TextEncoder().encode('aegischat:v1');

// ponytail: chunked String.fromCharCode — spread `(...bytes)` overflow call stack utk file besar
const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMessage(plaintext, secretKey) {
  if (!plaintext || !secretKey) {
    appAlert('Please enter both message and secret key');
    return null;
  }

  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secretKey, salt);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, new TextEncoder().encode(plaintext))
    );
    return `agcv1.${b64(salt)}.${b64(iv)}.${b64(ct)}`;
  } catch (error) {
    console.error('[Crypto] Encryption error:', error);
    appAlert('Encryption failed');
    return null;
  }
}

async function decryptMessage(ciphertext, secretKey) {
  if (!ciphertext || !secretKey) {
    appAlert('Secret key is required for decryption');
    return null;
  }

  // Legacy fallback: pesan lama format CryptoJS OpenSSL ("U2FsdGVkX1...")
  if (typeof ciphertext === 'string' && ciphertext.startsWith('U2FsdGVkX1')) {
    try {
      const decrypted = CryptoJS.AES.decrypt(ciphertext, secretKey);
      const plaintext = decrypted.toString(CryptoJS.enc.Utf8);

      if (!plaintext) {
        appAlert('Decryption failed. Wrong secret key?');
        return null;
      }

      return plaintext;
    } catch (error) {
      console.error('[Crypto] Legacy decryption error:', error);
      appAlert('Decryption failed. Wrong secret key?');
      return null;
    }
  }

  try {
    const parts = String(ciphertext).split('.');
    if (parts.length !== 4 || parts[0] !== 'agcv1') throw new Error('Unknown ciphertext format');

    const key = await deriveKey(secretKey, unb64(parts[1]));
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(parts[2]), additionalData: AAD },
      key,
      unb64(parts[3])
    );
    return new TextDecoder().decode(pt);
  } catch (error) {
    // GCM auth tag gagal = key salah ATAU ciphertext ditamper
    console.error('[Crypto] Decryption error:', error);
    appAlert('Decryption failed. Wrong secret key?');
    return null;
  }
}

// Export functions for global use
window.encryptMessage = encryptMessage;
window.decryptMessage = decryptMessage;
