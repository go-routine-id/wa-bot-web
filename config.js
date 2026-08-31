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
