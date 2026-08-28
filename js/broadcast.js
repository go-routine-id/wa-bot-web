'use strict';

const Broadcast = (() => {
  let templatesCache = [];

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
        .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}${t.mediaPath ? ' 🖼️' : ''}</option>`)
        .join('');
      previewTemplate();
      loadSessions(); // sesi pengirim — refresh tiap tab create dibuka
    } catch (err) {
      toast(err.message, 'error');
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
              `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}${
                s.userInfo?.number ? ' (' + escapeHtml(s.userInfo.number) + ')' : ''
              }</option>`
          )
          .join('');
      }
      // Opsi disabled untuk sesi yang masih menyambung (baru jadi selectable saat connected)
      sel.innerHTML += connecting
        .map(
          (s) =>
            `<option value="${escapeHtml(s.id)}" disabled>${escapeHtml(s.name)} (menghubungkan…)</option>`
        )
        .join('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function previewTemplate() {
    const sel = document.getElementById('bc-template');
    const t = templatesCache.find((x) => x.id === Number(sel.value));
    const el = document.getElementById('bc-template-preview');
    el.innerHTML = t
      ? `<blockquote>${escapeHtml(t.textContent)}</blockquote>` +
        (t.mediaPath ? '<p>🖼️ Template ini menyertakan gambar.</p>' : '')
      : '<p>—</p>';
  }

  async function submit() {
    const source = document.querySelector('input[name="bc-source"]:checked').value;
    const recipients = document.getElementById('bc-recipients').value.trim();
    const ratePerMinute = Number(document.getElementById('bc-rate').value);
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

    try {
      const body = { mode, ratePerMinute, sessionId, recipients };

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
      document.getElementById('bc-recipients').value = '';
      document.getElementById('bc-message').value = '';
      document.getElementById('bc-image').value = '';
      // Buka tab history
      App.showTab('history');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return { toggleSource, loadTemplates, loadSessions, previewTemplate, submit };
})();

window.Broadcast = Broadcast;
