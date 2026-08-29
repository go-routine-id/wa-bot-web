'use strict';

/**
 * Helper UI bersama: loading state tombol, skeleton loading,
 * empty state & error state (dengan tombol Coba lagi).
 * Dipakai semua modul: Connection, Templates, Broadcast, History.
 */
const UI = (() => {
  /**
   * Loading state tombol: disable + spinner + label sementara.
   * Pakai: btnBusy(btn, true, 'Mengirim…') → … await … → btnBusy(btn, false).
   * Aman dipanggil dengan btn null/undefined (no-op).
   */
  function btnBusy(btn, busy, busyLabel = 'Memproses…') {
    if (!btn) return;
    if (busy) {
      if (btn.disabled) return; // sudah busy — abaikan (cek lewat isBusy dulu)
      btn.dataset.idleHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(busyLabel)}`;
    } else {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      if (btn.dataset.idleHtml) {
        btn.innerHTML = btn.dataset.idleHtml;
        delete btn.dataset.idleHtml;
      }
    }
  }

  /** true bila tombol sedang dalam keadaan busy → caller boleh early-return (anti double submit). */
  function isBusy(btn) {
    return !!(btn && btn.disabled);
  }

  /** Skeleton loading — bar abu ber-shimmer pengganti teks "Memuat…". */
  function skeleton(kind = 'cards') {
    if (kind === 'rows') {
      return `<div class="skeleton-wrap">${'<div class="skeleton sk-row"></div>'.repeat(5)}</div>`;
    }
    return `<div class="skeleton-wrap">${'<div class="skeleton sk-card"></div>'.repeat(2)}</div>`;
  }

  /**
   * Empty state mewah: ikon + judul + kalimat + CTA opsional.
   * cta: { label, href } — link; atau { label, onclick } — aksi JS.
   */
  function emptyState({ icon = '🗂️', title, body = '', cta = null }) {
    let ctaHtml = '';
    if (cta) {
      ctaHtml = cta.href
        ? `<a class="btn primary" href="${cta.href}">${escapeHtml(cta.label)}</a>`
        : `<button class="btn primary" onclick="${cta.onclick}">${escapeHtml(cta.label)}</button>`;
    }
    return `
      <div class="state-box">
        <div class="state-icon">${icon}</div>
        <p class="state-title">${escapeHtml(title)}</p>
        ${body ? `<p class="muted">${body}</p>` : ''}
        ${ctaHtml}
      </div>`;
  }

  /**
   * Error state + tombol Coba lagi. retry: string JS untuk onclick,
   * mis. 'Connection.refresh()' — panggil fungsi load milik modul.
   */
  function errorState(message, retry) {
    return `
      <div class="state-box error">
        <div class="state-icon">⚠️</div>
        <p class="state-title">Gagal memuat</p>
        <p class="muted">${escapeHtml(message)}</p>
        <button class="btn" onclick="${retry}">🔄 Coba lagi</button>
      </div>`;
  }

  return { btnBusy, isBusy, skeleton, emptyState, errorState };
})();

window.UI = UI;
