'use strict';

/**
 * History broadcast: dua mode — list (/history) dan halaman detail
 * (/history/:id). Mode detail di-derive dari URL, jadi deep-link, back,
 * dan forward browser selalu konsisten dengan yang tampil.
 */
const History = (() => {
  let pollTimer = null;
  // Recipient yang sedang tampil di halaman detail. Dipakai handler tombol Hapus
  // supaya nomor TIDAK perlu di-interpolasi ke dalam atribut onclick — lihat catatan
  // keamanan di renderDetail().
  let detailRecipients = [];

  function tabActive() {
    const el = document.getElementById('tab-history');
    return !!(el && el.classList.contains('active'));
  }

  function hasActive(list) {
    return list.some((b) => ['pending', 'running'].includes(b.status));
  }

  /** id broadcast dari URL bila sedang di halaman detail, selain itu null. */
  function currentDetailId() {
    const m = window.location.pathname.match(/^\/history\/(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  /** Tampilkan list atau halaman detail (yang satu aktif, satunya tersembunyi). */
  function setDetailMode(on) {
    document.getElementById('hist-list').classList.toggle('hidden', on);
    document.getElementById('hist-detail').classList.toggle('hidden', !on);
  }

  /** Mulai poll tiap 2 dtk selama tab aktif & masih ada broadcast berjalan; berhenti otomatis. */
  function ensurePolling(list) {
    if (hasActive(list) && tabActive()) {
      if (!pollTimer) pollTimer = setInterval(tick, 2000);
    } else {
      stopPolling();
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function load() {
    // Sedang di halaman detail — list tidak dirender (renderDetailPage yang isi).
    if (currentDetailId() != null) {
      document.getElementById('hist-list').classList.add('hidden');
      return;
    }
    try {
      const list = await API.get('/api/broadcasts');
      setDetailMode(false);
      renderList(list);
      ensurePolling(list);
    } catch (err) {
      document.getElementById('hist-list').innerHTML =
        UI.errorState(err.message, 'History.load()');
      stopPolling();
    }
  }

  /** Tick polling: refresh sesuai mode (detail atau list), lalu atur lanjut/henti. */
  async function tick() {
    if (!tabActive()) {
      stopPolling();
      return;
    }
    try {
      const detailId = currentDetailId();
      if (detailId != null) {
        const data = await API.get(`/api/broadcasts/${detailId}`);
        renderDetail(data.broadcast, data.recipients);
        ensurePolling([data.broadcast]);
      } else {
        const list = await API.get('/api/broadcasts');
        renderList(list);
        ensurePolling(list);
      }
    } catch (_) {
      // error sementara — biarkan timer lanjut
    }
  }

  function renderList(list) {
    document.getElementById('hist-detail').classList.add('hidden');
    const el = document.getElementById('hist-list');
    if (list.length === 0) {
      el.innerHTML = UI.emptyState({
        icon: '📭',
        title: 'Belum ada broadcast',
        body: 'Broadcast yang kamu kirim akan tampil di sini beserta status tiap penerimanya.',
        cta: { label: '📣 Buat broadcast pertama', href: '/create' },
      });
      return;
    }
    const rows = list
      .map(
        (b) => `
      <tr>
        <td>#${b.id}</td>
        <td><span class="badge badge-${b.status}">${b.status}</span></td>
        <td>${escapeHtml(b.sessionName || '—')}</td>
        <td>${b.mode}</td>
        <td>${b.ratePerMinute}/mnt</td>
        <td>${b.sentCount} / ${b.failedCount} / ${b.totalRecipients}</td>
        <td>${b.createdAt}</td>
        <td>
          <button class="btn small" onclick="History.openDetail(${b.id})">Detail</button>
          ${b.retryableFailedCount > 0 && ['completed', 'failed'].includes(b.status)
            ? `<button class="btn small" onclick="History.retryFailed(${b.id}, ${b.retryableFailedCount}, this)">Retry gagal (${b.retryableFailedCount})</button>`
            : ''}
          ${['pending', 'running'].includes(b.status)
            ? `<button class="btn small danger" onclick="History.cancel(${b.id}, this)">Cancel</button>`
            : ''}
        </td>
      </tr>`
      )
      .join('');
    el.innerHTML = `
      <table>
        <thead>
          <tr><th>ID</th><th>Status</th><th>Sesi</th><th>Mode</th><th>Rate</th><th>Sent/Fail/Total</th><th>Dibuat</th><th>Aksi</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /** Dari list: buka halaman detail (URL berubah ke /history/:id). */
  function openDetail(id) {
    Router.goDetail(id);
  }

  /** Render halaman detail broadcast #id (dipanggil router saat URL /history/:id). */
  async function renderDetailPage(id) {
    try {
      const data = await API.get(`/api/broadcasts/${id}`);
      setDetailMode(true);
      renderDetail(data.broadcast, data.recipients);
      ensurePolling([data.broadcast]);
    } catch (err) {
      toast(err.message, 'error');
      Router.navigate('history'); // detail tak ditemukan → balik ke list
    }
  }

  /** Tombol "← Kembali": ke list history (/history). */
  function backToList() {
    Router.navigate('history');
  }

  function renderDetail(b, recipients) {
    const el = document.getElementById('hist-detail');
    // Simpan isi & fokus input "tambah nomor" sebelum innerHTML ditimpa: polling
    // merender ulang tiap 2 detik selama broadcast 'pending' (status yang editable).
    const prevAddInput = document.getElementById('rcp-add-input');
    const prevAddValue = prevAddInput ? prevAddInput.value : '';
    const prevAddFocused = !!prevAddInput && prevAddInput === document.activeElement;
    const counts = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    recipients.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status] += 1;
    });
    const pct = b.totalRecipients ? Math.round((b.sentCount / b.totalRecipients) * 100) : 0;

    // Daftar nomor hanya bisa diubah selama broadcast belum diproses; backend
    // menolak status lain (runner memakai snapshot recipient begitu mulai jalan).
    const editable = b.status === 'pending';

    // Nomor tujuan TIDAK boleh diinterpolasi ke dalam atribut onclick: escapeHtml
    // hanya aman untuk konteks HTML, sedangkan browser men-decode entity (mis.
    // &#39;) SEBELUM isi onclick di-parse sebagai JS — apostrof pada nomor tak
    // valid (parseTargets menyimpan teks mentah saat token tidak punya digit sama
    // sekali) akan keluar dari string literal dan mengeksekusi kode. Karena itu
    // tombol hanya membawa id numerik; nomor & status dibaca dari cache di bawah.
    detailRecipients = recipients;

    const rows = recipients
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.recipientNumber)}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
        <td>${escapeHtml(r.error || '')}</td>
        <td>${escapeHtml(r.sentAt || '')}</td>
        ${editable
          ? `<td><button class="btn small danger" onclick="History.removeRecipient(${b.id}, ${r.id}, this)">Hapus</button></td>`
          : ''}
      </tr>`
      )
      .join('');

    // retryableFailedCount (dari backend) = gagal terkirim TANPA 'invalid number'
    const canRetry = b.retryableFailedCount > 0 && ['completed', 'failed'].includes(b.status);

    el.innerHTML = `
      <div class="detail-head">
        <button class="btn small" onclick="History.backToList()">← Kembali ke list</button>
        <h3>Broadcast #${b.id} <span class="badge badge-${b.status}">${b.status}</span></h3>
        ${canRetry
          ? `<button class="btn small" onclick="History.retryFailed(${b.id}, ${b.retryableFailedCount}, this)">Kirim ulang yang gagal (${b.retryableFailedCount})</button>`
          : ''}
      </div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      <p class="muted">
        ${b.sentCount} terkirim · ${b.failedCount} gagal · ${counts.pending + counts.sending} menunggu ·
        ${counts.skipped} di-skip · dari ${b.totalRecipients} total
        · dari sesi <strong>${escapeHtml(b.sessionName || '—')}</strong>
        ${b.mode === 'queue' ? '' : ' · mode: <strong>parallel</strong>'}
      </p>
      <blockquote>${escapeHtml(b.messageText)}</blockquote>
      ${b.mediaPath ? `<img class="detail-img" src="${apiBase()}/uploads/${escapeHtml(b.mediaPath)}">` : ''}
      ${editable
        ? `<div class="recipient-add">
             <input type="text" id="rcp-add-input" placeholder="Tambah nomor tujuan (pisah koma): 6281234567890, 628…">
             <button class="btn small primary" onclick="History.addRecipients(${b.id}, this)">Tambah nomor</button>
           </div>
           <p class="muted hint-edit">Daftar nomor masih bisa diubah karena broadcast belum diproses.</p>`
        : ''}
      <table>
        <thead><tr><th>Nomor</th><th>Status</th><th>Error</th><th>Dikirim</th>${editable ? '<th>Aksi</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Kembalikan isi & fokus input supaya ketikan user tidak hilang saat polling.
    if (editable) {
      const input = document.getElementById('rcp-add-input');
      if (input) {
        input.value = prevAddValue;
        if (prevAddFocused) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    }
  }

  async function cancel(id, btn) {
    if (UI.isBusy(btn)) return;
    const ok = await Modal.confirm({
      title: `Batalkan broadcast #${id}?`,
      body: 'Sisa recipient akan di-skip.',
      okText: 'Batalkan broadcast',
      danger: true,
    });
    if (!ok) return;
    UI.btnBusy(btn, true, 'Membatalkan…');
    try {
      await API.post(`/api/broadcasts/${id}/cancel`);
      toast('Broadcast dibatalkan', 'ok');
      if (currentDetailId() === id) await renderDetailPage(id);
      else await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  /** Buat broadcast baru dari recipient yang gagal pada broadcast #id (nomor terkirim tidak di-resend). */
  async function retryFailed(id, count, btn) {
    if (UI.isBusy(btn)) return;

    let targetSessionId = null;

    try {
      // Ambil daftar sesi aktif agar user bisa memilih sesi pengirim
      const sessions = await API.get('/api/sessions');
      const connectedSessions = (sessions || []).filter((s) => s.connected || s.status === 'connected');

      if (connectedSessions.length > 0) {
        const options = connectedSessions.map((s) => ({
          value: s.id,
          label: `${s.name || s.id} (${s.userInfo?.number || s.userInfo?.name || 'Terhubung'})`,
        }));

        const selected = await Modal.select({
          title: `Kirim ulang ${count} pesan gagal?`,
          body: `Broadcast baru akan dibuat dari broadcast #${id}. Pilih sesi WhatsApp pengirim:`,
          label: 'Sesi Pengirim:',
          options,
          value: options[0].value,
          okText: 'Kirim ulang',
        });

        if (!selected) return; // User membatalkan dialog
        targetSessionId = selected;
      } else {
        const ok = await Modal.confirm({
          title: `Kirim ulang ${count} pesan gagal?`,
          body: `Broadcast baru akan dibuat dari broadcast #${id}; nomor yang sudah terkirim tidak dikirim ulang.`,
          okText: 'Kirim ulang',
        });
        if (!ok) return;
      }
    } catch (err) {
      console.warn('Gagal memuat sesi untuk retry:', err);
      const ok = await Modal.confirm({
        title: `Kirim ulang ${count} pesan gagal?`,
        body: `Broadcast baru akan dibuat dari broadcast #${id}; nomor yang sudah terkirim tidak dikirim ulang.`,
        okText: 'Kirim ulang',
      });
      if (!ok) return;
    }

    UI.btnBusy(btn, true, 'Mengirim…');
    try {
      const payload = targetSessionId ? { sessionId: targetSessionId } : {};
      const created = await API.post(`/api/broadcasts/${id}/retry`, payload);
      toast(`Broadcast retry #${created.id} dibuat (${created.totalRecipients} penerima)`, 'ok');
      if (currentDetailId() === id) await renderDetailPage(id);
      else await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  /** Tambah nomor tujuan ke broadcast yang belum diproses. */
  async function addRecipients(id, btn) {
    if (UI.isBusy(btn)) return;
    const input = document.getElementById('rcp-add-input');
    const raw = (input?.value || '').trim();
    if (!raw) {
      toast('Isi dulu nomor yang ingin ditambahkan', 'error');
      return;
    }
    UI.btnBusy(btn, true, 'Menambah…');
    try {
      const res = await API.post(`/api/broadcasts/${id}/recipients`, { recipients: raw });
      const skipped = res.skipped ? ` (${res.skipped} duplikat diabaikan)` : '';
      toast(`${res.added} nomor ditambahkan${skipped}`, 'ok');
      if (input) input.value = '';
      await renderDetailPage(id);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  /**
   * Hapus satu nomor dari broadcast. Nomor yang pesannya SUDAH terkirim diberi
   * peringatan terpisah — menghapusnya menghilangkan jejak pengiriman, jadi
   * backend baru menerima setelah konfirmasi eksplisit (?confirmSent=true).
   */
  async function removeRecipient(broadcastId, recipientId, btn) {
    if (UI.isBusy(btn)) return;
    const target = detailRecipients.find((r) => r.id === recipientId);
    if (!target) {
      toast('Nomor sudah tidak ada di daftar — memuat ulang…', 'error');
      await renderDetailPage(broadcastId);
      return;
    }
    const number = target.recipientNumber;
    const isSent = target.status === 'sent';
    const ok = await Modal.confirm({
      title: isSent ? 'Hapus nomor yang sudah terkirim?' : `Hapus nomor ${number}?`,
      body: isSent
        ? `Pesan ke ${number} sudah benar-benar terkirim. Menghapusnya akan menghilangkan jejak pengiriman dari riwayat dan tidak bisa dibatalkan.`
        : `Nomor ${number} akan dihapus dari broadcast ini.`,
      okText: isSent ? 'Tetap hapus' : 'Hapus',
      danger: true,
    });
    if (!ok) return;
    UI.btnBusy(btn, true, 'Menghapus…');
    try {
      const q = isSent ? '?confirmSent=true' : '';
      await API.del(`/api/broadcasts/${broadcastId}/recipients/${recipientId}${q}`);
      toast('Nomor dihapus', 'ok');
      await renderDetailPage(broadcastId);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  return {
    load,
    openDetail,
    renderDetailPage,
    backToList,
    cancel,
    retryFailed,
    addRecipients,
    removeRecipient,
  };
})();

window.History = History;
