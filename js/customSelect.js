'use strict';

/**
 * Custom dropdown modern di atas <select> native yang disembunyikan.
 * Select tersembunyi tetap jadi sumber value + tempat onchange dipasang —
 * logika existing (preview, submit baca .value) tidak berubah; UI custom
 * hanya tampilan, value & event di-mirror ke select native.
 *
 * Markup di index.html:
 *   <div class="cs" data-cs-for="bc-session" data-cs-placeholder="Pilih sesi pengirim" data-cs-searchable></div>
 *   <select id="bc-session" class="cs-native" hidden></select>
 *
 * Baris opsi dibangun dari <option>: value/text/disabled + atribut data-*:
 *   data-number  → sub "nomor" (sesi)     data-desc  → sub deskripsi (mode)
 *   data-status  → badge mini (mis. connecting)     data-media → ikon 🖼️ (template)
 */
const CustomSelect = (() => {
  const instances = [];

  function initial(name) {
    const t = (name || '?').trim();
    return t ? t[0].toUpperCase() : '?';
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /** Bangun satu instance: div .cs[data-cs-for] + <select> pasangannya. */
  function buildInstance(root, select) {
    const searchable = root.hasAttribute('data-cs-searchable');
    const placeholder = root.dataset.csPlaceholder || 'Pilih…';
    let options = [];
    let open = false;
    let activeIndex = -1;

    root.classList.add('cs');

    // Trigger
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'cs-trigger-label';
    const arrow = document.createElement('span');
    arrow.className = 'cs-arrow';
    trigger.append(triggerLabel, arrow);

    // Panel
    const panel = document.createElement('div');
    panel.className = 'cs-panel hidden';
    panel.setAttribute('role', 'listbox');
    let searchBox = null;
    if (searchable) {
      searchBox = document.createElement('input');
      searchBox.type = 'text';
      searchBox.className = 'cs-search';
      searchBox.placeholder = 'Cari…';
      panel.appendChild(searchBox);
    }
    const list = document.createElement('div');
    list.className = 'cs-list';
    panel.appendChild(list);
    root.append(trigger, panel);

    function readOptions() {
      return Array.from(select.options).map((o) => ({
        value: o.value,
        text: o.textContent.trim(),
        disabled: o.disabled,
        number: o.dataset.number,
        status: o.dataset.status,
        media: o.dataset.media,
        desc: o.dataset.desc,
      }));
    }

    function selectedOption() {
      return options.find((o) => o.value === select.value) || null;
    }

    function updateTrigger() {
      const sel = selectedOption();
      triggerLabel.innerHTML = sel
        ? `${escapeHtml(sel.text)}${
            sel.status === 'connecting'
              ? ' <span class="cs-mini-badge">menghubungkan…</span>'
              : ''
          }`
        : `<span class="cs-placeholder">${escapeHtml(placeholder)}</span>`;
      trigger.title = sel ? sel.text : '';
    }

    function optionRow(opt) {
      const cls = ['cs-option'];
      if (opt.disabled) cls.push('disabled');
      if (opt.value === select.value) cls.push('selected');
      const avatar =
        opt.status || opt.number
          ? `<span class="cs-avatar">${escapeHtml(initial(opt.text))}</span>`
          : '';
      const sub = opt.number
        ? `<span class="cs-sub">${escapeHtml(opt.number)}</span>`
        : opt.desc
          ? `<span class="cs-sub">${escapeHtml(opt.desc)}</span>`
          : '';
      const statusBadge =
        opt.status === 'connecting' ? '<span class="cs-mini-badge">menghubungkan…</span>' : '';
      const check = opt.value === select.value ? '<span class="cs-check">✓</span>' : '';
      return `<div class="${cls.join(' ')}" role="option" aria-selected="${opt.value === select.value}" data-value="${escapeAttr(opt.value)}">
        ${avatar}
        <span class="cs-opt-body">
          <span class="cs-title"><span class="cs-text">${escapeHtml(opt.text)}</span>${
            opt.media ? '<span class="cs-media">🖼️</span>' : ''
          }${statusBadge}</span>
          ${sub}
        </span>
        ${check}
      </div>`;
    }

    function renderList() {
      const q = searchBox ? searchBox.value.trim().toLowerCase() : '';
      const visible = options.filter((o) => !q || o.text.toLowerCase().includes(q));
      list.innerHTML = visible.length
        ? visible.map(optionRow).join('')
        : '<div class="cs-empty">Tidak ada hasil</div>';
      activeIndex = -1;
    }

    function openPanel() {
      if (open) return;
      open = true;
      trigger.setAttribute('aria-expanded', 'true');
      panel.classList.remove('hidden');
      if (searchBox) {
        searchBox.value = '';
        searchBox.focus();
      }
      renderList();
    }

    function closePanel() {
      if (!open) return;
      open = false;
      trigger.setAttribute('aria-expanded', 'false');
      panel.classList.add('hidden');
    }

    function choose(value) {
      const opt = options.find((o) => o.value === value);
      if (!opt || opt.disabled) return;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      updateTrigger();
      closePanel();
    }

    function moveActive(delta) {
      const rows = Array.from(list.querySelectorAll('.cs-option:not(.disabled)'));
      if (!rows.length) return;
      activeIndex = (activeIndex + delta + rows.length) % rows.length;
      rows.forEach((r) => r.classList.remove('active'));
      rows[activeIndex].classList.add('active');
      rows[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function panelKeydown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel();
        trigger.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveActive(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = list.children[activeIndex];
        if (row && row.classList.contains('cs-option')) choose(row.dataset.value);
      }
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      open ? closePanel() : openPanel();
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openPanel();
        moveActive(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open ? closePanel() : openPanel();
      }
    });
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.cs-option');
      if (!row) return;
      choose(row.dataset.value);
    });
    list.addEventListener('keydown', panelKeydown);
    if (searchBox) {
      searchBox.addEventListener('input', renderList);
      searchBox.addEventListener('keydown', panelKeydown);
    }
    // Tutup saat klik di luar / fokus pindah keluar komponen.
    // Klik opsi (div non-focusable) memicu focusout dengan relatedTarget null
    // (fokus pindah ke body) — jangan tutup di situ, biarkan event click yang
    // memilih. Tab / klik elemen lain / klik di luar tetap menutup.
    document.addEventListener('click', (e) => {
      if (open && !root.contains(e.target)) closePanel();
    });
    root.addEventListener('focusout', (e) => {
      if (open && e.relatedTarget && !root.contains(e.relatedTarget)) closePanel();
    });

    /** Baca ulang <option> dari select tersembunyi → render ulang label & panel. */
    function refresh() {
      options = readOptions();
      updateTrigger();
      if (open) renderList();
    }

    refresh();
    return { refresh };
  }

  /** Bangun semua instance (.cs[data-cs-for]) dari DOM saat halaman siap. */
  function init() {
    document.querySelectorAll('.cs[data-cs-for]').forEach((root) => {
      const select = document.getElementById(root.dataset.csFor);
      if (!select) return;
      instances.push(buildInstance(root, select));
    });
  }

  /** Panggil setelah konten select berubah (mis. daftar sesi/template dimuat). */
  function refreshAll() {
    instances.forEach((i) => i.refresh());
  }

  document.addEventListener('DOMContentLoaded', init);

  return { init, refreshAll };
})();

window.CustomSelect = CustomSelect;
