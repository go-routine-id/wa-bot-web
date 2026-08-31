'use strict';

/** Fetch wrapper + helper kecil. Diekspos ke window supaya bisa dipakai semua modul. */
const API = (() => {
  /**
   * API key opsional (backend: env API_KEY). Disimpan per-browser lewat localStorage
   * supaya tidak perlu menaruh rahasia di berkas yang dilacak git:
   *     localStorage.setItem('WA_API_KEY', '<kunci>')
   */
  function apiKey() {
    try {
      return localStorage.getItem('WA_API_KEY') || '';
    } catch (_) {
      return ''; // localStorage bisa diblokir (mode privat)
    }
  }

  async function request(method, url, body, isMultipart = false) {
    const opts = { method, headers: {} };
    const key = apiKey();
    if (key) opts.headers['X-API-Key'] = key;
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
    apiKey,
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
function parseTime(raw) {
  if (!raw) return null;
  const str = String(raw);
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(str);
  const d = new Date(hasZone ? str : str.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtTime(raw) {
  const d = parseTime(raw);
  if (!d) return raw ? String(raw) : ''; // format tak dikenal → tampilkan apa adanya
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * Waktu ringkas untuk KOLOM TABEL: "3 menit lalu", "2 jam lalu", "31 Agu 2026".
 *
 * Timestamp penuh (2026-08-31 21:55:20) terlalu panjang untuk kolom sempit —
 * ia membungkus jadi dua baris dan membuat tinggi baris tabel tidak rata.
 * Bentuk relatif juga lebih mudah dibaca sekilas: yang biasanya ingin diketahui
 * adalah "baru atau lama", bukan detiknya.
 *
 * Nilai persisnya TIDAK hilang — pemanggil menaruh fmtTime() di atribut title
 * sehingga tetap terbaca saat kursor diarahkan ke sana.
 */
function fmtTimeShort(raw) {
  const d = parseTime(raw);
  if (!d) return raw ? String(raw) : '';

  const detik = Math.floor((Date.now() - d.getTime()) / 1000);
  // Jam mesin bisa mundur sedikit terhadap server; tanpa penjagaan ini akan
  // muncul "-1 menit lalu".
  if (detik < 60) return 'baru saja';
  if (detik < 3600) return `${Math.floor(detik / 60)} menit lalu`;
  if (detik < 86400) return `${Math.floor(detik / 3600)} jam lalu`;
  if (detik < 7 * 86400) return `${Math.floor(detik / 86400)} hari lalu`;

  const tanggal = `${d.getDate()} ${BULAN_SINGKAT[d.getMonth()]}`;
  // Tahun hanya ditulis bila berbeda dari sekarang — di dalam tahun berjalan ia
  // hanya menambah panjang tanpa menambah informasi.
  return d.getFullYear() === new Date().getFullYear() ? tanggal : `${tanggal} ${d.getFullYear()}`;
}

/**
 * Potong teks untuk pratinjau tabel, aman terhadap emoji.
 *
 * String.slice() menghitung unit UTF-16, sedangkan emoji adalah pasangan
 * surrogate — memotong tepat di tengahnya meninggalkan setengah karakter yang
 * tampil sebagai �. Intl.Segmenter memotong per grapheme, jadi rangkaian emoji
 * (bendera, keluarga ber-ZWJ, emoji berwarna kulit) juga tetap utuh.
 *
 * Menambahkan "…" hanya bila benar-benar terpotong: tanpa penanda, teks yang
 * berhenti di tengah kata terbaca seolah datanya memang cuma segitu.
 */
function truncate(text, max) {
  const str = String(text ?? '');
  const units =
    typeof Intl !== 'undefined' && Intl.Segmenter
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].map((s) => s.segment)
      : [...str]; // fallback: iterasi per code point, tetap tidak memecah surrogate
  if (units.length <= max) return str;
  return units.slice(0, max).join('') + '…';
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

window.API = API;
