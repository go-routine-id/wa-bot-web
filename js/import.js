'use strict';

/**
 * Impor kontak dari CSV.
 *
 * Kolom: no, name, label
 *   no    — wajib, harus lolos pola nomor telepon (8–15 digit)
 *   name  — wajib
 *   label — opsional, beberapa label dipisah ';' (koma tidak bisa: sudah dipakai CSV)
 *
 * Yang dikerjakan di sini HANYA mengurai CSV dan menampilkan hasilnya. Penilaian
 * tiap baris (nomor sah? sudah ada? kembar?) dan penulisannya dilakukan
 * go-contact lewat POST /api/contacts/import.
 *
 * Pratinjau memanggil endpoint yang SAMA dengan dry_run: true — server
 * menjalankan seluruh proses lalu membatalkan transaksinya. Jadi yang
 * ditampilkan ke pengguna dihitung oleh kode yang persis sama dengan yang nanti
 * menulis. Menghitungnya sendiri di sini sudah dua kali menghasilkan pratinjau
 * yang berbeda dari hasilnya.
 */
const ContactImport = (() => {
  /* ===================================================================
   * Parser CSV
   * ================================================================= */

  /**
   * Pengurai CSV mengikuti RFC 4180: menghormati tanda kutip, koma di dalam
   * kutip, kutip ganda "" sebagai escape, serta akhir baris CRLF maupun LF.
   *
   * String.split(',') TIDAK dipakai: nama seperti "Santoso, Budi" akan terbelah
   * jadi dua kolom dan menggeser seluruh baris — kesalahan yang tidak terlihat
   * sampai datanya sudah masuk.
   */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    // BOM dari Excel ikut terbaca sebagai karakter pertama dan membuat header
    // pertama jadi "﻿no" sehingga kolomnya tak dikenali.
    const src = text.replace(/^﻿/, '');

    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];

      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            field += '"'; // "" = satu tanda kutip literal
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    // Baris terakhir tanpa newline penutup tetap harus ikut.
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== '')); // buang baris kosong
  }

  // Nama kolom dicocokkan longgar: huruf kecil, tanpa spasi, dan akhiran "[]"
  // dibuang — supaya header "Label", "label[]", dan "LABEL" sama-sama dikenali.
  function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/\[\]$/, '');
  }

  const HEADER_ALIASES = {
    no: 'no',
    nomor: 'no',
    phone: 'no',
    name: 'name',
    nama: 'name',
    label: 'label',
  };

  /** Petakan baris CSV → objek {no, name, label[]} memakai header di baris pertama. */
  function mapRows(rows) {
    if (rows.length === 0) throw new Error('Berkas CSV kosong');

    const header = rows[0].map((h) => HEADER_ALIASES[normalizeHeader(h)] || normalizeHeader(h));
    const idxNo = header.indexOf('no');
    const idxName = header.indexOf('name');
    // Kolom label boleh muncul lebih dari sekali; semuanya digabung.
    const idxLabels = header.map((h, i) => (h === 'label' ? i : -1)).filter((i) => i >= 0);

    const missing = [];
    if (idxNo < 0) missing.push('no');
    if (idxName < 0) missing.push('name');
    if (missing.length) {
      throw new Error(
        `Kolom wajib tidak ditemukan: ${missing.join(', ')}. ` +
          `Baris pertama harus berisi nama kolom, terbaca: ${rows[0].join(', ')}`
      );
    }

    return rows.slice(1).map((r, i) => {
      const labels = idxLabels
        .flatMap((idx) => String(r[idx] || '').split(';'))
        .map((x) => x.trim())
        .filter(Boolean);
      return {
        line: i + 2, // +2: baris 1 adalah header, dan manusia menghitung dari 1
        no: String(r[idxNo] || '').trim(),
        name: String(r[idxName] || '').trim(),
        labels: [...new Set(labels)],
      };
    });
  }

  /* ===================================================================
   * Panggilan ke server
   * ================================================================= */

  const MAX_ITEMS = 5000; // menyamai MaxImportItems di go-contact

  /** Kirim baris ke endpoint impor. dryRun=true → server menilai tanpa menulis. */
  function callImport(rows, dryRun) {
    return Contacts.http.post('/api/contacts/import', {
      dry_run: dryRun,
      items: rows.map((r) => ({ no: r.no, name: r.name, label: r.labels })),
    });
  }

  /* ===================================================================
   * Dialog
   * ================================================================= */

  let dlg = null;
  let rows = [];      // baris CSV mentah, dikirim apa adanya ke server
  let preview = null; // jawaban dry-run terakhir dari server

  function close() {
    if (dlg) {
      if (dlg.open) dlg.close();
      dlg.remove();
      dlg = null;
    }
    rows = [];
    preview = null;
  }

  function open() {
    if (!contactsEnabled()) {
      toast('Layanan kontak dimatikan (WA_CONTACT_BASE kosong)', 'error');
      return;
    }
    close();
    dlg = document.createElement('dialog');
    dlg.className = 'modal picker picker-import';
    dlg.innerHTML = `
      <div class="modal-card picker-card">
        <h3 class="modal-title"><span class="modal-icon">📥</span><span class="modal-title-text">Impor kontak dari CSV</span></h3>
        <div class="imp-body"></div>
        <div class="modal-actions">
          <span class="imp-summary muted"></span>
          <button type="button" class="btn imp-cancel">Tutup</button>
          <button type="button" class="btn primary imp-run hidden">Impor</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('.imp-cancel').addEventListener('click', close);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close();
    });
    renderPickFile();
    dlg.showModal();
  }

  function renderPickFile() {
    dlg.querySelector('.imp-body').innerHTML = `
      <p class="muted">Berkas CSV dengan baris pertama sebagai nama kolom:</p>
      <pre class="imp-sample">no,name,label
628123456789,Budi Santoso,Pelanggan;VIP
628987654321,Siti Aminah,Reseller
628111222333,Andi,</pre>
      <ul class="imp-rules muted">
        <li><strong>no</strong> — wajib, nomor telepon 8–15 digit dengan kode negara (spasi, <code>+</code>, dan <code>-</code> boleh, akan dibersihkan)</li>
        <li><strong>name</strong> — wajib</li>
        <li><strong>label</strong> — opsional, beberapa label dipisah titik-koma <code>;</code></li>
      </ul>
      <input type="file" class="imp-file" accept=".csv,text/csv">`;
    dlg.querySelector('.imp-file').addEventListener('change', onFileChosen);
    dlg.querySelector('.imp-run').classList.add('hidden');
    dlg.querySelector('.imp-summary').textContent = '';
  }

  async function onFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const body = dlg.querySelector('.imp-body');
    body.innerHTML = '<p class="muted imp-loading">Membaca berkas…</p>';

    try {
      rows = mapRows(parseCsv(await file.text()));
      if (rows.length === 0) throw new Error('Tidak ada baris data setelah header');
      if (rows.length > MAX_ITEMS) {
        throw new Error(
          `Berkas berisi ${rows.length} baris, melebihi batas ${MAX_ITEMS} per impor. ` +
            'Pecah berkasnya — mengimpor bagian yang sama dua kali aman karena nomor yang sudah ada dilewati.'
        );
      }

      body.innerHTML = `<p class="muted imp-loading">Memeriksa ${rows.length} baris di server…</p>`;
      // dry_run: server menjalankan seluruh proses lalu membatalkannya.
      preview = await callImport(rows, true);
      if (!dlg) return; // dialog ditutup selagi menunggu
      renderPreview();
    } catch (err) {
      if (!dlg) return;
      body.innerHTML = `<p class="imp-error">${escapeHtml(err.message)}</p>
        <button type="button" class="btn small imp-back">← Pilih berkas lain</button>`;
      dlg.querySelector('.imp-back').addEventListener('click', renderPickFile);
      dlg.querySelector('.imp-run').classList.add('hidden');
      dlg.querySelector('.imp-summary').textContent = '';
    }
  }

  const PREVIEW_ROWS = 60;

  /** Tampilkan hasil dry-run dari server. TIDAK menghitung apa pun sendiri. */
  function renderPreview() {
    const badge = {
      new: '<span class="imp-badge new">baru</span>',
      existing: '<span class="imp-badge existing">sudah ada</span>',
      skipped: '<span class="imp-badge invalid">dilewati</span>',
    };

    const shown = preview.items.slice(0, PREVIEW_ROWS);
    const trs = shown
      .map((it) => {
        const row = rows[it.index] || {};
        return `
      <tr class="imp-row ${it.status}">
        <td class="imp-line">${row.line ?? it.index + 2}</td>
        <td>${badge[it.status] || escapeHtml(it.status)}</td>
        <td>${escapeHtml(it.no)}</td>
        <td>${escapeHtml(row.name || '')}</td>
        <td>${(row.labels || []).length ? row.labels.map((l) => `<span class="imp-lbl">${escapeHtml(l)}</span>`).join(' ') : '—'}</td>
        <td class="imp-reason">${escapeHtml(it.reason || (it.status === 'existing' ? 'label digabung, nama lama dipertahankan' : ''))}</td>
      </tr>`;
      })
      .join('');

    dlg.querySelector('.imp-body').innerHTML = `
      <div class="imp-counts">
        <span class="imp-stat new"><strong>${preview.created}</strong> baru</span>
        <span class="imp-stat existing"><strong>${preview.existing}</strong> sudah ada</span>
        <span class="imp-stat invalid"><strong>${preview.skipped}</strong> dilewati</span>
      </div>
      ${preview.new_labels.length ? `<p class="muted imp-newlabels">Label baru yang akan dibuat: ${preview.new_labels.map((l) => `<span class="imp-lbl">${escapeHtml(l)}</span>`).join(' ')}</p>` : ''}
      <div class="imp-table-wrap">
        <table class="imp-table">
          <thead><tr><th>#</th><th>Status</th><th>Nomor</th><th>Nama</th><th>Label</th><th>Keterangan</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
      ${preview.items.length > PREVIEW_ROWS ? `<p class="muted imp-more">Menampilkan ${PREVIEW_ROWS} dari ${preview.items.length} baris. Semuanya tetap diproses saat impor.</p>` : ''}
      <button type="button" class="btn small imp-back">← Pilih berkas lain</button>`;

    // Salah pilih berkas ketahuan justru DI layar ini. Tanpa jalan kembali,
    // satu-satunya cara mengganti adalah menutup dialog lalu mengulang dari awal.
    dlg.querySelector('.imp-back').addEventListener('click', renderPickFile);

    const runBtn = dlg.querySelector('.imp-run');
    const willProcess = preview.created + preview.existing;
    dlg.querySelector('.imp-summary').textContent =
      willProcess > 0
        ? `${willProcess} baris akan diproses, ${preview.skipped} dilewati`
        : 'Tidak ada baris yang bisa diimpor';
    runBtn.classList.toggle('hidden', willProcess === 0);
    runBtn.textContent = `Impor ${willProcess} kontak`;
    runBtn.onclick = () => runImport();
  }

  /* ===================================================================
   * Eksekusi
   * ================================================================= */

  async function runImport() {
    const btn = dlg && dlg.querySelector('.imp-run');
    if (UI.isBusy(btn)) return; // anti klik ganda
    UI.btnBusy(btn, true, 'Mengimpor…');

    const sending = rows;
    try {
      // Satu request untuk seluruh berkas, satu transaksi di server: kalau gagal
      // di tengah, tidak ada separuh data yang tertinggal.
      const res = await callImport(sending, false);
      close();

      const parts = [`${res.created} kontak baru`];
      if (res.existing) parts.push(`${res.existing} sudah ada`);
      if (res.labels_created) parts.push(`${res.labels_created} label baru`);
      if (res.labeled) parts.push(`${res.labeled} kontak dilabeli`);
      toast(`Impor selesai — ${parts.join(' · ')}`, 'ok');
      if (res.skipped) {
        const first = res.items.find((i) => i.status === 'skipped');
        // `sending`, BUKAN `rows`: close() di atas sudah mengosongkan rows, jadi
        // membacanya di sini menghasilkan "baris undefined".
        toast(`${res.skipped} baris dilewati (baris ${(sending[first.index] || {}).line}: ${first.reason})`, 'error');
      }
      await Contacts.load();
    } catch (err) {
      // Transaksi dibatalkan seluruhnya — tidak perlu menebak apa yang terlanjur
      // masuk, dan berkas yang sama bisa langsung dicoba lagi.
      UI.btnBusy(btn, false);
      toast(`Impor gagal, tidak ada data yang tertulis: ${err.message}`, 'error');
    }
  }

  // parseCsv & mapRows diekspor untuk diuji terpisah dari DOM.
  return { open, close, parseCsv, mapRows };
})();

window.ContactImport = ContactImport;
