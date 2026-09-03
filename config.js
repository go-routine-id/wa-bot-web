'use strict';

/**
 * Konfigurasi frontend.
 *
 * window.WA_API_BASE = base URL API backend (wa-bot-service).
 * - Kosong ('')  → same-origin: frontend & backend di satu origin (mode monolith).
 * - Terpisah     → mis. backend jalan di :3000:
 *     window.WA_API_BASE = 'http://localhost:3000';
 *
 * Berkas ini dilacak git, jadi jangan mengeditnya hanya untuk satu deployment —
 * timpa lewat localStorage di browser yang bersangkutan:
 *     localStorage.setItem('WA_API_BASE', 'https://api.contoh.com')
 *     localStorage.setItem('WA_API_BASE', '')   // paksa same-origin
 *     localStorage.removeItem('WA_API_BASE')    // kembali ke default di bawah
 *
 * Bila backend dijalankan dengan env API_KEY, set juga kuncinya di browser ini:
 *     localStorage.setItem('WA_API_KEY', '<kunci yang sama dengan env API_KEY>')
 * Kunci sengaja TIDAK ditaruh di berkas ini karena berkas ini dilacak git.
 */
window.WA_API_BASE = (() => {
  try {
    const override = localStorage.getItem('WA_API_BASE');
    if (override !== null) return override; // string kosong = same-origin (disengaja)
  } catch (_) {
    // localStorage bisa diblokir (mode privat) → pakai default
  }
  return 'http://localhost:3000';
})();

/** Normalisasi base URL (buang trailing slash). Dipakai semua modul frontend. */
function apiBase() {
  return (window.WA_API_BASE || '').replace(/\/+$/, '');
}

/**
 * window.WA_CONTACT_BASE = base URL layanan kontak (go-contact).
 *
 * Layanan TERPISAH dari wa-bot-service — beda repo, beda port, beda proses.
 * Frontend memanggilnya langsung dari browser, jadi go-contact harus mengizinkan
 * origin ini lewat env CORS_ORIGINS miliknya; kalau tidak, semua panggilan
 * kontak diblokir browser sementara fitur broadcast tetap jalan normal.
 *
 * Timpa per-browser lewat localStorage (berkas ini dilacak git):
 *     localStorage.setItem('WA_CONTACT_BASE', 'https://kontak.contoh.com')
 *     localStorage.setItem('WA_CONTACT_BASE', '')   // matikan fitur kontak
 *     localStorage.removeItem('WA_CONTACT_BASE')    // kembali ke default
 *
 * Dikosongkan = fitur kontak dianggap tidak tersedia dan tab Kontak
 * menampilkan penjelasan, bukan error jaringan yang membingungkan.
 */
window.WA_CONTACT_BASE = (() => {
  try {
    const override = localStorage.getItem('WA_CONTACT_BASE');
    if (override !== null) return override; // string kosong = fitur dimatikan (disengaja)
  } catch (_) {
    // localStorage bisa diblokir (mode privat) → pakai default
  }
  return 'http://localhost:7281';
})();

/** Base URL layanan kontak, trailing slash dibuang. '' = fitur dimatikan. */
function contactBase() {
  return (window.WA_CONTACT_BASE || '').replace(/\/+$/, '');
}

/** Fitur kontak aktif hanya bila base URL-nya diisi. */
function contactsEnabled() {
  return contactBase() !== '';
}

/**
 * window.WA_ACCOUNT_BASE = base URL account-service (pusat identitas ikavia).
 *
 * Frontend memanggilnya LANGSUNG dari browser — tidak ada proxy — jadi origin
 * ini harus terdaftar di CORS_ORIGINS milik account-service.
 *
 * Biasanya TIDAK perlu diisi: saat aplikasi dimuat, frontend menanyakannya ke
 * backend lewat GET /api/auth-info. Backend-lah yang tahu apakah autentikasi
 * menyala dan ke mana harus login — menuntut setiap pengguna menyetel
 * localStorage secara manual hanya menghasilkan dinding 401 tanpa jalan keluar.
 *
 * Isi ini hanya untuk MEMAKSA alamat tertentu (mis. account-service berbeda dari
 * yang dipakai backend). Timpa per-browser lewat localStorage:
 *     localStorage.setItem('WA_ACCOUNT_BASE', 'https://account.contoh.com')
 *     localStorage.setItem('WA_ACCOUNT_BASE', '')   // matikan login
 */
window.WA_ACCOUNT_BASE = (() => {
  try {
    const override = localStorage.getItem('WA_ACCOUNT_BASE');
    if (override !== null) return override;
  } catch (_) {
    // localStorage bisa diblokir (mode privat) → pakai default
  }
  return '';
})();

/** Base URL account-service, trailing slash dibuang. '' = login dimatikan. */
function accountBase() {
  return (window.WA_ACCOUNT_BASE || '').replace(/\/+$/, '');
}

/** true bila alur login aktif. */
function authEnabled() {
  return accountBase() !== '';
}

/**
 * window.WA_DEFAULT_DELAY_SECONDS = jeda bawaan antar pesan pada form broadcast.
 *
 * Ditaruh di sini, bukan sebagai value="" di markup, karena ini nilai bisnis:
 * makin rapat pengiriman makin besar risiko nomor diblokir WhatsApp, dan angka
 * amannya berbeda tiap pemakaian. Bisa ditimpa per-browser:
 *
 *     localStorage.setItem('WA_DEFAULT_DELAY_SECONDS', '60')
 *     localStorage.removeItem('WA_DEFAULT_DELAY_SECONDS')   // kembali ke default
 *
 * Ini hanya nilai AWAL form — pengguna tetap bebas mengubahnya sebelum kirim.
 */
window.WA_DEFAULT_DELAY_SECONDS = (() => {
  try {
    const override = parseFloat(localStorage.getItem('WA_DEFAULT_DELAY_SECONDS'));
    if (Number.isFinite(override) && override > 0) return override;
  } catch (_) {
    // localStorage bisa diblokir (mode privat) → pakai default
  }
  return 30;
})();

/** Jeda bawaan (detik) dan padanannya dalam pesan/menit, supaya kedua tampilan
 *  input kecepatan tidak pernah saling bertentangan. */
function defaultDelaySeconds() {
  const n = Number(window.WA_DEFAULT_DELAY_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
function defaultRatePerMinute() {
  return Math.max(1, Math.round(60 / defaultDelaySeconds()));
}
