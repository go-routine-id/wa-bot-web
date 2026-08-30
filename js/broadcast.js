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
        .map(
          (t) =>
            `<option value="${t.id}"${t.mediaPath ? ' data-media="1"' : ''}>${escapeHtml(t.name)}</option>`
        )
        .join('');
      CustomSelect.refreshAll(); // custom dropdown ikut render ulang
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
              `<option value="${escapeHtml(s.id)}"${s.userInfo?.number ? ` data-number="${s.userInfo.number}"` : ''}>${escapeHtml(s.name)}</option>`
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
      CustomSelect.refreshAll(); // custom dropdown ikut render ulang
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
      : '';
  }

  let currentSpeedType = 'delay'; // 'delay' | 'rate'

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
      document.getElementById('bc-recipients').value = '';
      document.getElementById('bc-message').value = '';
      document.getElementById('bc-image').value = '';
      // Pindah ke tab history (URL ikut berubah ke /history)
      Router.navigate('history');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  return { toggleSource, setSpeedType, updateSpeedPreview, loadTemplates, loadSessions, previewTemplate, submit };
})();

window.Broadcast = Broadcast;
