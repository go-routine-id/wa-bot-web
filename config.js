'use strict';

/**
 * Konfigurasi frontend.
 *
 * window.WA_API_BASE = base URL API backend (wa-bot-service).
 * - Kosong ('')  → same-origin: frontend & backend di satu origin (mode monolith).
 * - Terpisah     → mis. backend jalan di :3000:
 *     window.WA_API_BASE = 'http://localhost:3000';
 */
window.WA_API_BASE = '';

/** Normalisasi base URL (buang trailing slash). Dipakai semua modul frontend. */
function apiBase() {
  return (window.WA_API_BASE || '').replace(/\/+$/, '');
}
