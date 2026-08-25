# DESIGN SYSTEM — AEGISCHAT (v2)

## Identitas
- Produk: chat terenkripsi end-to-end
- Mood: aman, teknis, dark-premium
- Prinsip:
  1. Keamanan harus TERLIHAT (gembok, badge, mono ciphertext)
  2. Semua data user DINAMIS — dilarang hardcode teks
  3. Setiap state didesain (empty/loading/error/sukses)

## Colors
- bg-base:       #14161B
- bg-surface:    #1E222A
- bg-elevated:   #262B33
- primary:       #10B981
- primary-hover: #34D399
- primary-tint:  rgba(16,185,129,0.08)
- danger:        #EF4444
- text:          #F4F4F5
- text-muted:    #A1A1AA
- border:        #2A2F38
- status-online:  #10B981
- status-offline: #71717A
- status-busy:    #EF4444

## Typography
- UI/Body: "Inter" 400/500/600
- Ciphertext: "JetBrains Mono" 400
- nav/body 14px | ciphertext 12px | kecil 11px | judul 16-20px

## Radius & Spacing
- bubble 10px | card 12px | tombol 8px
- spacing kelipatan 4 | bubble max-width 65% (mobile 85%)

## Icons
- WAJIB Lucide. DILARANG emoji sebagai ikon.
- inline 16px | tombol 18-20px

## Nilai Dinamis (ATURAN GLOBAL)
- {username} → dari session; avatar inisial = 2 huruf pertama uppercase
- {contact_name} & {status} → dari data kontak terpilih
- {time}/{timestamp} → live-update / dari data pesan
- Semua pesan, file, ukuran → render dari data, bukan contoh

## KOMPONEN

### Navbar (60px, bg-surface, border-b)
- Kiri: ShieldCheck dalam kotak primary + "AegisChat" 600
- Kanan: nav links (active=primary) | separator |
  {time} kecil muted | avatar inisial + {username} | LogOut icon button

### Contact Bar
- Avatar inisial {contact_name}
- Nama 600 + dot {status} + label status muted
- Kanan: ghost button "Kontak" + icon Users

### Bubble Masuk (kiri)
- bg-surface, radius 10px (bl 2px), tanpa border

### Bubble Keluar (kanan)
- primary-tint, radius 10px (br 2px),
  border 1px rgba(16,185,129,0.15) halus

### Isi Bubble
- Ciphertext: mono 12px muted, break-all
- Aksi: icon button muncul saat hover
  (LockKeyholeOpen=decrypt, Trash2=hapus/danger)
- Footer: {timestamp} 11px muted + CheckCheck 14px primary

### Encrypted File Card
- bg-elevated, radius 12px, p-12
- Kotak 40px primary-tint + FileLock2 primary
- Nama truncate (~24 char) + title attribute
- Sub: {size} + badge "Terenkripsi" (Lock 12px)
- DECRYPT kecil (h-7, text-xs) + Loader2 saat proses
- Setelah decrypt: thumbnail + Download + Re-encrypt

### Composer (bg-surface, border-t, p-12)
- Input pesan flex-1
- Paperclip icon button (attach)
- Input key: KeyRound, type password, toggle Eye/EyeOff
- ENCRYPT outline + Lock
- SEND solid primary + Send

### Scrollbar
- 8px, thumb #2A2F38, radius 4

## STATES
- Empty chat: Lock besar muted + "Percakapan terenkripsi
  end-to-end. Kirim pesan pertama."
- Loading: Loader2 spin di tombol aktif
- Error: toast danger + AlertCircle (key salah)
- Sukses: toast primary kecil

## HALAMAN LAIN (bahasa sama)
- Contacts: search input + list card (avatar inisial, nama,
  dot status, tombol MessageSquare); empty: UsersOff
- Profile: card form (label 12px muted, input bg-elevated),
  Simpan solid primary; danger zone border danger/30
- Guide: section langkah bernomor + card icon
  (Lock, KeyRound, FileLock2)