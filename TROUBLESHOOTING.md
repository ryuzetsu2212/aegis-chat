# TROUBLESHOOTING - AegisChat

## Masalah: Login dengan akun lain tapi tetap menampilkan akun lama

### Penyebab:
- **localStorage browser masih menyimpan data session lama**
- Browser cache tidak terhapus setelah logout
- Multiple tab/window browser dengan akun berbeda

### Solusi:

#### 1. **Clear Cache dari Login Page** (Recommended)
- Buka halaman login: `http://localhost:3000/login`
- Klik tombol **"Clear Cache & Reload"** (merah)
- Login ulang dengan akun yang benar

#### 2. **Manual Clear localStorage**
Buka Browser DevTools (F12) > Console, jalankan:
```javascript
localStorage.clear();
location.reload();
```

#### 3. **Hard Refresh Browser**
- Windows/Linux: `Ctrl + Shift + R` atau `Ctrl + F5`
- Mac: `Cmd + Shift + R`

#### 4. **Logout dengan Benar**
- Selalu klik tombol **"Logout"** di navbar
- Jangan langsung close tab
- Logout sekarang sudah otomatis clear localStorage

### Debug Mode:
Sekarang aplikasi memiliki console logging untuk tracking:
- Buka DevTools (F12) > Console
- Lihat log: `[DEBUG] Current logged in user: {username, email, id}`
- Pastikan username yang ditampilkan sesuai dengan akun login

### Contoh Console Log:
```
[DEBUG] Login page loaded, localStorage: null
[DEBUG] Login successful, stored user: {id: 2, username: "testuser", email: "test@mail.com"}
[DEBUG] Current logged in user: {id: 2, username: "testuser", email: "test@mail.com"}
```

---

## Catatan Penting:
- **"Logged in as [username]"** di status bar = akun yang SEDANG LOGIN
- **Profile sidebar kanan** = kontak yang DIPILIH (bukan akun login)
- Jika menampilkan "No contact selected" = belum pilih kontak dari sidebar kiri
