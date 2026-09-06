'use strict';

/**
 * Halaman profil: siapa yang sedang masuk, dan organisasi mana yang sedang
 * dipakai.
 *
 * Organisasi aktif bukan sekadar informasi — ia menentukan data mana yang
 * terlihat di seluruh aplikasi (sesi, template, broadcast, kontak semuanya
 * disaring per organisasi). Karena itu ia ditampilkan paling menonjol.
 *
 * Sumbernya account-service, bukan wa-bot-service: identitas dimiliki di sana.
 *   /api/v1/me                → data akun
 *   /api/v1/auth/whoami       → organisasi aktif, izin, masa berlaku token
 *   /api/v1/organizations     → nama organisasi (whoami hanya memberi id)
 */
const Profile = (() => {
  let memuat = false;

  const el = (id) => document.getElementById(id);

  /** Unix detik → waktu lokal yang terbaca. */
  function waktu(detik) {
    if (!detik) return '—';
    return new Date(detik * 1000).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  /** Sisa umur token, supaya jelas kapan aplikasi akan menukar tokennya. */
  function sisa(expUnix) {
    if (!expUnix) return '';
    const detik = expUnix - Math.floor(Date.now() / 1000);
    if (detik <= 0) return ' (sudah lewat — akan ditukar otomatis)';
    const menit = Math.floor(detik / 60);
    return menit >= 1 ? ` (${menit} menit lagi)` : ` (${detik} detik lagi)`;
  }

  function baris(label, nilai, opts = {}) {
    const isi = nilai === null || nilai === undefined || nilai === '' ? '—' : nilai;
    const kelas = opts.mono ? ' class="mono"' : '';
    return `<div class="pf-row"><dt>${escapeHtml(label)}</dt><dd${kelas}>${
      opts.html ? isi : escapeHtml(String(isi))
    }</dd></div>`;
  }

  function render({ me, who, orgs }) {
    const daftar = (orgs && orgs.items) || [];
    const aktif = daftar.find((o) => o.org_id === who.org_id);
    const lain = daftar.filter((o) => o.org_id !== who.org_id);

    const izin = (who.permissions || []).map((p) => `<span class="pf-chip">${escapeHtml(p)}</span>`).join('');
    const catatanIzin = (who.permissions || []).includes('*')
      ? '<p class="muted pf-note">Tanda <code>*</code> berarti platform admin — memenuhi izin apa pun, termasuk <code>wa-bot:*</code>.</p>'
      : '';

    el('pf-body').innerHTML = `
      <div class="card pf-ident">
        <div class="pf-avatar">${escapeHtml((me.display_name || me.email || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="pf-ident-text">
          <h3>${escapeHtml(me.display_name || '(tanpa nama)')}</h3>
          <p class="muted">${escapeHtml(me.email || '')}${
            me.email_verified ? ' · <span class="pf-ok">terverifikasi</span>' : ' · <span class="pf-warn">belum terverifikasi</span>'
          }</p>
        </div>
        <button class="btn" onclick="Session.signOut()">Keluar</button>
      </div>

      <div class="card">
        <h3>Organisasi aktif</h3>
        <p class="muted pf-note">Semua sesi WhatsApp, template, broadcast, dan kontak yang kamu lihat adalah milik organisasi ini.</p>
        <dl class="pf-list">
          ${baris('Nama', aktif ? aktif.name : '(tidak dikenali)')}
          ${baris('Peran kamu', aktif ? aktif.my_role : '—')}
          ${baris('Anggota', aktif ? `${aktif.member_count} orang` : '—')}
          ${baris('ID organisasi', who.org_id, { mono: true })}
        </dl>
      </div>

      <div class="card">
        <h3>Akun</h3>
        <dl class="pf-list">
          ${baris('Tipe', me.account_type)}
          ${baris('Jenis principal', who.principal_type)}
          ${baris('ID akun', me.account_id, { mono: true })}
          ${baris('Dibuat', waktu(me.created_at))}
          ${baris('Zona waktu', me.timezone)}
          ${baris('Bahasa', me.language)}
          ${baris('Wajib ganti sandi', me.must_change_password ? 'ya' : 'tidak')}
        </dl>
      </div>

      <div class="card">
        <h3>Izin & sesi</h3>
        <dl class="pf-list">
          ${baris('Izin', izin || '—', { html: true })}
          ${baris('ID sesi', who.session_id, { mono: true })}
          ${baris('Token berlaku sampai', waktu(who.expires_at) + sisa(who.expires_at))}
          ${baris('Diverifikasi oleh', Auth.base(), { mono: true })}
        </dl>
        ${catatanIzin}
      </div>

      ${
        lain.length
          ? `<div class="card">
              <h3>Organisasi lain yang kamu ikuti</h3>
              <p class="muted pf-note">Aplikasi ini memakai organisasi bawaan akunmu; berpindah organisasi dilakukan di account-service.</p>
              <div class="table-wrap">
              <table>
                <thead><tr><th>Nama</th><th>Peran</th><th>Anggota</th></tr></thead>
                <tbody>${lain
                  .map(
                    (o) =>
                      `<tr><td>${escapeHtml(o.name)}</td><td>${escapeHtml(o.my_role)}</td><td>${o.member_count}</td></tr>`
                  )
                  .join('')}</tbody>
              </table>
              </div>
            </div>`
          : ''
      }
    `;
  }

  async function load() {
    if (memuat) return;
    if (Auth.disabled()) {
      el('pf-body').innerHTML =
        '<div class="card"><p class="muted">Autentikasi sedang nonaktif di backend, jadi tidak ada akun yang sedang dipakai.</p></div>';
      return;
    }
    memuat = true;
    el('pf-body').innerHTML = UI.skeleton();
    try {
      // Diambil bersamaan: ketiganya saling melengkapi dan tidak ada yang
      // bergantung pada hasil yang lain.
      const [me, who, orgs] = await Promise.all([
        Auth.getJson('/api/v1/me'),
        Auth.getJson('/api/v1/auth/whoami'),
        Auth.getJson('/api/v1/organizations'),
      ]);
      render({ me, who, orgs });
    } catch (err) {
      el('pf-body').innerHTML = UI.errorState(err.message, 'Profile.load()');
    } finally {
      memuat = false;
    }
  }

  return { load };
})();

window.Profile = Profile;
