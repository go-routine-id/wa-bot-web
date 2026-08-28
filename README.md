# WA Bot Web

Frontend vanilla JS untuk WhatsApp bot (kontrol koneksi, template, broadcast, history). Repo ini hanya berisi web statis — backend API ada di repo terpisah [`wa-bot-service`](https://github.com/go-routine-id/wa-bot-service).

## Cara jalan

```bash
npm start            # static server → http://localhost:5173
# atau tanpa npm:
node server.js
```

## Menyambungkan ke backend

Base URL API di-set di **`config.js`** (`window.WA_API_BASE`):

```js
window.WA_API_BASE = '';                      // same-origin (default)
window.WA_API_BASE = 'http://localhost:3000'; // backend wa-bot-service terpisah
```

Backend harus mengizinkan origin ini via env `CORS_ORIGINS` di wa-bot-service (mis. `CORS_ORIGINS=http://localhost:5173`).

## Fitur

- Scan QR WhatsApp (session tersimpan — tidak perlu scan ulang tiap restart)
- CRUD template broadcast (teks + opsional 1 gambar)
- Buat broadcast: pilih template ATAU teks langsung + gambar, daftar nomor dipisah koma
- Link preview otomatis untuk teks yang memuat URL
- Rate limit per broadcast + mode proses `queue` / `parallel`
- History broadcast + detail status per-recipient
- Tombol "Kirim ulang yang gagal" — buat broadcast baru hanya dari nomor yang gagal terkirim

> ⚠️ **Risiko ban:** library backend mengotomasi WhatsApp Web (unofficial). Broadcast massal berisiko membuat nomor ter-block. Mulai dengan rate kecil (20/menit) dan mode `queue`.

## Struktur

```
config.js       # base URL API (window.WA_API_BASE)
server.js       # static file server minimal (tanpa dependency)
index.html      # entry UI
css/style.css
js/
  api.js        # fetch wrapper (prefix base URL)
  app.js        # init tab
  connection.js # status koneksi + QR + logout/rescan
  templates.js  # CRUD template
  broadcast.js  # buat broadcast
  history.js    # history + retry gagal
```
