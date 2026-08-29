'use strict';

/**
 * History broadcast: dua mode — list (/history) dan halaman detail
 * (/history/:id). Mode detail di-derive dari URL, jadi deep-link, back,
 * dan forward browser selalu konsisten dengan yang tampil.
 */
const History = (() => {
  let pollTimer = null;

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
        `<p class="conn-error">${escapeHtml(err.message)}</p>`;
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
      el.innerHTML = '<p class="muted">Belum ada broadcast.</p>';
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
            ? `<button class="btn small" onclick="History.retryFailed(${b.id}, ${b.retryableFailedCount})">Retry gagal (${b.retryableFailedCount})</button>`
            : ''}
          ${['pending', 'running'].includes(b.status)
            ? `<button class="btn small danger" onclick="History.cancel(${b.id})">Cancel</button>`
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
    const counts = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    recipients.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status] += 1;
    });
    const pct = b.totalRecipients ? Math.round((b.sentCount / b.totalRecipients) * 100) : 0;

    const rows = recipients
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.recipientNumber)}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
        <td>${escapeHtml(r.error || '')}</td>
        <td>${escapeHtml(r.sentAt || '')}</td>
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
          ? `<button class="btn small" onclick="History.retryFailed(${b.id}, ${b.retryableFailedCount})">Kirim ulang yang gagal (${b.retryableFailedCount})</button>`
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
      <table>
        <thead><tr><th>Nomor</th><th>Status</th><th>Error</th><th>Dikirim</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function cancel(id) {
    const ok = await Modal.confirm({
      title: `Batalkan broadcast #${id}?`,
      body: 'Sisa recipient akan di-skip.',
      okText: 'Batalkan broadcast',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.post(`/api/broadcasts/${id}/cancel`);
      toast('Broadcast dibatalkan', 'ok');
      if (currentDetailId() === id) await renderDetailPage(id);
      else await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /** Buat broadcast baru dari recipient yang gagal pada broadcast #id (nomor terkirim tidak di-resend). */
  async function retryFailed(id, count) {
    const ok = await Modal.confirm({
      title: `Kirim ulang ${count} pesan gagal?`,
      body: `Broadcast baru akan dibuat dari broadcast #${id}; nomor yang sudah terkirim tidak dikirim ulang.`,
      okText: 'Kirim ulang',
    });
    if (!ok) return;
    try {
      const created = await API.post(`/api/broadcasts/${id}/retry`);
      toast(`Broadcast retry #${created.id} dibuat (${created.totalRecipients} penerima)`, 'ok');
      if (currentDetailId() === id) await renderDetailPage(id);
      else await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return { load, openDetail, renderDetailPage, backToList, cancel, retryFailed };
})();

window.History = History;
