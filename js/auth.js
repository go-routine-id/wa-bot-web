'use strict';

/**
 * Autentikasi terhadap account-service (pusat identitas ikavia).
 *
 * Frontend memanggil account-service LANGSUNG — tidak ada proxy. Konsekuensinya
 * token disimpan di browser, dan itu keputusan sadar: tanpa lapisan server
 * perantara, tidak ada tempat lain untuk menyimpannya.
 *
 * Yang disimpan:
 *   access token  (±15 menit) — dikirim sebagai Authorization: Bearer
 *   refresh token (±7 hari)   — hanya dipakai menukar access token baru
 *
 * account-service juga menaruh refresh token di cookie HttpOnly, tapi cookie
 * itu TIDAK dipakai di sini: di production account-service berada di domain
 * berbeda, dan cookie lintas domain tidak akan terkirim. Memakai body request
 * membuat perilakunya sama di lokal maupun production.
 */
const Auth = (() => {
  const AKSES = 'WA_ACCESS_TOKEN';
  const REFRESH = 'WA_REFRESH_TOKEN';
  const PROFIL = 'WA_PROFILE';

  /* ----------------------------------------------------------- penyimpanan */

  function baca(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (_) {
      return ''; // localStorage bisa diblokir (mode privat)
    }
  }

  function tulis(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (_) {
      /* diabaikan: sesi jadi tidak persisten, tapi aplikasi tetap jalan */
    }
  }

  const accessToken = () => baca(AKSES);
  const refreshToken = () => baca(REFRESH);

  function profile() {
    try {
      return JSON.parse(baca(PROFIL) || 'null');
    } catch (_) {
      return null;
    }
  }

  function simpanSesi(data) {
    tulis(AKSES, data.access_token || '');
    // /auth/session hanya mengembalikan access token — jangan hapus refresh
    // token yang masih berlaku hanya karena response ini tidak memuatnya.
    if (data.refresh_token) tulis(REFRESH, data.refresh_token);
    tulis(
      PROFIL,
      JSON.stringify({
        accountId: data.account_id || null,
        email: data.email || null,
        displayName: data.display_name || data.email || null,
        orgId: data.current_org_id || null,
        permissions: data.permissions || null,
      })
    );
  }

  function bersihkan() {
    [AKSES, REFRESH, PROFIL].forEach((k) => tulis(k, null));
  }

  /* --------------------------------------------------------------- jaringan */

  async function panggil(path, { method = 'POST', body, headers = {} } = {}) {
    const res = await fetch(base() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      // account-service memakai envelope {success, code, message}; `code`-nya
      // lebih spesifik daripada status HTTP (beberapa kode berbeda memetakan ke
      // status yang sama), tapi pesannya yang layak ditampilkan ke pengguna.
      const err = new Error(json.message || `HTTP ${res.status}`);
      err.code = json.code;
      err.status = res.status;
      throw err;
    }
    return json.data !== undefined ? json.data : json;
  }

  async function login(email, password) {
    const data = await panggil('/api/v1/auth/login', {
      body: { email, password, persist_session: true },
    });
    simpanSesi(data);
    return profile();
  }

  async function logout() {
    // Dicoba, tapi kegagalannya tidak menghalangi: yang penting kredensial
    // hilang dari browser ini. Kalau server tidak terjangkau, token tetap
    // kedaluwarsa sendiri dalam ±15 menit.
    try {
      await panggil('/api/v1/auth/logout', {
        headers: { Authorization: `Bearer ${accessToken()}` },
      });
    } catch (_) {
      /* diabaikan dengan sengaja */
    }
    bersihkan();
  }

  /* ------------------------------------------------------------- refresh */

  // Satu refresh pada satu waktu. Tanpa ini, beberapa request yang bersamaan
  // menerima 401 akan memicu beberapa refresh sekaligus — dan account-service
  // MEROTASI refresh token setiap kali. Refresh kedua akan menyodorkan token
  // yang sudah usang, yang dianggap penggunaan ulang dan MENCABUT SELURUH
  // SESSION pengguna.
  let refreshInFlight = null;

  function refresh() {
    if (refreshInFlight) return refreshInFlight;

    const token = refreshToken();
    if (!token) return Promise.reject(new Error('Tidak ada refresh token'));

    refreshInFlight = (async () => {
      try {
        const data = await panggil('/api/v1/auth/refresh', { body: { refresh_token: token } });
        simpanSesi(data);
        return data.access_token;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  /* ------------------------------------------------------------- keadaan */

  // Alamat account-service yang BERLAKU. Diisi dari /api/auth-info saat boot,
  // atau dari WA_ACCOUNT_BASE bila sengaja dipaksa.
  let alamatAktif = accountBase();

  /**
   * Tanyakan ke backend apakah autentikasi menyala dan ke mana harus login.
   *
   * Backend adalah satu-satunya pihak yang tahu jawabannya. Sebelum ini,
   * frontend hanya bisa tahu dari 401 — dan pada saat itu ia tidak tahu alamat
   * penerbit identitasnya, jadi tidak bisa menampilkan layar masuk sama sekali.
   */
  async function discover() {
    if (accountBase()) return true; // sengaja dipaksa lewat WA_ACCOUNT_BASE

    try {
      const res = await fetch(apiBase() + '/api/auth-info');
      const json = await res.json().catch(() => ({}));
      const info = json.data || {};
      alamatAktif = info.enabled && info.accountServiceUrl ? info.accountServiceUrl : '';
    } catch (_) {
      // Backend tak terjangkau: jangan mengunci layar. Pengguna akan melihat
      // error jaringan yang sebenarnya, bukan layar masuk yang menyesatkan.
      alamatAktif = '';
    }
    return alamatAktif !== '';
  }

  /** Alamat account-service yang dipakai — hasil discover atau override. */
  const base = () => alamatAktif;

  /** true bila alur login tidak dipakai. */
  const disabled = () => !alamatAktif;

  /** true bila ada kredensial tersimpan. Tidak menjamin masih berlaku. */
  function loggedIn() {
    return disabled() || !!accessToken();
  }

  /** Header Authorization untuk request ke wa-bot-service / go-contact. */
  function authHeader() {
    const t = accessToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  return {
    discover,
    base,
    login,
    logout,
    refresh,
    loggedIn,
    disabled,
    profile,
    accessToken,
    authHeader,
    clear: bersihkan,
  };
})();

window.Auth = Auth;
