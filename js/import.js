'use strict';

/**
 * Impor kontak dari CSV.
 *
 * Kolom: no, name, label
 *   no    — wajib, harus lolos pola nomor telepon (8–15 digit)
 *   name  — wajib
 *   label — opsional, beberapa label dipisah ';' (koma tidak bisa: sudah dipakai CSV)
 *
 * Impor berjalan di browser memakai endpoint CRUD yang sudah ada. Konsekuensinya
 * satu baris = beberapa request, jadi berkas besar makan waktu — tapi karena
 * nomor yang sudah ada DILEWATI (bukan diduplikasi), impor yang terputus di
 * tengah cukup dijalankan ulang dengan berkas yang sama.
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
   * Validasi & rencana impor
   * ================================================================= */

  const MAX_NAME = 255; // menyamai kolom contacts.name
  const MAX_LABEL = 100; // menyamai kolom labels.name

  /**
   * Periksa satu baris. Mengembalikan pesan alasan bila tidak valid, atau null.
   * Nomor diperiksa SETELAH karakter non-digit dibuang, supaya "+62 812-3456-7890"
   * tetap diterima — yang ditolak adalah yang benar-benar bukan nomor.
   */
  function rowError(row) {
    if (!row.no) return 'kolom "no" kosong';
    if (!row.name) return 'kolom "name" kosong';

    const digits = Contacts.digitsOf(row.no);
    if (!digits) return `"${row.no}" tidak mengandung angka`;
    if (/^0/.test(digits)) {
      return `diawali 0 — perlu kode negara (mis. 62${digits.slice(1)})`;
    }
    if (!Contacts.isSendableNumber(digits)) {
      return `"${row.no}" bukan nomor telepon yang sah (harus 8–15 digit)`;
    }
    if (row.name.length > MAX_NAME) return `nama melebihi ${MAX_NAME} karakter`;
    const tooLong = row.labels.find((l) => l.length > MAX_LABEL);
    if (tooLong) return `label "${tooLong.slice(0, 20)}…" melebihi ${MAX_LABEL} karakter`;
    return null;
  }

  /**
   * Susun rencana: tiap baris ditandai baru / sudah ada / tidak valid / ganda,
   * dibandingkan dengan isi kontak yang sekarang.
   */
  function buildPlan(rows, existingByPhone) {
    const seen = new Map(); // nomor → baris pertama yang memakainya
    return rows.map((row) => {
      const err = rowError(row);
      if (err) return { ...row, status: 'invalid', reason: err };

      const digits = Contacts.digitsOf(row.no);

      // Duplikat DI DALAM berkas ditandai terpisah dari duplikat terhadap
      // database — penyebab dan cara memperbaikinya berbeda.
      if (seen.has(digits)) {
        return { ...row, digits, status: 'dupe', reason: `sama dengan baris ${seen.get(digits)}` };
      }
      seen.set(digits, row.line);

      const existing = existingByPhone.get(digits);
      if (existing) {
        return { ...row, digits, status: 'existing', existingId: existing.id, existingName: existing.name };
      }
      return { ...row, digits, status: 'new' };
    });
  }

  /* ===================================================================
   * Dialog
   * ================================================================= */

  let dlg = null;
  let plan = [];
  let labelsByName = new Map();

  function close() {
    if (dlg) {
      if (dlg.open) dlg.close();
      dlg.remove();
      dlg = null;
    }
    plan = [];
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
    body.innerHTML = '<p class="muted imp-loading">Membaca berkas & membandingkan dengan kontak yang ada…</p>';

    try {
      const text = await file.text();
      const rows = mapRows(parseCsv(text));
      if (rows.length === 0) throw new Error('Tidak ada baris data setelah header');

      // Kontak & label diambil UTUH (semua halaman) — memakai satu halaman saja
      // akan menandai kontak ke-101 dan seterusnya sebagai "baru" lalu
      // menduplikasinya.
      const [existing, labels] = await Promise.all([
        Contacts.fetchAllContacts({}, (n, t) => {
          const el = dlg && dlg.querySelector('.imp-loading');
          if (el) el.textContent = `Membaca kontak yang ada… ${n}/${t}`;
        }),
        Contacts.fetchAllLabels(),
      ]);
      if (!dlg) return; // dialog ditutup saat pengambilan berjalan

      const byPhone = new Map();
      existing.items.forEach((c) => {
        const d = Contacts.digitsOf(c.phone);
        if (d && !byPhone.has(d)) byPhone.set(d, c);
      });
      labelsByName = new Map(labels.map((l) => [l.name.toLowerCase(), l]));

      plan = buildPlan(rows, byPhone);
      renderPreview(existing.truncated);
    } catch (err) {
      body.innerHTML = `<p class="imp-error">${escapeHtml(err.message)}</p>`;
      dlg.querySelector('.imp-run').classList.add('hidden');
    }
  }

  const PREVIEW_ROWS = 60;

  function renderPreview(truncatedScan) {
    const counts = { new: 0, existing: 0, invalid: 0, dupe: 0 };
    plan.forEach((r) => { counts[r.status] += 1; });

    const labelNames = new Set();
    plan.forEach((r) => {
      if (r.status === 'new' || r.status === 'existing') r.labels.forEach((l) => labelNames.add(l));
    });
    const newLabels = [...labelNames].filter((n) => !labelsByName.has(n.toLowerCase()));

    const badge = {
      new: '<span class="imp-badge new">baru</span>',
      existing: '<span class="imp-badge existing">sudah ada</span>',
      invalid: '<span class="imp-badge invalid">tidak valid</span>',
      dupe: '<span class="imp-badge dupe">ganda</span>',
    };

    const shown = plan.slice(0, PREVIEW_ROWS);
    const rows = shown
      .map(
        (r) => `
      <tr class="imp-row ${r.status}">
        <td class="imp-line">${r.line}</td>
        <td>${badge[r.status]}</td>
        <td>${escapeHtml(r.digits || r.no)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.labels.length ? r.labels.map((l) => `<span class="imp-lbl">${escapeHtml(l)}</span>`).join(' ') : '—'}</td>
        <td class="imp-reason">${escapeHtml(r.reason || (r.status === 'existing' ? `akan digabung ke "${r.existingName}"` : ''))}</td>
      </tr>`
      )
      .join('');

    dlg.querySelector('.imp-body').innerHTML = `
      <div class="imp-counts">
        <span class="imp-stat new"><strong>${counts.new}</strong> baru</span>
        <span class="imp-stat existing"><strong>${counts.existing}</strong> sudah ada</span>
        <span class="imp-stat dupe"><strong>${counts.dupe}</strong> ganda di berkas</span>
        <span class="imp-stat invalid"><strong>${counts.invalid}</strong> tidak valid</span>
      </div>
      ${newLabels.length ? `<p class="muted imp-newlabels">Label baru yang akan dibuat: ${newLabels.map((l) => `<span class="imp-lbl">${escapeHtml(l)}</span>`).join(' ')}</p>` : ''}
      ${truncatedScan ? '<p class="imp-error">Kontak terlalu banyak untuk dibaca seluruhnya — sebagian duplikat mungkin lolos.</p>' : ''}
      <div class="imp-table-wrap">
        <table class="imp-table">
          <thead><tr><th>#</th><th>Status</th><th>Nomor</th><th>Nama</th><th>Label</th><th>Keterangan</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${plan.length > PREVIEW_ROWS ? `<p class="muted imp-more">Menampilkan ${PREVIEW_ROWS} dari ${plan.length} baris. Semuanya tetap diproses saat impor.</p>` : ''}`;

    const runBtn = dlg.querySelector('.imp-run');
    const willProcess = counts.new + counts.existing;
    // Baris tidak valid & ganda DILEWATI, tidak menghentikan impor — tapi
    // jumlahnya disebut supaya tidak ada yang hilang diam-diam.
    dlg.querySelector('.imp-summary').textContent =
      willProcess > 0
        ? `${willProcess} baris akan diproses, ${counts.invalid + counts.dupe} dilewati`
        : 'Tidak ada baris yang bisa diimpor';
    runBtn.classList.toggle('hidden', willProcess === 0);
    runBtn.textContent = `Impor ${willProcess} kontak`;
    runBtn.onclick = () => runImport();
  }

  /* ===================================================================
   * Eksekusi
   * ================================================================= */

  async function runImport() {
    const http = Contacts.http;
    const targets = plan.filter((r) => r.status === 'new' || r.status === 'existing');
    close();

    const result = { created: 0, merged: 0, labelsCreated: 0, failed: [] };

    // --- 1. buat label yang belum ada, SEKALI per nama unik ---
    // Membuatnya di dalam loop kontak akan menabrak unique index LOWER(name)
    // begitu dua baris memakai label yang sama.
    const needed = new Set();
    targets.forEach((r) => r.labels.forEach((l) => needed.add(l)));
    const toCreate = [...needed].filter((n) => !labelsByName.has(n.toLowerCase()));

    for (let i = 0; i < toCreate.length; i += 1) {
      Picker.progress(`Membuat label… ${i + 1}/${toCreate.length}`);
      try {
        const created = await http.post('/api/labels', { name: toCreate[i] });
        labelsByName.set(created.name.toLowerCase(), created);
        result.labelsCreated += 1;
      } catch (err) {
        result.failed.push({ line: '-', reason: `label "${toCreate[i]}": ${err.message}` });
      }
    }

    // --- 2. kontak + label per baris ---
    for (let i = 0; i < targets.length; i += 1) {
      const row = targets[i];
      Picker.progress(`Mengimpor kontak… ${i + 1}/${targets.length}`);
      try {
        let contactId = row.existingId;
        if (row.status === 'new') {
          const c = await http.post('/api/contacts', { name: row.name, phone: row.digits });
          contactId = c.id;
          result.created += 1;
        }

        if (row.labels.length > 0) {
          const wanted = row.labels
            .map((n) => labelsByName.get(n.toLowerCase()))
            .filter(Boolean)
            .map((l) => l.id);

          // PUT mengganti SELURUH label kontak, jadi label lama harus dibaca dan
          // digabung — kalau tidak, mengimpor "VIP" akan menghapus label lain
          // yang sudah dipunyai kontak itu.
          const cur = await http.get(`/api/contacts/${contactId}/labels`);
          const curIds = (cur.items || []).map((l) => l.id);
          const merged = [...new Set([...curIds, ...wanted])];
          if (merged.length !== curIds.length) {
            await http.put(`/api/contacts/${contactId}/labels`, { label_ids: merged });
            result.merged += 1;
          }
        }
      } catch (err) {
        result.failed.push({ line: row.line, reason: err.message });
      }
    }
    Picker.progressDone();

    const parts = [`${result.created} kontak baru`];
    if (result.labelsCreated) parts.push(`${result.labelsCreated} label baru`);
    if (result.merged) parts.push(`${result.merged} kontak dilabeli`);
    toast(`Impor selesai — ${parts.join(' · ')}`, 'ok');
    if (result.failed.length) {
      toast(`${result.failed.length} baris gagal (baris ${result.failed[0].line}: ${result.failed[0].reason})`, 'error');
    }

    await Contacts.load();
  }

  // parseCsv/mapRows/buildPlan diekspor untuk diuji terpisah dari DOM.
  return { open, close, parseCsv, mapRows, buildPlan, rowError };
})();

window.ContactImport = ContactImport;
