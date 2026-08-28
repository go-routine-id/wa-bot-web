'use strict';

const Connection = (() => {
  let timer = null;       // poll list sesi (2.5s)
  let countdown = null;   // interval hitung mundur QR semua kartu (1s)
  let sessionsCache = []; // list terakhir dari API

  function start() {
    if (timer) return;
    timer = setInterval(refresh, 2500);
  }

  async function refresh() {
    const section = document.getElementById('tab-connection');
    if (!section || !section.classList.contains('active')) return;
    try {
      sessionsCache = await API.get('/api/sessions');
      render();
    } catch (err) {
      document.getElementById('conn-content').innerHTML =
        `<div class="conn-box"><p class="conn-error">${escapeHtml(err.message)}</p></div>`;
    }
  }

  function stopCountdown() {
    if (countdown) {
      clearInterval(countdown);
      countdown = null;
    }
  }

  // Satu interval memperbarui semua elemen data-qr-countdown; saat salah satu habis
  // → satu refresh() (backend sudah qr_expired, render menampilkan tombol manual).
  function startCountdown() {
    if (countdown) return;
    countdown = setInterval(() => {
      const qrSessions = sessionsCache.filter((s) => s.status === 'qr' && s.qrExpiresAt);
      if (qrSessions.length === 0) {
        stopCountdown();
        return;
      }
      let anyExpired = false;
      qrSessions.forEach((s) => {
        const remain = Math.max(0, Math.round((s.qrExpiresAt - Date.now()) / 1000));
        const num = document.getElementById(`qr-countdown-${s.id}`);
        if (num) num.textContent = remain;
        if (remain <= 0) anyExpired = true;
      });
      if (anyExpired) {
        stopCountdown();
        refresh();
      }
    }, 1000);
  }

  function render() {
    stopCountdown(); // reset hitung mundur tiap render; branch QR menyalakannya lagi
    const el = document.getElementById('conn-content');

    if (sessionsCache.length === 0) {
      el.innerHTML = `
        <div class="conn-box">
          <p class="muted">Belum ada sesi. Ketik nama di atas lalu klik <strong>Tambah Sesi</strong> untuk mulai.</p>
        </div>`;
      return;
    }

    const cards = sessionsCache.map(renderCard).join('');
    const hasQr = sessionsCache.some((s) => s.status === 'qr' && s.qrExpiresAt);
    if (hasQr) startCountdown();

    el.innerHTML = `<div class="session-list">${cards}</div>`;
  }

  function renderCard(s) {
    const name = escapeHtml(s.name);
    const badge = `<span class="badge badge-${escapeHtml(s.status)}">${escapeHtml(s.status)}</span>`;
    const actions = (buttons) => `
      <div class="session-actions">
        ${buttons.map((b) => b).join('')}
      </div>`;

    if (s.connected) {
      const uname = s.userInfo?.name ? escapeHtml(s.userInfo.name) : '(tanpa nama)';
      const unumber = s.userInfo?.number ? escapeHtml(s.userInfo.number) : '?';
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong>${name}</strong> ${badge}</div>
          <p class="muted">Terhubung sebagai <strong>${uname}</strong> (${unumber})</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rename('${s.id}')">Rename</button>`,
            `<button class="btn small danger" onclick="Connection.logout('${s.id}')">Logout</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}')">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.hasQr) {
      const remain = Math.max(0, Math.round(((s.qrExpiresAt || 0) - Date.now()) / 1000));
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong>${name}</strong> ${badge}</div>
          <h4>Scan QR ini dengan WhatsApp di HP kamu</h4>
          <p class="muted">WhatsApp → Setelan → Perangkat tertaut → Tautkan perangkat</p>
          <img class="qr" src="${s.qrDataUrl}" alt="QR Code">
          <p class="muted">QR berlaku <strong id="qr-countdown-${s.id}" data-qr-countdown="${s.id}">${remain}</strong> detik lagi</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}')">Request QR baru</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}')">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.status === 'qr_expired') {
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong>${name}</strong> ${badge}</div>
          <p class="conn-error">⚠️ ${escapeHtml(s.lastError || 'QR kedaluwarsa')}</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}')">Request QR baru</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}')">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.status === 'auth_failure') {
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong>${name}</strong> ${badge}</div>
          <p class="conn-error">⚠️ Autentikasi gagal: ${escapeHtml(s.lastError || '')}</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}')">Scan ulang QR</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}')">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.status === 'disconnected') {
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong>${name}</strong> ${badge}</div>
          <p class="conn-error">⚠️ WhatsApp terputus${s.lastError ? ': ' + escapeHtml(s.lastError) : ''}</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}')">Hubungkan ulang</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}')">Hapus</button>`,
          ])}
        </div>`;
    }

    // uninitialized / connecting
    return `
      <div class="conn-box session-card">
        <div class="session-head"><strong>${name}</strong> ${badge}</div>
        <p class="muted">${s.hasCreds ? 'Menghubungkan ke WhatsApp…' : 'Belum ter-pair — scan QR untuk mengaktifkan sesi.'}</p>
        ${actions([
          `<button class="btn small" onclick="Connection.rescan('${s.id}')">${s.hasCreds ? 'Hubungkan' : 'Mulai / Scan QR'}</button>`,
          `<button class="btn small" onclick="Connection.rename('${s.id}')">Rename</button>`,
          `<button class="btn small danger" onclick="Connection.remove('${s.id}')">Hapus</button>`,
        ])}
      </div>`;
  }

  async function add() {
    const input = document.getElementById('conn-new-name');
    const name = (input?.value || '').trim();
    if (!name) {
      toast('Nama sesi wajib diisi', 'error');
      return;
    }
    try {
      await API.post('/api/sessions', { name });
      toast('Sesi ditambahkan', 'ok');
      input.value = '';
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function rename(id) {
    const cur = sessionsCache.find((s) => s.id === id);
    const name = prompt('Nama baru sesi:', cur?.name || '');
    if (!name) return;
    try {
      await API.patch(`/api/sessions/${id}`, { name });
      toast('Sesi di-rename', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(id) {
    if (
      !confirm(
        `Hapus sesi "${id}"? Kredensial akan dihapus (perlu scan QR lagi untuk dipakai). Broadcast yang memakainya akan dibatalkan.`
      )
    )
      return;
    try {
      await API.del(`/api/sessions/${id}`);
      toast('Sesi dihapus', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function rescan(id) {
    try {
      await API.post(`/api/sessions/${id}/rescan`);
      toast('Memulai ulang sesi…', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function logout(id) {
    if (!confirm('Yakin logout sesi ini dari WhatsApp? Kamu harus scan QR lagi untuk masuk.')) return;
    try {
      await API.post(`/api/sessions/${id}/logout`);
      toast('Logout berhasil', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return { start, refresh, add, rename, remove, rescan, logout };
})();

window.Connection = Connection;
