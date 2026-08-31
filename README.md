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
4. **(Opsional) Aktifkan fitur Kontak** — butuh layanan terpisah [go-contact](https://github.com/go-routine-id/go-contact).
   Jalankan go-contact (default `http://localhost:7281`) dengan origin ini diizinkan di `.env`-nya:
   ```bash
   CORS_ORIGINS=http://localhost:5173
   ```
   Lalu set base URL-nya di `config.js` (`window.WA_CONTACT_BASE`), atau per-browser:
   ```js
   localStorage.setItem('WA_CONTACT_BASE', 'http://localhost:7281')
   localStorage.setItem('WA_CONTACT_BASE', '')   // matikan fitur Kontak
   ```
   Dikosongkan = tab **Kontak** menjelaskan bahwa fiturnya mati, dan fitur broadcast tetap jalan normal.
5. Buka `http://localhost:5173` (tiap menu punya URL sendiri — `http://localhost:5173/sessions`, `/create`, `/templates`, `/contacts`, `/history`; back/forward browser & deep-link berfungsi). Halaman detail punya URL sendiri: `/history/:id` (mis. `/history/13`) dan `/contacts/:id`. Mulai dari tab **Sesi WhatsApp** → tambah sesi & scan QR.

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
- **Detail broadcast** dibuka di halaman terpisah `/history/:id` (klik **Detail** di baris list, atau buka URL langsung) — menampilkan sesi pengirim, progress, isi pesan, dan tabel recipient. Tombol **← Kembali ke list** atau back browser kembali ke `/history`.
- Tombol **"Kirim ulang yang gagal"** → buat broadcast baru HANYA dari nomor yang gagal (nomor yang sudah terkirim tidak dikirim lagi), memakai sesi pengirim yang sama.
- Tombol **"📇 Simpan ke kontak"** → simpan semua nomor broadcast ini ke layanan kontak, dengan pilihan label (usulan: `Broadcast #<id>`). Nomor yang sudah tersimpan **tidak diduplikasi**, dan label lama kontak tidak terhapus — label baru ditambahkan.

### 5. Kontak (tab "Kontak")

Butuh layanan [go-contact](https://github.com/go-routine-id/go-contact) — lihat langkah 4 di Quickstart.

- **Tambah kontak** lewat form di atas daftar: nama, nomor, email, alamat, catatan. Nomor yang bukan format WhatsApp valid (8–15 digit) ditandai ⚠️.
- **Mengubah kontak punya halaman sendiri**: `/contacts/:id` (klik **Edit** di baris, atau buka URL-nya langsung). Halaman ini memuat form lengkap, label kontak, tombol hapus, dan waktu dibuat/diubah. Back/forward browser & deep-link berfungsi, sama seperti detail broadcast. Mengosongkan sebuah kolom di sini benar-benar menghapus isinya.
- **Label** sebagai kelompok: buat, ganti nama, hapus. Menghapus label TIDAK menghapus kontaknya.
- **⭐ Favorit** (seperti *starred* di Google Contacts): klik bintang di baris kontak atau di halaman detailnya. Tombol **Favorit** di toolbar menyaring daftar ke kontak berbintang saja.
- **📥 Impor CSV** — muat banyak kontak sekaligus dari berkas CSV. Lihat format di bawah.
- **Sematkan label** dengan bintang di chip-nya. Label tersemat naik ke urutan atas dan muncul sebagai **chip pintasan** di pemilih kontak saat broadcast — jadi kelompok yang sering dipakai tinggal satu klik.
- Tombol **Label** per baris mengatur label satu kontak sekaligus (centang = pasang, hilangkan semua centang = lepas semua).
- **Pencarian** (nama/nomor) dan **filter per label** — filter inilah yang dipakai untuk broadcast ke satu kelompok.
- Di form **Buat Broadcast**, tombol **"📇 Pilih dari kontak"** membuka pemilih dengan pencarian, filter label, dan **"Pilih semua hasil"**. Nomor terpilih **digabungkan** ke daftar yang sudah ada (tidak menimpa) dan duplikat dibuang otomatis.
- Di pemilih itu ada baris **Pintasan**: `⭐ Favorit` plus setiap label yang disematkan. Satu klik menyaring daftar, lalu **"Pilih semua hasil"** mengambil seluruhnya — inilah jalur "broadcast ke kelompok yang sering dipakai".

> `⭐ Favorit` bukan label sungguhan di database, melainkan filter `?favorite=true`. Jadi kontak berbintang tidak perlu ikut jadi anggota label mana pun.

#### Format CSV impor

Baris pertama wajib berisi nama kolom. Urutan kolom bebas, huruf besar/kecil bebas.

```csv
no,name,label
628123456789,Budi Santoso,Pelanggan;VIP
628987654321,"Santoso, Siti",Reseller
628111222333,Andi,
```

| Kolom | Wajib | Keterangan |
|---|---|---|
| `no` | ya | Nomor telepon **8–15 digit dengan kode negara**. Spasi, `+`, dan `-` boleh — akan dibersihkan (`+62 812-3456-7890` diterima). |
| `name` | ya | Nama kontak. Kalau mengandung koma, apit dengan tanda kutip. |
| `label` | tidak | Beberapa label dipisah titik-koma `;`. Koma tidak bisa dipakai karena sudah jadi pemisah kolom CSV. Label yang belum ada dibuat otomatis. |

Alias yang juga dikenali: `nomor`/`phone` untuk `no`, `nama` untuk `name`, dan `label[]` untuk `label`.

Sebelum menulis apa pun, layar **pratinjau** menandai tiap baris:

| Status | Artinya |
|---|---|
| **baru** | akan dibuat sebagai kontak baru |
| **sudah ada** | nomornya sudah tersimpan — kontak tidak diduplikasi, **nama lama dipertahankan**, label dari CSV ditambahkan ke label yang sudah ada |
| **ganda** | nomor yang sama muncul lebih dari sekali di dalam berkas; hanya kemunculan pertama diproses |
| **tidak valid** | dilewati, dengan alasannya (mis. `08…` yang belum berkode negara) |

> Karena nomor yang sudah ada dilewati, **mengimpor berkas yang sama dua kali aman** — tidak ada yang tergandakan.

Pratinjau dan impor memakai **endpoint yang sama** (`POST /api/contacts/import` milik go-contact); pratinjau hanya menambahkan `dry_run: true`, yang membuat server menjalankan seluruh proses lalu membatalkan transaksinya. Jadi yang kamu lihat di pratinjau dihitung oleh kode yang persis sama dengan yang menulis.

Seluruh berkas dikirim dalam **satu request dan satu transaksi**: kalau gagal, tidak ada separuh data yang tertinggal. Batasnya **5.000 baris per impor** — berkas lebih besar perlu dipecah.

> Kontak dimuat 100 per permintaan karena itu batas layanan; "Pilih semua hasil" mengambil seluruh halaman, bukan hanya yang tampil.

## Struktur

```
config.js       # base URL API (window.WA_API_BASE) + layanan kontak (window.WA_CONTACT_BASE)
server.js       # static file server minimal (tanpa dependency)
index.html      # entry UI
css/style.css
js/
  api.js        # fetch wrapper (prefix base URL)
  router.js     # URL routing (History API): /sessions, /create, /templates, /contacts, /contacts/:id, /history
  app.js        # init tab + render aktif
  connection.js # session manager: list kartu sesi + QR + countdown + tambah/rename/hapus/logout/rescan
  templates.js  # CRUD template
  broadcast.js  # buat broadcast (dropdown sesi pengirim + submit sessionId)
  history.js    # history (kolom sesi) + halaman detail /history/:id + retry gagal + simpan ke kontak
  contacts.js   # tab Kontak: daftar + halaman /contacts/:id, CRUD kontak & label (go-contact)
  picker.js     # dialog kaya: pilih kontak, centang label, overlay progres
  import.js     # impor CSV: parser RFC 4180 + pratinjau/eksekusi lewat endpoint bulk
```

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Web tidak bisa membaca data | Cek `WA_API_BASE` di `config.js` dan `CORS_ORIGINS` di `.env` service |
| QR habis sebelum sempat discan | QR berlaku ~25 detik — klik **Request QR baru**, scan lebih cepat |
| Dropdown sesi pengirim kosong | Pastikan minimal satu sesi berstatus **terhubung** di tab Sesi WhatsApp |
| Broadcast semua gagal | Cek format nomor dan pastikan sesi pengirim terhubung (belum dihapus) |
| Muncul `auth_failure` | Sesi di-logout dari WhatsApp — klik rescan lalu scan QR baru |
| Tab Kontak bilang "fitur dimatikan" | `WA_CONTACT_BASE` kosong — isi lewat `config.js` atau `localStorage` |
| Tab Kontak: "tidak bisa menghubungi layanan kontak" | go-contact tidak jalan, atau origin ini belum ada di `CORS_ORIGINS` go-contact |
