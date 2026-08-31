'use strict';

/**
 * Dialog kaya untuk kebutuhan yang tidak tertampung Modal (confirm/prompt/select):
 * daftar bercentang, pemilih kontak dengan pencarian + paginasi, dan overlay
 * progres untuk operasi banyak-request.
 *
 * Semua fungsi mengembalikan Promise. Konvensi nilai baliknya penting:
 *   null  = user membatalkan
 *   []    = user menekan OK dengan pilihan kosong (sengaja mengosongkan)
 * Menyamakan keduanya akan membuat "lepas semua label" tak mungkin dilakukan.
 */
const Picker = (() => {
  /* ---------------------------------------------------------------- utils */

  function buildDialog(className, innerHTML) {
    const dlg = document.createElement('dialog');
    dlg.className = `modal picker ${className}`;
    dlg.innerHTML = innerHTML;
    document.body.appendChild(dlg);
    return dlg;
  }

  /** Tutup + buang dialog, lalu resolve sekali saja. */
  function finisher(dlg, resolve) {
    let done = false;
    return (value) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(value);
    };
  }

  function wireDismiss(dlg, finish, cancelValue = null) {
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault(); // kita yang menutup, supaya resolver selalu jalan
      finish(cancelValue);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) finish(cancelValue); // klik backdrop
    });
  }

  /* ------------------------------------------------- daftar bercentang */

  /**
   * checkboxes({ title, body, items:[{value,label,sub}], selected:[], okText })
   * → array value terpilih, atau null bila batal.
   */
  function checkboxes({ title, body = '', items = [], selected = [], okText = 'Simpan' }) {
    const chosen = new Set(selected);

    const dlg = buildDialog(
      'picker-check',
      `<div class="modal-card picker-card">
         <h3 class="modal-title"><span class="modal-icon">🏷️</span><span class="modal-title-text"></span></h3>
         <div class="modal-body"></div>
         <div class="picker-list"></div>
         <div class="modal-actions">
           <button type="button" class="btn picker-cancel">Batal</button>
           <button type="button" class="btn primary picker-ok"></button>
         </div>
       </div>`
    );
    dlg.querySelector('.modal-title-text').textContent = title || '';
    const bodyEl = dlg.querySelector('.modal-body');
    bodyEl.textContent = body;
    bodyEl.classList.toggle('hidden', !body);
    dlg.querySelector('.picker-ok').textContent = okText;

    const list = dlg.querySelector('.picker-list');
    list.innerHTML = items
      .map(
        (it) => `
      <label class="picker-item">
        <input type="checkbox" value="${escapeHtml(it.value)}"${chosen.has(it.value) ? ' checked' : ''}>
        <span class="picker-item-body">
          <span class="picker-item-label">${escapeHtml(it.label)}</span>
          ${it.sub ? `<span class="picker-item-sub">${escapeHtml(it.sub)}</span>` : ''}
        </span>
      </label>`
      )
      .join('');

    list.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) chosen.add(cb.value);
      else chosen.delete(cb.value);
    });

    return new Promise((resolve) => {
      const finish = finisher(dlg, resolve);
      wireDismiss(dlg, finish);
      dlg.querySelector('.picker-cancel').addEventListener('click', () => finish(null));
      dlg.querySelector('.picker-ok').addEventListener('click', () => finish([...chosen]));
      dlg.showModal();
    });
  }

  /* ------------------------------------------------------ pemilih kontak */

  const PICKER_PAGE_SIZE = 100;

  /**
   * contacts({ labels, fetchPage, fetchAll }) → array nomor (digit saja), atau null.
   *
   * Kontak dimuat per halaman, bukan sekaligus: daftar bisa ribuan dan menarik
   * semuanya saat dialog dibuka membuat pembukaan terasa menggantung. Tombol
   * "Pilih semua" barulah menarik seluruh halaman — dengan progres, karena di
   * situ kelengkapan memang yang diminta user.
   */
  function contacts({ labels = [], fetchPage, fetchAll }) {
    // id → kontak. Bertahan lintas pencarian/filter supaya pilihan tidak hilang
    // saat user mengganti kata kunci.
    const chosen = new Map();
    let loaded = [];
    let page = 1;
    let total = 0;
    let hasNext = false;
    let search = '';
    let labelId = '';
    // Grup semu: bukan label di database, melainkan filter ?favorite=true.
    // Dengan begitu kontak berbintang bisa jadi tujuan broadcast tanpa harus
    // didaftarkan sebagai anggota label mana pun.
    let favoriteOnly = false;
    let searchTimer = null;
    let busy = false;

    const pinned = labels.filter((l) => l.is_favorite);

    const dlg = buildDialog(
      'picker-contacts',
      `<div class="modal-card picker-card">
         <h3 class="modal-title"><span class="modal-icon">📇</span><span class="modal-title-text">Pilih dari kontak</span></h3>
         <div class="pk-shortcuts">
           <span class="muted pk-shortcut-label">Pintasan:</span>
           <button type="button" class="chip pk-fav">⭐ Favorit</button>
           ${pinned.map((l) => `<button type="button" class="chip pk-pin" data-id="${escapeHtml(l.id)}">${escapeHtml(l.name)} (${l.contact_count})</button>`).join('')}
           ${pinned.length ? '' : '<span class="muted pk-shortcut-hint">sematkan label di tab Kontak agar muncul di sini</span>'}
         </div>
         <div class="picker-filters">
           <input type="text" class="pk-search" placeholder="Cari nama, nomor, email…">
           <div class="cs pk-label-cs" data-cs-placeholder="Semua label"></div>
           <select class="pk-label">
             <option value="">Semua label</option>
             <option value="__fav__">⭐ Favorit</option>
             ${labels.map((l) => `<option value="${escapeHtml(l.id)}" data-desc="${l.contact_count} kontak">${l.is_favorite ? '★ ' : ''}${escapeHtml(l.name)}</option>`).join('')}
           </select>
         </div>
         <div class="picker-bulk">
           <button type="button" class="btn small pk-all">Pilih semua hasil</button>
           <button type="button" class="btn small pk-none">Bersihkan pilihan</button>
           <span class="pk-status muted"></span>
         </div>
         <div class="picker-list pk-list"></div>
         <div class="modal-actions">
           <span class="pk-count muted"></span>
           <button type="button" class="btn picker-cancel">Batal</button>
           <button type="button" class="btn primary picker-ok">Tambahkan</button>
         </div>
       </div>`
    );

    const listEl = dlg.querySelector('.pk-list');
    const statusEl = dlg.querySelector('.pk-status');
    const countEl = dlg.querySelector('.pk-count');
    const searchEl = dlg.querySelector('.pk-search');
    const labelEl = dlg.querySelector('.pk-label');
    // <select> bawaan browser digambar oleh OS: ia menembus batas dialog dan
    // memakai tema sistem, sehingga terlihat asing di tengah dialog ini.
    const labelCs = CustomSelect.attach(dlg.querySelector('.pk-label-cs'), labelEl);

    function updateCount() {
      const n = chosen.size;
      const invalid = [...chosen.values()].filter((c) => !Contacts.isSendableNumber(c.phone)).length;
      countEl.innerHTML =
        `<strong>${n}</strong> dipilih` +
        (invalid ? ` · <span class="rcp-warn">${invalid} nomor tidak valid</span>` : '');
      dlg.querySelector('.picker-ok').disabled = n === 0;
    }

    function renderList() {
      if (loaded.length === 0) {
        listEl.innerHTML = `<p class="muted picker-empty">${
          favoriteOnly && !search
            ? 'Belum ada kontak berbintang. Beri bintang di tab Kontak dulu.'
            : search || labelId || favoriteOnly
              ? 'Tidak ada kontak yang cocok.'
              : 'Belum ada kontak tersimpan.'
        }</p>`;
        return;
      }
      listEl.innerHTML =
        loaded
          .map(
            (c) => `
        <label class="picker-item">
          <input type="checkbox" value="${escapeHtml(c.id)}"${chosen.has(c.id) ? ' checked' : ''}>
          <span class="picker-item-body">
            <span class="picker-item-label">${c.is_favorite ? '<span class="star-inline">★</span> ' : ''}${escapeHtml(c.name)}</span>
            <span class="picker-item-sub">${escapeHtml(c.phone)}${
              Contacts.isSendableNumber(c.phone) ? '' : ' ⚠️ bukan format nomor valid'
            }</span>
          </span>
        </label>`
          )
          .join('') +
        (hasNext
          ? `<button type="button" class="btn small pk-more">Muat ${Math.min(
              PICKER_PAGE_SIZE,
              total - loaded.length
            )} kontak lagi (${loaded.length}/${total})</button>`
          : '');
    }

    async function reload(reset = true) {
      if (busy) return;
      busy = true;
      if (reset) {
        page = 1;
        loaded = [];
        listEl.innerHTML = '<p class="muted picker-empty">Memuat…</p>';
      }
      try {
        const res = await fetchPage({ page, pageSize: PICKER_PAGE_SIZE, search, labelId, favoriteOnly });
        loaded = reset ? res.items : loaded.concat(res.items);
        total = res.pagination ? res.pagination.total : loaded.length;
        hasNext = !!(res.pagination && res.pagination.has_next);
        statusEl.textContent = `${total} kontak cocok`;
        renderList();
      } catch (err) {
        listEl.innerHTML = `<p class="muted picker-empty">${escapeHtml(err.message)}</p>`;
      } finally {
        busy = false;
        updateCount();
      }
    }

    listEl.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const c = loaded.find((x) => x.id === cb.value);
      if (!c) return;
      if (cb.checked) chosen.set(c.id, c);
      else chosen.delete(c.id);
      updateCount();
    });

    listEl.addEventListener('click', async (e) => {
      if (!e.target.closest('.pk-more')) return;
      page += 1;
      await reload(false);
    });

    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        search = searchEl.value.trim();
        reload();
      }, 300);
    });
    labelEl.addEventListener('change', () => {
      // "⭐ Favorit" bukan id label — ia memilih filter yang sama sekali berbeda.
      // Mengirimkan "__fav__" sebagai label-id akan ditolak backend sebagai
      // "invalid label id".
      favoriteOnly = labelEl.value === '__fav__';
      labelId = favoriteOnly ? '' : labelEl.value;
      syncShortcuts();
      reload();
    });

    /** Chip pintasan menyala mengikuti filter yang sedang aktif. */
    function syncShortcuts() {
      dlg.querySelector('.pk-fav').classList.toggle('on', favoriteOnly);
      dlg.querySelectorAll('.pk-pin').forEach((b) => {
        b.classList.toggle('on', !favoriteOnly && b.dataset.id === labelId);
      });
      labelEl.value = favoriteOnly ? '__fav__' : labelId;
      // Mengubah .value lewat kode TIDAK memicu event change, jadi label pada
      // trigger dropdown harus disegarkan sendiri — kalau tidak, ia tetap
      // menampilkan pilihan sebelumnya sementara filternya sudah berganti.
      labelCs.refresh();
    }

    dlg.querySelector('.pk-fav').addEventListener('click', () => {
      favoriteOnly = !favoriteOnly;
      if (favoriteOnly) labelId = '';
      syncShortcuts();
      reload();
    });

    dlg.querySelectorAll('.pk-pin').forEach((b) => {
      b.addEventListener('click', () => {
        const same = !favoriteOnly && labelId === b.dataset.id;
        labelId = same ? '' : b.dataset.id; // klik lagi = lepas filter
        favoriteOnly = false;
        syncShortcuts();
        reload();
      });
    });

    // "Pilih semua hasil" menarik SELURUH halaman yang cocok filter — bukan hanya
    // yang kelihatan. Kalau hanya mencentang yang tampil, user yang menekannya
    // setelah memuat 100 dari 900 akan mengira sudah memilih 900.
    dlg.querySelector('.pk-all').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (UI.isBusy(btn)) return;
      UI.btnBusy(btn, true, 'Mengambil…');
      try {
        const all = await fetchAll({ search, labelId, favoriteOnly }, (n, t) => {
          statusEl.textContent = `Mengambil ${n}/${t}…`;
        });
        all.items.forEach((c) => chosen.set(c.id, c));
        statusEl.textContent = `${all.items.length} kontak cocok`;
        if (all.truncated) {
          toast('Daftar kontak sangat besar — hanya sebagian yang bisa dipilih sekaligus', 'error');
        }
        renderList();
        updateCount();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        UI.btnBusy(btn, false);
      }
    });

    dlg.querySelector('.pk-none').addEventListener('click', () => {
      chosen.clear();
      renderList();
      updateCount();
    });

    return new Promise((resolve) => {
      const base = finisher(dlg, resolve);
      const finish = (v) => {
        labelCs.destroy(); // lepas listener document milik dropdown
        base(v);
      };
      wireDismiss(dlg, finish);
      dlg.querySelector('.picker-cancel').addEventListener('click', () => finish(null));
      dlg.querySelector('.picker-ok').addEventListener('click', () => {
        finish([...chosen.values()].map((c) => Contacts.digitsOf(c.phone)).filter(Boolean));
      });
      dlg.showModal();
      updateCount();
      reload();
    });
  }

  /* --------------------------------------------- dialog "simpan ke kontak" */

  /**
   * saveContacts({ count, labels, suggestedLabel })
   * → { labelId, newLabelName } atau null bila batal.
   * labelId '' & newLabelName '' = simpan tanpa label.
   */
  function saveContacts({ count, labels = [], suggestedLabel = '' }) {
    const dlg = buildDialog(
      'picker-save',
      `<div class="modal-card picker-card">
         <h3 class="modal-title"><span class="modal-icon">💾</span><span class="modal-title-text">Simpan ke kontak</span></h3>
         <div class="modal-body">${count} nomor akan disimpan. Nomor yang sudah ada di daftar kontak tidak akan diduplikasi.</div>
         <div class="picker-field">
           <label>Beri label (opsional)</label>
           <div class="cs ps-label-cs" data-cs-placeholder="— tanpa label —"></div>
           <select class="ps-label">
             <option value="">— tanpa label —</option>
             ${labels.map((l) => `<option value="${escapeHtml(l.id)}" data-desc="${l.contact_count} kontak">${l.is_favorite ? '★ ' : ''}${escapeHtml(l.name)}</option>`).join('')}
             <option value="__new__">+ Buat label baru…</option>
           </select>
           <input type="text" class="ps-new hidden" placeholder="Nama label baru">
           <p class="muted ps-hint">Label juga dipasang ke nomor yang sudah tersimpan — label lamanya tidak dihapus.</p>
         </div>
         <div class="modal-actions">
           <button type="button" class="btn picker-cancel">Batal</button>
           <button type="button" class="btn primary picker-ok">Simpan</button>
         </div>
       </div>`
    );

    const sel = dlg.querySelector('.ps-label');
    const selCs = CustomSelect.attach(dlg.querySelector('.ps-label-cs'), sel);
    const newInput = dlg.querySelector('.ps-new');
    sel.addEventListener('change', () => {
      const isNew = sel.value === '__new__';
      newInput.classList.toggle('hidden', !isNew);
      if (isNew) {
        newInput.value = suggestedLabel || '';
        newInput.focus();
        newInput.select();
      }
    });

    return new Promise((resolve) => {
      const base = finisher(dlg, resolve);
      const finish = (v) => {
        selCs.destroy();
        base(v);
      };
      wireDismiss(dlg, finish);
      dlg.querySelector('.picker-cancel').addEventListener('click', () => finish(null));
      dlg.querySelector('.picker-ok').addEventListener('click', () => {
        if (sel.value === '__new__') {
          const name = newInput.value.trim();
          if (!name) {
            toast('Isi nama label baru, atau pilih "tanpa label"', 'error');
            return;
          }
          finish({ labelId: '', newLabelName: name });
          return;
        }
        finish({ labelId: sel.value, newLabelName: '' });
      });
      dlg.showModal();
    });
  }

  /* ------------------------------------------------------ overlay progres */

  let progressEl = null;

  /** Tampilkan/perbarui overlay progres untuk operasi banyak-request. */
  function progress(text) {
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'picker-progress';
      progressEl.innerHTML = '<div class="pp-card"><span class="spinner"></span><span class="pp-text"></span></div>';
      document.body.appendChild(progressEl);
    }
    progressEl.querySelector('.pp-text').textContent = text;
  }

  function progressDone() {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
    }
  }

  return { checkboxes, contacts, saveContacts, progress, progressDone };
})();

window.Picker = Picker;
