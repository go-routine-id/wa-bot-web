# WA Bot Web

Frontend vanilla JS untuk WhatsApp bot: **kelola beberapa sesi WhatsApp** (beberapa nomor), template, broadcast (pilih sesi pengirim), dan history. Repo ini hanya berisi web statis — backend API ada di repo terpisah [`wa-bot-service`](https://github.com/go-routine-id/wa-bot-service).

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
4. Buka `http://localhost:5173` (tiap menu punya URL sendiri — `http://localhost:5173/sessions`, `/create`, `/templates`, `/history`; back/forward browser & deep-link berfungsi). Mulai dari tab **Sesi WhatsApp** → tambah sesi & scan QR.

## Memakai

### 1. Sesi WhatsApp (tab "Sesi WhatsApp")

- **Satu sesi = satu nomor WhatsApp.** Ketik nama sesi lalu **Tambah Sesi** (cth. `Promo Ramadan` → id `promo-ramadan`). Setiap sesi menampilkan kartu dengan status & QR sendiri.
- Scan QR dengan WhatsApp di HP (menu: Setelan → Perangkat tertaut → Tautkan perangkat).
  **QR berlaku ~25 detik** — kalau habis, QR hilang dan muncul tombol **Request QR baru** (desain anti pairing-berulang otomatis, demi mengurangi risiko ban).
- Setelah terhubung: nama & nomor WhatsApp tampil di kartu. Session tersimpan — restart service tidak perlu scan ulang.
- Per kartu: **Rename** (ubah label, id tetap), **Logout** (hentikan sesi, kredensial dihapus tapi baris tetap — bisa scan ulang), **Hapus** (hapus sesi + kredensial; broadcast yang memakainya dibatalkan).

### 2. Template (tab "Template")

Buat template teks (opsional + 1 gambar) untuk dipakai berulang di broadcast. Template bersifat **global** (tidak terkait sesi).

### 3. Buat Broadcast (tab "Buat Broadcast")

- **Sesi pengirim**: dropdown berisi sesi yang **terhubung** — broadcast dikirim dari nomor sesi ini. Sesi yang masih menghubungkan tampil non-aktif.
- **Nomor**: format `628...` (tanpa `+`/spasi), panjang 8–15 digit. Pisahkan dengan koma/enter/spasi — duplikat dibuang otomatis.
- **Konten**: pilih template ATAU tulis teks langsung (+ gambar bila perlu).
- **Rate** (pesan/menit) & **mode proses**:
  - `queue` — antri, pelan-pelan → disarankan untuk mulai (lebih aman)
  - `parallel` — kirim bersamaan, lebih cepat → risiko ban lebih tinggi
- **Link preview** otomatis ketika teks memuat URL (mis. link Google Play).

### 4. History (tab "History")

- Daftar broadcast + status per recipient: `menunggu` / `terkirim` / `gagal` / `dibatalkan`, plus kolom **Sesi** (pengirim broadcast ini).
- Detail broadcast menampilkan sesi pengirim.
- Tombol **"Kirim ulang yang gagal"** → buat broadcast baru HANYA dari nomor yang gagal (nomor yang sudah terkirim tidak dikirim lagi), memakai sesi pengirim yang sama.

## Struktur

```
config.js       # base URL API (window.WA_API_BASE)
server.js       # static file server minimal (tanpa dependency)
index.html      # entry UI
css/style.css
js/
  api.js        # fetch wrapper (prefix base URL)
  router.js     # URL routing (History API): /sessions, /create, /templates, /history
  app.js        # init tab + render aktif
  connection.js # session manager: list kartu sesi + QR + countdown + tambah/rename/hapus/logout/rescan
  templates.js  # CRUD template
  broadcast.js  # buat broadcast (dropdown sesi pengirim + submit sessionId)
  history.js    # history (kolom sesi) + retry gagal
```

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Web tidak bisa membaca data | Cek `WA_API_BASE` di `config.js` dan `CORS_ORIGINS` di `.env` service |
| QR habis sebelum sempat discan | QR berlaku ~25 detik — klik **Request QR baru**, scan lebih cepat |
| Dropdown sesi pengirim kosong | Pastikan minimal satu sesi berstatus **terhubung** di tab Sesi WhatsApp |
| Broadcast semua gagal | Cek format nomor dan pastikan sesi pengirim terhubung (belum dihapus) |
| Muncul `auth_failure` | Sesi di-logout dari WhatsApp — klik rescan lalu scan QR baru |
