'use strict';

/**
 * Dialog custom pengganti confirm()/prompt() native — berbasis <dialog>,
 * style senada toast & customSelect. Promise-based:
 *
 *   if (await Modal.confirm({ title: 'Hapus sesi?', body: '…', danger: true })) { … }
 *   const name = await Modal.prompt({ title: 'Rename sesi', value: cur.name });
 *   if (name) { … }
 *
 * confirm → resolve true (OK) / false (batal, ESC, klik backdrop).
 * prompt  → resolve string ter-trim (OK) / null (batal/ESC/kosong).
 */
const Modal = (() => {
  let dlg = null;      // <dialog> tunggal, dipakai ulang
  let resolver = null; // resolve() promise yang sedang menunggu

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title"><span class="modal-icon"></span><span class="modal-title-text"></span></h3>
        <div class="modal-body"></div>
        <div class="modal-input-wrap hidden">
          <label class="modal-label"></label>
          <input type="text" class="modal-input">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn modal-cancel">Batal</button>
          <button type="button" class="btn primary modal-ok">OK</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    dlg.querySelector('.modal-cancel').addEventListener('click', () => close(false));
    dlg.querySelector('.modal-ok').addEventListener('click', () => close(true));
    // Klik backdrop (area dialog di luar card) → batal.
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close(false);
    });
    // ESC memicu event cancel bawaan <dialog> → samakan dengan batal.
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault(); // kita yang menutup, supaya resolver jalan
      close(false);
    });
  }

  function close(ok) {
    if (!resolver) return;
    const resolve = resolver;
    resolver = null;
    if (dlg.open) dlg.close();
    if (!ok) {
      resolve(dlg.dataset.mode === 'prompt' ? null : false);
      return;
    }
    if (dlg.dataset.mode === 'prompt') {
      const val = dlg.querySelector('.modal-input').value.trim();
      resolve(val || null);
    } else {
      resolve(true);
    }
  }

  function open({ mode, title, body, label, value, placeholder, okText, danger }) {
    if (!dlg) build();
    if (resolver) resolver(dlg.dataset.mode === 'prompt' ? null : false); // dialog sebelumnya digantikan
    dlg.dataset.mode = mode;
    dlg.querySelector('.modal-title-text').textContent = title || '';
    dlg.querySelector('.modal-icon').textContent = danger ? '⚠️' : mode === 'prompt' ? '✏️' : '💬';
    const bodyEl = dlg.querySelector('.modal-body');
    bodyEl.textContent = body || '';
    bodyEl.classList.toggle('hidden', !body);

    const inputWrap = dlg.querySelector('.modal-input-wrap');
    inputWrap.classList.toggle('hidden', mode !== 'prompt');
    if (mode === 'prompt') {
      dlg.querySelector('.modal-label').textContent = label || '';
      const input = dlg.querySelector('.modal-input');
      input.value = value || '';
      input.placeholder = placeholder || '';
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          close(true);
        }
      };
    }

    const okBtn = dlg.querySelector('.modal-ok');
    okBtn.textContent = okText || 'OK';
    okBtn.classList.toggle('danger', !!danger);
    okBtn.classList.toggle('primary', !danger);
    dlg.querySelector('.modal-card').classList.toggle('danger', !!danger);

    dlg.showModal();
    if (mode === 'prompt') {
      const input = dlg.querySelector('.modal-input');
      input.focus();
      input.select();
    } else {
      okBtn.focus();
    }
    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  /** Konfirmasi OK/Batal. danger=true → tombol OK merah (aksi destruktif). */
  function confirm({ title, body, okText = 'OK', danger = false }) {
    return open({ mode: 'confirm', title, body, okText, danger });
  }

  /** Input satu baris teks. Resolve null bila batal/kosong. */
  function prompt({ title, label, value = '', placeholder = '', okText = 'Simpan' }) {
    return open({ mode: 'prompt', title, label, value, placeholder, okText });
  }

  return { confirm, prompt };
})();

window.Modal = Modal;
