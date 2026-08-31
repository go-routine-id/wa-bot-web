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
        UI.errorState(err.message, 'Connection.refresh()');
    }
  }

  /**
   * Waktu kedaluwarsa yang dihitung mundur untuk sebuah sesi, atau 0 bila tidak ada.
   * Hanya expiry yang masih di MASA DEPAN yang dipakai: expiry yang sudah lewat
   * membuat tick tiap detik menembakkan refresh() terus-menerus (polling 1x/detik)
   * sampai backend memancarkan kode baru — cukup biarkan polling normal 2.5 detik.
   */
  function countdownTarget(s) {
    if (s.status === 'qr') return s.qrExpiresAt || 0;
    if (s.status === 'pairing_code') return s.pairingCodeExpiresAt || 0;
    return 0;
  }

  function stopCountdown() {
    if (countdown) {
      clearInterval(countdown);
      countdown = null;
    }
  }

  // Satu interval memperbarui hitung mundur semua kartu. QR wwebjs tidak punya
  // TTL yang kita kelola (qrExpiresAt null), tapi KODE PAIRING diregenerasi
  // library tiap 3 menit — itu yang dihitung mundur di sini.
  function startCountdown() {
    if (countdown) return;
    countdown = setInterval(() => {
      const ticking = sessionsCache.filter((s) => countdownTarget(s) > Date.now());
      if (ticking.length === 0) {
        stopCountdown();
        return;
      }
      let anyExpired = false;
      ticking.forEach((s) => {
        const remain = Math.max(0, Math.round((countdownTarget(s) - Date.now()) / 1000));
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
        <div class="state-box">
          <div class="state-icon">📱</div>
          <p class="state-title">Belum ada sesi WhatsApp</p>
          <p class="muted">Satu sesi = satu nomor WhatsApp ter-pair. Ketik nama di atas lalu klik <strong>Tambah Sesi</strong> untuk mulai.</p>
        </div>`;
      return;
    }

    const cards = sessionsCache.map(renderCard).join('');
    const hasCountdown = sessionsCache.some((s) => countdownTarget(s) > Date.now());
    if (hasCountdown) startCountdown();

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
          <div class="session-head"><strong><span class="avatar">${name.charAt(0).toUpperCase()}</span>${name}</strong> ${badge}</div>
          <p class="muted">Terhubung sebagai <strong>${uname}</strong> (${unumber})</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rename('${s.id}', this)">Rename</button>`,
            `<button class="btn small danger" onclick="Connection.logout('${s.id}', this)">Logout</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}', this)">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.hasQr) {
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong><span class="avatar">${name.charAt(0).toUpperCase()}</span>${name}</strong> ${badge}</div>
          <h4>Scan QR ini dengan WhatsApp di HP kamu</h4>
          <p class="muted">WhatsApp → Setelan → Perangkat tertaut → Tautkan perangkat</p>
          <img class="qr" src="${s.qrDataUrl}" alt="QR Code">
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}', this)">Request QR baru</button>`,
            `<button class="btn small" onclick="Connection.pairingCode('${s.id}', this)">Pakai kode pairing</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}', this)">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.hasPairingCode) {
      const remain = Math.max(0, Math.round(((s.pairingCodeExpiresAt || 0) - Date.now()) / 1000));
      // Potong kode MENTAH dulu, baru escape. Kalau di-escape lebih dulu, karakter
      // seperti & berubah jadi entity (&amp;) dan slice bisa membelahnya di tengah.
      const raw = s.pairingCode || '';
      const pretty = escapeHtml(raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw);
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong><span class="avatar">${name.charAt(0).toUpperCase()}</span>${name}</strong> ${badge}</div>
          <h4>Masukkan kode ini di WhatsApp HP kamu</h4>
          <p class="muted">WhatsApp → Setelan → Perangkat tertaut → Tautkan perangkat → <strong>Tautkan dengan nomor telepon</strong></p>
          <p class="pairing-code">${pretty}</p>
          <p class="muted">Kode diperbarui dalam <strong id="qr-countdown-${s.id}" data-qr-countdown="${s.id}">${remain}</strong> detik</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}', this)">Pakai QR saja</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}', this)">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.status === 'auth_failure') {
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong><span class="avatar">${name.charAt(0).toUpperCase()}</span>${name}</strong> ${badge}</div>
          <p class="conn-error">⚠️ Autentikasi gagal: ${escapeHtml(s.lastError || '')}</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}', this)">Scan ulang QR</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}', this)">Hapus</button>`,
          ])}
        </div>`;
    }

    if (s.status === 'disconnected') {
      return `
        <div class="conn-box session-card">
          <div class="session-head"><strong><span class="avatar">${name.charAt(0).toUpperCase()}</span>${name}</strong> ${badge}</div>
          <p class="conn-error">⚠️ WhatsApp terputus${s.lastError ? ': ' + escapeHtml(s.lastError) : ''}</p>
          ${actions([
            `<button class="btn small" onclick="Connection.rescan('${s.id}', this)">Hubungkan ulang</button>`,
            `<button class="btn small danger" onclick="Connection.remove('${s.id}', this)">Hapus</button>`,
          ])}
        </div>`;
    }

    // uninitialized / connecting
    const addButtons = [
      `<button class="btn small" onclick="Connection.rescan('${s.id}', this)">${s.hasCreds ? 'Hubungkan' : 'Mulai / Scan QR'}</button>`,
    ];
    // Kode pairing hanya untuk sesi yang BELUM punya pairing valid — backend
    // menolak 409 bila hasCreds, karena pairing baru akan melepas linked device
    // yang masih hidup.
    if (!s.hasCreds) {
      addButtons.push(
        `<button class="btn small" onclick="Connection.pairingCode('${s.id}', this)">Kode pairing</button>`
      );
    }
    addButtons.push(
      `<button class="btn small" onclick="Connection.rename('${s.id}', this)">Rename</button>`,
      `<button class="btn small danger" onclick="Connection.remove('${s.id}', this)">Hapus</button>`
    );
    return `
      <div class="conn-box session-card">
        <div class="session-head"><strong><span class="avatar">${name.charAt(0).toUpperCase()}</span>${name}</strong> ${badge}</div>
        <p class="muted">${s.hasCreds ? 'Menghubungkan ke WhatsApp…' : 'Belum ter-pair — scan QR untuk mengaktifkan sesi.'}</p>
        ${actions(addButtons)}
      </div>`;
  }

  async function add(btn) {
    if (UI.isBusy(btn)) return;
    const input = document.getElementById('conn-new-name');
    const name = (input?.value || '').trim();
    if (!name) {
      toast('Nama sesi wajib diisi', 'error');
      return;
    }
    UI.btnBusy(btn, true, 'Menambah…');
    try {
      await API.post('/api/sessions', { name });
      toast('Sesi ditambahkan', 'ok');
      input.value = '';
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  async function rename(id, btn) {
    if (UI.isBusy(btn)) return;
    const cur = sessionsCache.find((s) => s.id === id);
    const name = await Modal.prompt({
      title: 'Rename sesi',
      label: 'Nama baru sesi',
      value: cur?.name || '',
    });
    if (!name) return;
    UI.btnBusy(btn, true, 'Menyimpan…');
    try {
      await API.patch(`/api/sessions/${id}`, { name });
      toast('Sesi di-rename', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  async function remove(id, btn) {
    if (UI.isBusy(btn)) return;
    const ok = await Modal.confirm({
      title: `Hapus sesi "${id}"?`,
      body: 'Kredensial akan dihapus (perlu scan QR lagi untuk dipakai). Broadcast yang memakainya akan dibatalkan.',
      okText: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    UI.btnBusy(btn, true, 'Menghapus…');
    try {
      await API.del(`/api/sessions/${id}`);
      toast('Sesi dihapus', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  async function rescan(id, btn) {
    if (UI.isBusy(btn)) return;
    UI.btnBusy(btn, true, 'Memproses…');
    try {
      await API.post(`/api/sessions/${id}/rescan`);
      toast('Memulai ulang sesi…', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  /**
   * Pairing via kode 8 karakter (alternatif scan QR). Minta nomor HP dulu —
   * kodenya dibuat async di backend dan muncul lewat polling berikutnya.
   */
  async function pairingCode(id, btn) {
    if (UI.isBusy(btn)) return;
    const phone = await Modal.prompt({
      title: 'Pairing dengan kode',
      label: 'Nomor HP yang akan dipasangkan — format internasional tanpa "+" atau 0 di depan (mis. 6281234567890)',
      value: '',
    });
    if (!phone) return;
    UI.btnBusy(btn, true, 'Meminta kode…');
    try {
      await API.post(`/api/sessions/${id}/pairing-code`, { phone });
      toast('Kode pairing diminta — muncul dalam beberapa detik…', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  async function logout(id, btn) {
    if (UI.isBusy(btn)) return;
    const ok = await Modal.confirm({
      title: 'Logout sesi ini dari WhatsApp?',
      body: 'Kamu harus scan QR lagi untuk masuk.',
      okText: 'Logout',
      danger: true,
    });
    if (!ok) return;
    UI.btnBusy(btn, true, 'Logout…');
    try {
      await API.post(`/api/sessions/${id}/logout`);
      toast('Logout berhasil', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  return { start, refresh, add, rename, remove, rescan, pairingCode, logout };
})();

window.Connection = Connection;
