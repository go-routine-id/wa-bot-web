'use strict';

/** Fetch wrapper + helper kecil. Diekspos ke window supaya bisa dipakai semua modul. */
const API = (() => {
  async function request(method, url, body, isMultipart = false) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      if (isMultipart) {
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(apiBase() + url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json.data !== undefined ? json.data : json;
  }

  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body ?? {}),
    put: (url, body) => request('PUT', url, body),
    patch: (url, body) => request('PATCH', url, body),
    del: (url, body) => request('DELETE', url, body),
    upload: (url, formData) => request('POST', url, formData, true),
  };
})();

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format timestamp dari API ke WAKTU LOKAL browser.
 *
 * Backend menyimpan UTC dalam dua bentuk berbeda:
 *   - SQLite datetime('now')   → "2026-08-29 19:43:55"        (tanpa penanda zona)
 *   - new Date().toISOString() → "2026-08-29T19:45:42.937Z"   (eksplisit UTC)
 *
 * Bentuk pertama WAJIB diberi 'Z': tanpa itu JS menganggapnya waktu lokal,
 * sehingga tampil meleset sebesar offset zona (WIB = 7 jam, bahkan beda tanggal).
 */
function fmtTime(raw) {
  if (!raw) return '';
  const str = String(raw);
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(str);
  const d = new Date(hasZone ? str : str.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return str; // format tak dikenal → tampilkan apa adanya
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

window.API = API;
