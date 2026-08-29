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

  /**
   * Sulap input[type=file] native jadi dropzone luxury:
   * klik untuk pilih, drag & drop, thumbnail + nama/ukuran file, tombol hapus.
   * Input asli disembunyikan tapi tetap dipakai form (input.files).
   */
  function enhanceFileInput(input) {
    if (!input || input.dataset.dropEnhanced) return;
    input.dataset.dropEnhanced = '1';
    input.classList.add('file-native');

    const drop = document.createElement('div');
    drop.className = 'file-drop';
    drop.innerHTML = `
      <div class="fd-empty">
        <div class="fd-ico">🖼️</div>
        <p class="fd-title">Klik atau seret gambar ke sini</p>
        <p class="fd-sub">PNG, JPG, GIF, WebP</p>
      </div>
      <div class="fd-file hidden">
        <img class="fd-thumb" alt="">
        <div class="fd-meta">
          <p class="fd-name"></p>
          <p class="fd-size"></p>
        </div>
        <button type="button" class="fd-remove" title="Hapus file">✕</button>
      </div>`;
    input.insertAdjacentElement('afterend', drop);

    const empty = drop.querySelector('.fd-empty');
    const fileBox = drop.querySelector('.fd-file');
    const thumb = drop.querySelector('.fd-thumb');
    const nameEl = drop.querySelector('.fd-name');
    const sizeEl = drop.querySelector('.fd-size');

    function fmtSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function renderFile() {
      const f = input.files && input.files[0];
      drop.classList.toggle('has-file', !!f);
      empty.classList.toggle('hidden', !!f);
      fileBox.classList.toggle('hidden', !f);
      if (f) {
        nameEl.textContent = f.name;
        sizeEl.textContent = fmtSize(f.size);
        if (thumb.dataset.url) URL.revokeObjectURL(thumb.dataset.url);
        if (f.type.startsWith('image/')) {
          thumb.dataset.url = URL.createObjectURL(f);
          thumb.src = thumb.dataset.url;
          thumb.classList.remove('hidden');
        } else {
          thumb.classList.add('hidden');
        }
      }
    }

    drop.addEventListener('click', (e) => {
      if (e.target.closest('.fd-remove')) return;
      input.click();
    });
    drop.querySelector('.fd-remove').addEventListener('click', () => {
      input.value = '';
      renderFile();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('change', renderFile);

    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('drag');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('drag');
      })
    );
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      renderFile();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    renderFile();
  }

  /** Enhance semua input file di halaman (dipanggil sekali saat init). */
  function initFileDrops() {
    document.querySelectorAll('input[type="file"]').forEach(enhanceFileInput);
  }

  return { btnBusy, isBusy, skeleton, emptyState, errorState, enhanceFileInput, initFileDrops };
})();

window.UI = UI;

document.addEventListener('DOMContentLoaded', UI.initFileDrops);
