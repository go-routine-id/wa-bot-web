'use strict';

const Broadcast = (() => {
  let templatesCache = [];

  // Sesi yang ingin dipilih (dipasang "Broadcast ulang"). loadSessions() membangun
  // ulang <select> dan itu ME-RESET value ke opsi pertama — dan loadSessions
  // dipanggil lagi oleh loadTemplates() setiap tab Create dibuka, yaitu SETELAH
  // prefillFrom selesai. Tanpa penanda ini, sesi pengirim yang disalin diam-diam
  // berganti ke sesi lain. Penanda bertahan sampai user memilih sendiri atau
  // broadcast terkirim.
  let desiredSessionId = null;
  let sessionChangeHooked = false;

  /** Sekali pasang: pilihan manual user membatalkan sesi bawaan dari "Broadcast ulang". */
  function hookSessionChange(sel) {
    if (sessionChangeHooked || !sel) return;
    sessionChangeHooked = true;
    sel.addEventListener('change', () => {
      desiredSessionId = null;
    });
  }

  function toggleSource() {
    const source = document.querySelector('input[name="bc-source"]:checked').value;
    document.getElementById('bc-template-wrap').classList.toggle('hidden', source !== 'template');
    document.getElementById('bc-direct-wrap').classList.toggle('hidden', source !== 'direct');
    if (source === 'template') previewTemplate();
  }

  async function loadTemplates() {
    try {
      templatesCache = await API.get('/api/templates');
      const sel = document.getElementById('bc-template');
      sel.innerHTML = templatesCache
        .map(
          (t) =>
            `<option value="${t.id}"${t.mediaPath ? ' data-media="1"' : ''}>${escapeHtml(t.name)}</option>`
        )
        .join('');
      CustomSelect.refreshAll(); // custom dropdown ikut render ulang
      previewTemplate();
      loadSessions(); // sesi pengirim — refresh tiap tab create dibuka
    } catch (err) {
      toast(err, 'error');
    }
  }

  /**
   * Isi dropdown "Sesi pengirim": sesi connected (pilihable, label nama + nomor);
   * sesi masih connecting disertakan sebagai opsi disabled supaya dropdown
   * tidak kosong saat reconnect setelah restart.
   */
  async function loadSessions() {
    try {
      const sessions = await API.get('/api/sessions');
      const sel = document.getElementById('bc-session');
      if (!sel) return;
      const connected = sessions.filter((s) => s.connected);
      const connecting = sessions.filter((s) => s.status === 'connecting');
      if (connected.length === 0) {
        const anyPairing = sessions.some((s) => ['qr', 'uninitialized'].includes(s.status));
        sel.innerHTML =
          `<option value="">— tidak ada sesi terhubung${anyPairing ? ' (scan QR di tab Sesi WhatsApp)' : ''} —</option>`;
      } else {
        sel.innerHTML = connected
          .map(
            (s) =>
              `<option value="${escapeHtml(s.id)}"${s.userInfo?.number ? ` data-number="${escapeHtml(s.userInfo.number)}"` : ''}>${escapeHtml(s.name)}</option>`
          )
          .join('');
      }
      // Opsi disabled untuk sesi yang masih menyambung (baru jadi selectable saat connected)
      sel.innerHTML += connecting
        .map(
          (s) =>
            `<option value="${escapeHtml(s.id)}" data-status="connecting" disabled>${escapeHtml(s.name)}</option>`
        )
        .join('');
      hookSessionChange(sel);
      // Pulihkan sesi bawaan "Broadcast ulang" setelah <select> dibangun ulang.
      // Hanya bila opsinya benar-benar ada & aktif — sesi asal bisa saja sudah
      // dihapus atau sedang tidak terhubung.
      if (desiredSessionId) {
        const opt = [...sel.options].find((o) => o.value === desiredSessionId && !o.disabled);
        if (opt) {
          sel.value = desiredSessionId;
        } else {
          // Sesi asal sudah dihapus atau sedang tidak terhubung → tidak akan pernah
          // bisa dipakai. Lepaskan penandanya, jangan mengendap: kalau tidak, slug
          // yang sama dibuat lagi nanti akan diam-diam merebut pilihan user.
          desiredSessionId = null;
        }
      }
      CustomSelect.refreshAll(); // custom dropdown ikut render ulang
    } catch (err) {
      toast(err, 'error');
    }
  }

  function previewTemplate() {
    const sel = document.getElementById('bc-template');
    const t = templatesCache.find((x) => x.id === Number(sel.value));
    const el = document.getElementById('bc-template-preview');
    el.innerHTML = t
      ? `<blockquote>${escapeHtml(t.textContent)}</blockquote>` +
        (t.mediaPath ? '<p>🖼️ Template ini menyertakan gambar.</p>' : '')
      : '';
  }

  let currentSpeedType = 'delay'; // 'delay' | 'rate'

  /* ---------------- editor baris nomor tujuan ---------------- */

  // Textarea tetap jadi jalur cepat untuk tempel massal; daftar baris di bawahnya
  // memberi edit/hapus per nomor. Keduanya disinkronkan lewat `recipientRows`.
  let recipientRows = [];
  let rowSyncing = false; // cegah tulisan balik ke textarea memicu render ulang
  let rowTimer = null;
  const MAX_ROWS_RENDER = 300; // jangan bengkakkan DOM untuk daftar sangat besar

  /** Mirror validasi backend: digit saja, 8–15 digit. */
  function isValidNumber(raw) {
    return /^\d{8,15}$/.test(String(raw).replace(/\D/g, ''));
  }

  function parseRowsFromTextarea() {
    recipientRows = String(document.getElementById('bc-recipients').value)
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function writeTextareaFromRows() {
    rowSyncing = true;
    document.getElementById('bc-recipients').value = recipientRows.join('\n');
    rowSyncing = false;
  }

  /** Textarea diketik/ditempel → bangun ulang daftar baris (di-debounce). */
  function onRecipientsInput() {
    if (rowSyncing) return;
    clearTimeout(rowTimer);
    rowTimer = setTimeout(() => {
      parseRowsFromTextarea();
      renderRecipientRows();
    }, 300);
  }

  function renderRecipientRows() {
    const el = document.getElementById('bc-recipient-rows');
    if (!el) return;
    if (recipientRows.length === 0) {
      el.innerHTML = '';
      return;
    }
    const invalid = recipientRows.filter((n) => !isValidNumber(n)).length;
    const shown = recipientRows.slice(0, MAX_ROWS_RENDER);
    const rows = shown
      .map(
        (n, i) => `
        <div class="rcp-row${isValidNumber(n) ? '' : ' invalid'}" data-idx="${i}">
          <span class="rcp-idx">${i + 1}</span>
          <input type="text" value="${escapeHtml(n)}" oninput="Broadcast.editRecipientRow(${i}, this.value)">
          <button type="button" class="rcp-del" title="Hapus nomor ini" onclick="Broadcast.removeRecipientRow(${i})">×</button>
        </div>`
      )
      .join('');
    el.innerHTML = `
      <div class="rcp-head">
        <span><strong>${recipientRows.length}</strong> nomor${invalid ? ` · <span class="rcp-warn">${invalid} tidak valid</span>` : ''}</span>
        <button type="button" class="btn small danger" onclick="Broadcast.clearRecipientRows()">Kosongkan</button>
      </div>
      <div class="rcp-list">${rows}</div>
      ${
        recipientRows.length > MAX_ROWS_RENDER
          ? `<p class="muted rcp-more">…${recipientRows.length - MAX_ROWS_RENDER} nomor lain tidak ditampilkan sebagai baris (pakai kotak teks di atas untuk mengeditnya).</p>`
          : ''
      }`;
  }

  /** Edit satu baris. Tidak me-render ulang supaya fokus ketikan tidak lepas. */
  function editRecipientRow(idx, value) {
    recipientRows[idx] = value.trim();
    writeTextareaFromRows();
    const row = document.querySelector(`#bc-recipient-rows .rcp-row[data-idx="${idx}"]`);
    if (row) row.classList.toggle('invalid', !isValidNumber(value));
  }

  function removeRecipientRow(idx) {
    recipientRows.splice(idx, 1);
    writeTextareaFromRows();
    renderRecipientRows();
  }

  function clearRecipientRows() {
    recipientRows = [];
    writeTextareaFromRows();
    renderRecipientRows();
  }

  /**
   * "Pilih dari kontak": ambil nomor dari layanan kontak lalu GABUNGKAN ke daftar
   * yang sudah ada — bukan menimpanya. User bisa memanggilnya beberapa kali
   * (mis. per label) dan menambah nomor manual di antaranya; menimpa akan
   * membuang pekerjaan itu tanpa peringatan.
   */
  async function pickFromContacts(btn) {
    if (UI.isBusy(btn)) return;
    UI.btnBusy(btn, true, 'Memuat…');
    let picked;
    try {
      picked = await Contacts.pickNumbers();
    } finally {
      UI.btnBusy(btn, false);
    }
    if (picked === null) return; // dibatalkan
    if (picked.length === 0) {
      toast('Tidak ada kontak yang dipilih', 'error');
      return;
    }

    // Sinkronkan dulu dari textarea: user bisa saja mengetik lalu langsung menekan
    // tombol ini sebelum debounce 300 ms onRecipientsInput sempat jalan, dan
    // ketikan itu belum masuk recipientRows.
    parseRowsFromTextarea();

    const existing = new Set(recipientRows.map((n) => String(n).replace(/\D/g, '')));
    const fresh = picked.filter((n) => !existing.has(n));
    recipientRows = recipientRows.concat(fresh);
    writeTextareaFromRows();
    renderRecipientRows();

    const dup = picked.length - fresh.length;
    toast(
      `${fresh.length} nomor ditambahkan` + (dup ? ` · ${dup} sudah ada di daftar` : ''),
      fresh.length ? 'ok' : 'info'
    );
  }

  /**
   * Isi form dari broadcast lama ("Broadcast ulang"). Broadcast asli TIDAK
   * disentuh — ini hanya menyalin isinya ke form agar bisa diedit lalu dikirim
   * sebagai broadcast baru.
   */
  async function prefillFrom({ messageText, sessionId, numbers }) {
    // Pakai jalur "tulis langsung": teks yang disalin adalah hasil akhir pesan,
    // bukan referensi template (template bisa sudah berubah/dihapus).
    const directRadio = document.querySelector('input[name="bc-source"][value="direct"]');
    if (directRadio) {
      directRadio.checked = true;
      toggleSource();
    }
    document.getElementById('bc-message').value = messageText || '';
    document.getElementById('bc-image').value = '';

    recipientRows = (numbers || []).map((n) => String(n).trim()).filter(Boolean);
    writeTextareaFromRows();
    renderRecipientRows();

    // Sesi pengirim ditandai, bukan di-set langsung: loadSessions() akan dipanggil
    // lagi oleh loadTemplates() saat tab Create dibuka dan itu membangun ulang
    // <select>. Penandanya dihormati loadSessions setiap kali membangun ulang.
    desiredSessionId = sessionId || null;
    await loadSessions();
  }

  function setSpeedType(type) {
    currentSpeedType = type;
    document.getElementById('pill-delay').classList.toggle('active', type === 'delay');
    document.getElementById('pill-rate').classList.toggle('active', type === 'rate');
    document.getElementById('bc-speed-delay-wrap').classList.toggle('hidden', type !== 'delay');
    document.getElementById('bc-speed-rate-wrap').classList.toggle('hidden', type !== 'rate');
    document.getElementById('bc-speed-main-label').textContent =
      type === 'delay' ? 'Jeda antar pesan' : 'Kecepatan pengiriman';
    updateSpeedPreview();
  }

  function updateSpeedPreview() {
    const preview = document.getElementById('bc-speed-preview');
    if (currentSpeedType === 'delay') {
      const sec = parseFloat(document.getElementById('bc-delay').value) || 0;
      if (sec <= 0) {
        preview.textContent = 'Masukkan angka jeda positif';
      } else {
        const estRpm = 60 / sec;
        const rpmHint = estRpm >= 1 ? `~${Math.round(estRpm)} pesan/menit` : 'kurang dari 1 pesan/menit';
        preview.textContent = `Jeda ${sec} detik antar pesan (${rpmHint})`;
      }
    } else {
      const rpm = parseInt(document.getElementById('bc-rate').value, 10) || 0;
      if (rpm <= 0) {
        preview.textContent = 'Masukkan rate pesan per menit';
      } else {
        const estSec = (60 / rpm).toFixed(1).replace(/\.0$/, '');
        preview.textContent = `${rpm} pesan/menit (~1 pesan tiap ${estSec} detik)`;
      }
    }
  }

  async function submit() {
    const btn = document.querySelector('#bc-form button[type="submit"]');
    if (UI.isBusy(btn)) return; // anti double submit
    const source = document.querySelector('input[name="bc-source"]:checked').value;
    const recipients = document.getElementById('bc-recipients').value.trim();
    const mode = document.getElementById('bc-mode').value;
    const sessionId = document.getElementById('bc-session').value;

    if (!recipients) {
      toast('Nomor tujuan wajib diisi', 'error');
      return;
    }
    if (!sessionId) {
      toast('Pilih sesi pengirim terlebih dahulu', 'error');
      return;
    }

    UI.btnBusy(btn, true, 'Mengirim…');
    try {
      const body = { mode, sessionId, recipients };
      if (currentSpeedType === 'delay') {
        const delaySeconds = parseFloat(document.getElementById('bc-delay').value);
        if (!delaySeconds || delaySeconds <= 0) {
          toast('Jeda detik per pesan harus berupa angka positif', 'error');
          return;
        }
        body.delaySeconds = delaySeconds;
      } else {
        const ratePerMinute = parseInt(document.getElementById('bc-rate').value, 10);
        if (!ratePerMinute || ratePerMinute <= 0) {
          toast('Rate pesan per menit harus berupa angka positif', 'error');
          return;
        }
        body.ratePerMinute = ratePerMinute;
      }

      if (source === 'template') {
        body.templateId = Number(document.getElementById('bc-template').value);
      } else {
        const message = document.getElementById('bc-message').value.trim();
        if (!message) {
          toast('Isi pesan broadcast terlebih dahulu', 'error');
          return;
        }
        body.messageText = message;
        const fileInput = document.getElementById('bc-image');
        if (fileInput.files && fileInput.files[0]) {
          const fd = new FormData();
          fd.append('image', fileInput.files[0]);
          const uploaded = await API.upload('/api/media', fd);
          body.mediaPath = uploaded.mediaPath;
        }
      }

      const created = await API.post('/api/broadcasts', body);
      toast(`Broadcast #${created.id} dibuat — status: ${created.status}`, 'ok');
      // Reset form
      desiredSessionId = null; // sesi bawaan "Broadcast ulang" selesai dipakai
      clearRecipientRows(); // ikut mengosongkan textarea + daftar baris
      document.getElementById('bc-message').value = '';
      document.getElementById('bc-image').value = '';
      // Pindah ke tab history (URL ikut berubah ke /history)
      Router.navigate('history');
    } catch (err) {
      toast(err, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  return {
    toggleSource,
    setSpeedType,
    updateSpeedPreview,
    loadTemplates,
    loadSessions,
    previewTemplate,
    submit,
    onRecipientsInput,
    editRecipientRow,
    removeRecipientRow,
    clearRecipientRows,
    pickFromContacts,
    prefillFrom,
  };
})();

window.Broadcast = Broadcast;
