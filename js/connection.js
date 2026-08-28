'use strict';

const Connection = (() => {
  let timer = null;       // poll status (2.5s)
  let countdown = null;   // interval hitung mundur QR (1s)
  let lastStatus = null;  // status terakhir dari API (untuk countdown)

  function start() {
    if (timer) return;
    timer = setInterval(refresh, 2500);
  }

  async function refresh() {
    const section = document.getElementById('tab-connection');
    if (!section || !section.classList.contains('active')) return;
    try {
      render(await API.get('/api/connection/status'));
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

  // Hitung mundur validitas QR. Saat habis → refresh() (backend sudah qr_expired,
  // render otomatis menampilkan tombol manual).
  function startCountdown() {
    if (countdown) return;
    countdown = setInterval(() => {
      if (!lastStatus || lastStatus.status !== 'qr' || !lastStatus.qrExpiresAt) {
        stopCountdown();
        return;
      }
      const remain = Math.max(0, Math.round((lastStatus.qrExpiresAt - Date.now()) / 1000));
      const num = document.getElementById('qr-countdown-num');
      if (num) num.textContent = remain;
      if (remain <= 0) {
        stopCountdown();
        refresh();
      }
    }, 1000);
  }

  function render(s) {
    stopCountdown(); // reset hitung mundur tiap render; QR branch menyalakannya lagi
    const el = document.getElementById('conn-content');

    if (s.connected) {
      const name = s.userInfo?.name ? escapeHtml(s.userInfo.name) : '(tanpa nama)';
      const number = s.userInfo?.number ? escapeHtml(s.userInfo.number) : '?';
      el.innerHTML = `
        <div class="conn-box">
          <p class="conn-connected">✅ WhatsApp terhubung</p>
          <p class="muted">Terhubung sebagai <strong>${name}</strong> (${number})</p>
          <button class="btn" onclick="Connection.logout()">Logout</button>
        </div>`;
      return;
    }

    if (s.hasQr) {
      const remain = Math.max(0, Math.round(((s.qrExpiresAt || 0) - Date.now()) / 1000));
      lastStatus = s;
      el.innerHTML = `
        <div class="conn-box">
          <h3>Scan QR ini dengan WhatsApp di HP kamu</h3>
          <p class="muted">Buka WhatsApp → Setelan → Perangkat tertaut → Tautkan perangkat</p>
          <img class="qr" src="${s.qrDataUrl}" alt="QR Code">
          <p class="muted">QR berlaku <strong id="qr-countdown-num">${remain}</strong> detik lagi</p>
          <button class="btn" onclick="Connection.rescan()">Request QR baru</button>
        </div>`;
      startCountdown();
      return;
    }

    if (s.status === 'qr_expired') {
      el.innerHTML = `
        <div class="conn-box">
          <p class="conn-error">⚠️ ${escapeHtml(s.lastError || 'QR kedaluwarsa')}</p>
          <button class="btn" onclick="Connection.rescan()">Request QR baru</button>
        </div>`;
      return;
    }

    if (s.status === 'auth_failure') {
      el.innerHTML = `
        <div class="conn-box">
          <p class="conn-error">⚠️ Autentikasi gagal: ${escapeHtml(s.lastError || '')}</p>
          <button class="btn" onclick="Connection.rescan()">Scan ulang QR</button>
        </div>`;
      return;
    }

    if (s.status === 'disconnected') {
      el.innerHTML = `
        <div class="conn-box">
          <p class="conn-error">⚠️ WhatsApp terputus${s.lastError ? ': ' + escapeHtml(s.lastError) : ''}</p>
          <button class="btn" onclick="Connection.rescan()">Hubungkan ulang</button>
        </div>`;
      return;
    }

    // uninitialized / connecting
    el.innerHTML = `<div class="conn-box"><p class="muted">Menghubungkan ke WhatsApp…</p></div>`;
  }

  async function rescan() {
    try {
      await API.post('/api/connection/rescan');
      toast('Memulai ulang koneksi…', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function logout() {
    if (!confirm('Yakin logout dari WhatsApp? Kamu harus scan QR lagi untuk masuk.')) return;
    try {
      await API.post('/api/connection/logout');
      toast('Logout berhasil', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return { start, refresh, rescan, logout };
})();

window.Connection = Connection;
