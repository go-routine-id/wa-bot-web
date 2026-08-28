# WA Bot Web

Frontend vanilla JS untuk WhatsApp bot (kontrol koneksi, template, broadcast, history). Repo ini hanya berisi web statis — backend API ada di repo terpisah [`wa-bot-service`](https://github.com/go-routine-id/wa-bot-service).

> ⚠️ **Risiko ban:** library backend mengotomasi WhatsApp Web (unofficial). Broadcast massal berisiko membuat nomor ter-block. Mulai dengan rate kecil (20/menit) dan mode `queue`.

## Quickstart

```bash
git clone git@github.com:go-routine-id/wa-bot-web.git
cd wa-bot-web
npm install
npm start            # → http://localhost:5173
```

Setelah itu:

1. **Pastikan backend jalan** — ikuti Quickstart di [wa-bot-service](https://github.com/go-routine-id/wa-bot-service) (service di `http://localhost:3000`).
2. **Set base URL API** di **`config.js`** (`window.WA_API_BASE`):
   ```js
   window.WA_API_BASE = 'http://localhost:3000';   // backend wa-bot-service terpisah
   ```
   Kosong (`''`) = same-origin bila frontend & backend di satu origin.
3. **Izinkan CORS** di service — tambahkan di `.env` wa-bot-service:
   ```bash
   CORS_ORIGINS=http://localhost:5173
   ```
4. Buka `http://localhost:5173` → tab **Koneksi** → scan QR.

## Memakai

### 1. Koneksi (tab "Koneksi")
- Scan QR dengan WhatsApp di HP (menu: Setelan → Perangkat tertaut → Tautkan perangkat).
  **QR berlaku ~25 detik** — kalau habis, QR hilang dan muncul tombol **Request QR baru** (desain anti pairing-berulang otomatis, demi mengurangi risiko ban).
- Setelah terhubung: nama & nomor WhatsApp tampil. Session tersimpan — restart service tidak perlu scan ulang.
- Tombol **Logout** → hentikan sesi dari WhatsApp.

### 2. Template (tab "Template")
Buat template teks (opsional + 1 gambar) untuk dipakai berulang di broadcast.

### 3. Buat Broadcast (tab "Buat Broadcast")
- **Nomor**: format `628...` (tanpa `+`/spasi), panjang 8–15 digit. Pisahkan dengan koma/enter/spasi — duplikat dibuang otomatis.
- **Konten**: pilih template ATAU tulis teks langsung (+ gambar bila perlu).
- **Rate** (pesan/menit) & **mode proses**:
  - `queue` — antri, pelan-pelan → disarankan untuk mulai (lebih aman)
  - `parallel` — kirim bersamaan, lebih cepat → risiko ban lebih tinggi
- **Link preview** otomatis ketika teks memuat URL (mis. link Google Play).

### 4. History (tab "History")
- Daftar broadcast + status per recipient: `menunggu` / `terkirim` / `gagal` / `dibatalkan`.
- Tombol **"Kirim ulang yang gagal"** → buat broadcast baru HANYA dari nomor yang gagal (nomor yang sudah terkirim tidak dikirim lagi).

## Struktur

```
config.js       # base URL API (window.WA_API_BASE)
server.js       # static file server minimal (tanpa dependency)
index.html      # entry UI
css/style.css
js/
  api.js        # fetch wrapper (prefix base URL)
  app.js        # init tab
  connection.js # status koneksi + QR + countdown + logout/rescan
  templates.js  # CRUD template
  broadcast.js  # buat broadcast
  history.js    # history + retry gagal
```

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Web tidak bisa membaca data | Cek `WA_API_BASE` di `config.js` dan `CORS_ORIGINS` di `.env` service |
| QR habis sebelum sempat discan | QR berlaku ~25 detik — klik **Request QR baru**, scan lebih cepat |
| Broadcast semua gagal | Cek format nomor dan pastikan status Koneksi = terhubung |
| Muncul `auth_failure` | Sesi di-logout dari WhatsApp — klik rescan lalu scan QR baru |
