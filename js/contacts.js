'use strict';

/**
 * Kontak — antarmuka untuk layanan TERPISAH `go-contact`.
 *
 * Beda dari modul lain: modul ini TIDAK memakai `API` dari api.js, karena
 * go-contact punya base URL sendiri (contactBase()) dan amplop respons yang
 * berbeda — sukses `{success, data}`, error `{success:false, message}` — bukan
 * `{error}` seperti wa-bot-service. Memakai API biasa akan membuat setiap pesan
 * error tampil sebagai "HTTP 400" tanpa isi.
 */
const Contacts = (() => {
  /* =======================================================================
   * Klien HTTP ke go-contact
   * ===================================================================== */

  const ContactHTTP = (() => {
    async function request(method, path, body) {
      if (!contactsEnabled()) {
        throw new Error('Layanan kontak dimatikan (WA_CONTACT_BASE kosong)');
      }
      const opts = { method, headers: {} };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }

      let res;
      try {
        res = await fetch(contactBase() + path, opts);
      } catch (err) {
        // fetch hanya melempar untuk kegagalan jaringan/CORS. Bedakan dari error
        // HTTP biasa: penyebab tersering adalah go-contact mati atau origin ini
        // belum terdaftar di CORS_ORIGINS-nya — dan pesan bawaan browser
        // ("Failed to fetch") tidak menyebut satu pun dari keduanya.
        throw new Error(
          `Tidak bisa menghubungi layanan kontak di ${contactBase()} — ` +
            'pastikan go-contact berjalan dan origin ini terdaftar di CORS_ORIGINS-nya'
        );
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.message || `HTTP ${res.status}`;
        // request_id dari go-contact membuat error bisa dilacak ke log server.
        throw new Error(json.request_id ? `${msg} (ref: ${json.request_id})` : msg);
      }
      return json.data !== undefined ? json.data : json;
    }

    return {
      get: (p) => request('GET', p),
      post: (p, b) => request('POST', p, b ?? {}),
      put: (p, b) => request('PUT', p, b),
      del: (p) => request('DELETE', p),
    };
  })();

  /* =======================================================================
   * Konstanta & state
   * ===================================================================== */

  // Batas server: paginate_utils.Normalize meng-clamp limit > 100 menjadi 100.
  // Meminta lebih TIDAK error — diam-diam dipotong — jadi jangan pernah kirim
  // page-size lebih besar dan mengira dapat semuanya.
  const SERVER_MAX_PAGE_SIZE = 100;

  // Pengaman putaran "ambil semua halaman". Tanpa ini, satu bug paginasi di
  // server (has_next selalu true) akan membuat browser meminta tanpa henti.
  const MAX_FETCH_PAGES = 100; // = 10.000 kontak

  let contactsCache = []; // kontak yang sedang tampil di tab
  let labelsCache = [];
  let pageState = { page: 1, totalPages: 1, total: 0 };
  let filterState = { search: '', labelId: '', favoriteOnly: false };
  let searchTimer = null;
  let labelSelectCs = null; // handle dropdown label di toolbar
  // Kontak yang sedang dibuka di halaman detail (/contacts/:id), beserta labelnya.
  let detailContact = null;
  let detailLabels = [];

  /** Digit saja — dipakai untuk dedup & untuk mengisi form broadcast. */
  function digitsOf(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  /** Mirror validasi wa-bot-service: 8–15 digit. */
  function isSendableNumber(phone) {
    return /^\d{8,15}$/.test(digitsOf(phone));
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  /* =======================================================================
   * Pengambilan data
   * ===================================================================== */

  /**
   * Satu halaman kontak.
   *
   * favoriteOnly dikirim sebagai ?favorite=true HANYA bila benar-benar diminta.
   * Backend menolak nilai kosong/cacat dengan 400 (disengaja: "?favorite=" yang
   * diam-diam berarti "semua kontak" pernah jadi jalan menuju broadcast ke
   * seluruh daftar), jadi jangan pernah mengirim parameter ini dalam keadaan kosong.
   */
  async function fetchContactPage({ page = 1, pageSize = SERVER_MAX_PAGE_SIZE, search, labelId, favoriteOnly }) {
    const path =
      '/api/contacts' +
      qs({
        page,
        'page-size': pageSize,
        search: search || undefined,
        'label-id': labelId || undefined,
        favorite: favoriteOnly ? 'true' : undefined,
      });
    const data = await ContactHTTP.get(path);
    return { items: data.items || [], pagination: data.pagination || null };
  }

  /**
   * Ambil SELURUH kontak yang cocok filter, halaman demi halaman.
   *
   * Dipakai jalur yang harus lengkap atau tidak sama sekali: "pilih semua" di
   * picker dan dedup saat menyimpan dari history. Mengambil satu halaman lalu
   * memperlakukannya sebagai keseluruhan akan diam-diam membuang kontak ke-101
   * dan seterusnya — persis kegagalan yang tak terlihat sampai datanya banyak.
   *
   * onProgress(loaded, total) dipanggil tiap halaman agar UI tidak terlihat menggantung.
   */
  async function fetchAllContacts({ search, labelId, favoriteOnly } = {}, onProgress) {
    const all = [];
    let page = 1;
    let total = 0;
    let truncated = false;

    for (;;) {
      const { items, pagination } = await fetchContactPage({ page, search, labelId, favoriteOnly });
      all.push(...items);
      total = pagination ? pagination.total : all.length;
      if (onProgress) onProgress(all.length, total);

      if (!pagination || !pagination.has_next) break;
      page += 1;
      if (page > MAX_FETCH_PAGES) {
        truncated = true;
        break;
      }
    }
    return { items: all, total, truncated };
  }

  async function fetchAllLabels() {
    const all = [];
    let page = 1;
    for (;;) {
      // TANPA order-by: urutan bawaan server sudah "yang disematkan dulu, lalu
      // abjad". Mengirim order-by=name justru menang atas is_favorite dan
      // membuat label yang disematkan tidak naik ke atas sama sekali.
      const data = await ContactHTTP.get(
        '/api/labels' + qs({ page, 'page-size': SERVER_MAX_PAGE_SIZE })
      );
      all.push(...(data.items || []));
      const pg = data.pagination;
      if (!pg || !pg.has_next || page > MAX_FETCH_PAGES) break;
      page += 1;
    }
    labelsCache = all;
    return all;
  }

  /* =======================================================================
   * Tab Kontak — daftar
   * ===================================================================== */

  /** Id kontak dari URL bila sedang di halaman detail, selain itu null. */
  function currentDetailId() {
    const m = window.location.pathname.match(
      /^\/contacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
    );
    return m ? m[1] : null;
  }

  /** Tampilkan daftar atau halaman detail — yang satu aktif, satunya tersembunyi. */
  function setDetailMode(on) {
    document.getElementById('ct-list-view').classList.toggle('hidden', on);
    document.getElementById('ct-detail').classList.toggle('hidden', !on);
  }

  async function load() {
    const el = document.getElementById('ct-content');
    if (!el) return;

    // Sedang di halaman detail — daftar tidak dirender (renderDetailPage yang isi).
    // Tanpa penjagaan ini, App.showTab('contacts') yang dipanggil router saat
    // membuka /contacts/:id akan menimpa halaman detail dengan daftar.
    if (currentDetailId() !== null) return;
    setDetailMode(false);

    if (!contactsEnabled()) {
      el.innerHTML = UI.emptyState({
        icon: '🔌',
        title: 'Fitur kontak dimatikan',
        body:
          'Base URL layanan kontak kosong. Aktifkan di konsol browser: ' +
          '<code>localStorage.setItem(\'WA_CONTACT_BASE\', \'http://localhost:7281\')</code> lalu muat ulang.',
      });
      return;
    }

    el.innerHTML = UI.skeleton('rows');
    try {
      await fetchAllLabels();
      const { items, pagination } = await fetchContactPage({
        page: pageState.page,
        pageSize: 20,
        search: filterState.search,
        labelId: filterState.labelId,
        favoriteOnly: filterState.favoriteOnly,
      });
      contactsCache = items;
      pageState = {
        page: pagination ? pagination.page : 1,
        totalPages: pagination ? pagination.total_pages : 1,
        total: pagination ? pagination.total : items.length,
      };
      render();
    } catch (err) {
      el.innerHTML = UI.errorState(err.message, 'Contacts.load()');
    }
  }

  function render() {
    renderToolbar();
    renderList();
    renderLabelPanel();
  }

  function renderToolbar() {
    const el = document.getElementById('ct-toolbar');
    if (!el) return;
    const opts = labelsCache
      .map(
        (l) =>
          `<option value="${escapeHtml(l.id)}" data-desc="${l.contact_count} kontak"${l.id === filterState.labelId ? ' selected' : ''}>${l.is_favorite ? '★ ' : ''}${escapeHtml(l.name)}</option>`
      )
      .join('');
    el.innerHTML = `
      <input type="text" id="ct-search" class="ct-search" placeholder="Cari nama, nomor, email…" value="${escapeHtml(filterState.search)}">
      <button type="button" id="ct-fav-filter" class="btn small star-toggle${filterState.favoriteOnly ? ' on' : ''}"
              title="Tampilkan hanya kontak berbintang">${filterState.favoriteOnly ? '★' : '☆'} Favorit</button>
      <div class="cs ct-label-cs" data-cs-placeholder="Semua label"></div>
      <select id="ct-label-filter" class="ct-label-filter">
        <option value="">Semua label</option>
        ${opts}
      </select>
      <span class="ct-count muted">${pageState.total} kontak</span>`;

    // Toolbar dibangun ulang tiap load(), jadi instance lama harus dilepas dulu —
    // kalau tidak, tiap penyaringan menumpuk satu listener document.
    if (labelSelectCs) labelSelectCs.destroy();
    labelSelectCs = CustomSelect.attach(el.querySelector('.ct-label-cs'), document.getElementById('ct-label-filter'));

    const search = document.getElementById('ct-search');
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filterState.search = search.value.trim();
        pageState.page = 1;
        load();
      }, 300);
    });
    document.getElementById('ct-label-filter').addEventListener('change', (e) => {
      filterState.labelId = e.target.value;
      pageState.page = 1;
      load();
    });
    document.getElementById('ct-fav-filter').addEventListener('click', () => {
      filterState.favoriteOnly = !filterState.favoriteOnly;
      pageState.page = 1;
      load();
    });
  }

  function renderList() {
    const el = document.getElementById('ct-content');
    if (!el) return;

    if (contactsCache.length === 0) {
      // favoriteOnly WAJIB ikut dihitung. Tanpa itu, menyaring favorit saat belum
      // ada kontak berbintang menampilkan "Belum ada kontak" — padahal kontaknya
      // ada banyak, hanya tidak ada yang berbintang. Pesan itu membuat orang
      // mengira datanya hilang.
      const filtering = filterState.search || filterState.labelId || filterState.favoriteOnly;
      const favoritKosong = filterState.favoriteOnly && !filterState.search && !filterState.labelId;
      el.innerHTML = UI.emptyState({
        icon: favoritKosong ? '⭐' : filtering ? '🔍' : '📇',
        title: favoritKosong
          ? 'Belum ada kontak berbintang'
          : filtering
            ? 'Tidak ada kontak yang cocok'
            : 'Belum ada kontak',
        body: favoritKosong
          ? 'Klik bintang ☆ di baris kontak untuk menandainya sebagai favorit.'
          : filtering
            ? 'Ubah kata kunci atau pilih label lain.'
            : 'Tambah manual lewat form di atas, atau simpan dari broadcast lama di tab History.',
      });
      return;
    }

    // Nama/nomor TIDAK diinterpolasi ke atribut onclick — browser men-decode
    // entity HTML sebelum isi onclick diparse sebagai JS, sehingga apostrof pada
    // nama bisa keluar dari string literal dan mengeksekusi kode. Tombol hanya
    // membawa id; datanya diambil dari contactsCache lewat event delegation.
    const rows = contactsCache
      .map(
        (c) => `
      <tr>
        <td class="ct-star">
          <button class="star-btn${c.is_favorite ? ' on' : ''}" data-act="star" data-id="${escapeHtml(c.id)}"
                  title="${c.is_favorite ? 'Lepas dari favorit' : 'Jadikan favorit'}">${c.is_favorite ? '★' : '☆'}</button>
        </td>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.phone)}${isSendableNumber(c.phone) ? '' : ' <span class="ct-warn" title="Bukan format nomor WhatsApp yang valid (8–15 digit)">⚠️</span>'}</td>
        <td>${escapeHtml(c.email || '—')}</td>
        <td class="ct-notes">${escapeHtml(c.notes || '')}</td>
        <td>${escapeHtml(fmtTime(c.updated_at))}</td>
        <td class="ct-actions">
          <button class="btn small" data-act="labels" data-id="${escapeHtml(c.id)}">Label</button>
          <button class="btn small" data-act="edit" data-id="${escapeHtml(c.id)}">Edit</button>
          <button class="btn small danger" data-act="del" data-id="${escapeHtml(c.id)}">Hapus</button>
        </td>
      </tr>`
      )
      .join('');

    const pager =
      pageState.totalPages > 1
        ? `<div class="ct-pager">
             <button class="btn small" data-act="prev" ${pageState.page <= 1 ? 'disabled' : ''}>← Sebelumnya</button>
             <span class="muted">Halaman ${pageState.page} dari ${pageState.totalPages}</span>
             <button class="btn small" data-act="next" ${pageState.page >= pageState.totalPages ? 'disabled' : ''}>Berikutnya →</button>
           </div>`
        : '';

    el.innerHTML = `
      <table>
        <thead><tr><th></th><th>Nama</th><th>Nomor</th><th>Email</th><th>Catatan</th><th>Diupdate</th><th>Aksi</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${pager}`;

    el.onclick = (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'prev') {
        pageState.page -= 1;
        load();
      } else if (act === 'next') {
        pageState.page += 1;
        load();
      } else if (act === 'edit') {
        Router.goContact(btn.dataset.id);
      } else if (act === 'del') {
        remove(btn.dataset.id, btn);
      } else if (act === 'labels') {
        manageLabels(btn.dataset.id, btn);
      } else if (act === 'star') {
        toggleStar(btn.dataset.id, btn);
      }
    };
  }

  /* =======================================================================
   * Form tambah / edit kontak
   * ===================================================================== */

  function clearForm() {
    ['ct-name', 'ct-phone', 'ct-email', 'ct-address', 'ct-notes'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  /** Form di tab Kontak hanya untuk MENAMBAH; mengubah dilakukan di /contacts/:id. */
  async function save() {
    const btn = document.querySelector('#ct-form button[type="submit"]');
    if (UI.isBusy(btn)) return;
    const name = document.getElementById('ct-name').value.trim();
    const phone = document.getElementById('ct-phone').value.trim();
    const email = document.getElementById('ct-email').value.trim();
    const address = document.getElementById('ct-address').value.trim();
    const notes = document.getElementById('ct-notes').value.trim();

    if (!name || !phone) {
      toast('Nama dan nomor wajib diisi', 'error');
      return;
    }

    UI.btnBusy(btn, true, 'Menyimpan…');
    try {
      // Kolom opsional yang kosong DIHILANGKAN, bukan dikirim sebagai "".
      //
      // Create dan Update sengaja beda aturannya di backend: Update menerima ""
      // sebagai perintah "kosongkan", tapi Create memvalidasi email dengan
      // Email() murni sehingga {"email":""} ditolak 400 — menambah kontak tanpa
      // email jadi mustahil. Field yang tidak dikirim = tidak diisi.
      const body = { name, phone };
      if (email) body.email = email;
      if (address) body.address = address;
      if (notes) body.notes = notes;

      await ContactHTTP.post('/api/contacts', body);
      toast('Kontak ditambahkan', 'ok');
      clearForm();
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  async function remove(id, btn) {
    if (UI.isBusy(btn)) return;
    const c =
      contactsCache.find((x) => x.id === id) ||
      (detailContact && detailContact.id === id ? detailContact : null);
    const ok = await Modal.confirm({
      title: c ? `Hapus kontak ${c.name}?` : 'Hapus kontak ini?',
      body: c ? `Nomor ${c.phone} akan dihapus dari daftar kontak.` : '',
      okText: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    UI.btnBusy(btn, true, 'Menghapus…');
    try {
      await ContactHTTP.del(`/api/contacts/${id}`);
      toast('Kontak dihapus', 'ok');
      // Dihapus dari halaman detailnya sendiri → halaman itu tak punya isi lagi.
      if (currentDetailId() === id) {
        backToList();
        return;
      }
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  /* =======================================================================
   * Label
   * ===================================================================== */

  function renderLabelPanel() {
    const el = document.getElementById('ct-labels');
    if (!el) return;
    if (labelsCache.length === 0) {
      el.innerHTML = '<p class="muted">Belum ada label. Label memudahkan broadcast ke satu kelompok sekaligus.</p>';
    } else {
      el.innerHTML = labelsCache
        .map(
          (l) => `
        <span class="lbl-chip${l.is_favorite ? ' pinned' : ''}">
          <button class="lbl-act star-btn${l.is_favorite ? ' on' : ''}" data-act="pin" data-id="${escapeHtml(l.id)}"
                  title="${l.is_favorite ? 'Lepas sematan' : 'Sematkan — muncul di atas & jadi pintasan saat broadcast'}">${l.is_favorite ? '★' : '☆'}</button>
          <span class="lbl-name">${escapeHtml(l.name)}</span>
          <span class="lbl-count">${l.contact_count}</span>
          <button class="lbl-act" data-act="rename" data-id="${escapeHtml(l.id)}" title="Ganti nama">✎</button>
          <button class="lbl-act" data-act="del" data-id="${escapeHtml(l.id)}" title="Hapus label">×</button>
        </span>`
        )
        .join('');
    }

    el.onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'rename') await renameLabel(btn.dataset.id);
      if (btn.dataset.act === 'del') await removeLabel(btn.dataset.id);
      if (btn.dataset.act === 'pin') await togglePin(btn.dataset.id, btn);
    };
  }

  async function addLabel(btn) {
    if (UI.isBusy(btn)) return;
    const name = await Modal.prompt({
      title: 'Label baru',
      label: 'Nama label',
      placeholder: 'cth: Pelanggan Lama',
    });
    if (!name) return;
    UI.btnBusy(btn, true, 'Menyimpan…');
    try {
      await ContactHTTP.post('/api/labels', { name });
      toast(`Label "${name}" dibuat`, 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  async function renameLabel(id) {
    const l = labelsCache.find((x) => x.id === id);
    if (!l) return;
    const name = await Modal.prompt({ title: 'Ganti nama label', label: 'Nama baru', value: l.name });
    if (!name || name === l.name) return;
    try {
      await ContactHTTP.put(`/api/labels/${id}`, { name });
      toast('Label diganti', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function removeLabel(id) {
    const l = labelsCache.find((x) => x.id === id);
    if (!l) return;
    const ok = await Modal.confirm({
      title: `Hapus label "${l.name}"?`,
      body:
        l.contact_count > 0
          ? `${l.contact_count} kontak akan kehilangan label ini. Kontaknya sendiri TIDAK ikut terhapus.`
          : 'Label ini belum dipakai kontak mana pun.',
      okText: 'Hapus label',
      danger: true,
    });
    if (!ok) return;
    try {
      await ContactHTTP.del(`/api/labels/${id}`);
      toast('Label dihapus', 'ok');
      if (filterState.labelId === id) filterState.labelId = ''; // filter aktif ikut dilepas
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }


  /**
   * Bintangi / lepas bintang satu kontak.
   *
   * Hanya `is_favorite` yang dikirim — sengaja. Ikut mengirim nama/nomor akan
   * menimpanya dengan salinan cache yang bisa sudah basi bila kontak yang sama
   * diedit dari tab lain.
   */
  async function toggleStar(id, btn) {
    if (UI.isBusy(btn)) return;
    const c = contactsCache.find((x) => x.id === id);
    if (!c) return;
    const next = !c.is_favorite;

    // Optimistis: bintang harus terasa seketika. Dikembalikan bila server menolak.
    btn.classList.toggle('on', next);
    btn.textContent = next ? '★' : '☆';
    btn.disabled = true;
    try {
      await ContactHTTP.put(`/api/contacts/${id}`, { is_favorite: next });
      c.is_favorite = next;
      // Saat filter favorit aktif, kontak yang dilepas harus benar-benar keluar
      // dari daftar — kalau hanya bintangnya yang berubah, daftar jadi bohong.
      if (filterState.favoriteOnly) await load();
    } catch (err) {
      btn.classList.toggle('on', !next);
      btn.textContent = next ? '☆' : '★';
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /** Sematkan / lepas sematan label. Label tersemat naik ke atas & jadi pintasan broadcast. */
  async function togglePin(id, btn) {
    if (UI.isBusy(btn)) return;
    const l = labelsCache.find((x) => x.id === id);
    if (!l) return;
    btn.disabled = true;
    try {
      // Hanya is_favorite: mengirim ulang `name` akan menimpa rename yang mungkin
      // baru dilakukan orang lain dengan nilai lama dari cache.
      await ContactHTTP.put(`/api/labels/${id}`, { is_favorite: !l.is_favorite });
      await load(); // urutan label ikut berubah → render ulang panelnya
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  /** Atur label milik SATU kontak (PUT mengganti seluruh daftar). */
  async function manageLabels(contactId, btn) {
    if (UI.isBusy(btn)) return;
    const c = contactsCache.find((x) => x.id === contactId);
    if (!c) return;
    if (labelsCache.length === 0) {
      toast('Belum ada label — buat dulu lewat tombol "+ Label"', 'error');
      return;
    }
    UI.btnBusy(btn, true, 'Memuat…');
    let current = [];
    try {
      const data = await ContactHTTP.get(`/api/contacts/${contactId}/labels`);
      current = (data.items || []).map((l) => l.id);
    } catch (err) {
      toast(err.message, 'error');
      UI.btnBusy(btn, false);
      return;
    }
    UI.btnBusy(btn, false);

    const picked = await Picker.checkboxes({
      title: `Label untuk ${c.name}`,
      body: 'Centang label yang ingin dipasang. Menghapus semua centang melepas seluruh label.',
      items: labelsCache.map((l) => ({ value: l.id, label: l.name, sub: `${l.contact_count} kontak` })),
      selected: current,
      okText: 'Simpan label',
    });
    if (picked === null) return; // batal — beda dari [] (lepas semua)

    try {
      await ContactHTTP.put(`/api/contacts/${contactId}/labels`, { label_ids: picked });
      toast('Label kontak diperbarui', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* =======================================================================
   * Dipakai modul lain
   * ===================================================================== */

  /**
   * Buka picker kontak → resolve array nomor (digit saja), atau null bila batal.
   * Dipakai tombol "Pilih dari kontak" di form Buat Broadcast.
   */
  async function pickNumbers() {
    if (!contactsEnabled()) {
      toast('Layanan kontak dimatikan (WA_CONTACT_BASE kosong)', 'error');
      return null;
    }
    try {
      await fetchAllLabels();
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
    return Picker.contacts({ labels: labelsCache, fetchPage: fetchContactPage, fetchAll: fetchAllContacts });
  }

  /**
   * Simpan sekumpulan nomor sebagai kontak (dipakai "Simpan ke kontak" di History).
   * Nomor yang SUDAH ada tidak diduplikasi — go-contact tidak punya unique index
   * pada kolom phone, jadi tanpa pemeriksaan ini setiap klik akan menumpuk
   * salinan nomor yang sama.
   */
  async function saveNumbers(numbers, { suggestedLabel } = {}) {
    if (!contactsEnabled()) {
      toast('Layanan kontak dimatikan (WA_CONTACT_BASE kosong)', 'error');
      return null;
    }
    const wanted = [...new Set((numbers || []).map(digitsOf).filter(Boolean))];
    if (wanted.length === 0) {
      toast('Tidak ada nomor yang bisa disimpan', 'error');
      return null;
    }

    let labels = [];
    try {
      labels = await fetchAllLabels();
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }

    const choice = await Picker.saveContacts({
      count: wanted.length,
      labels,
      suggestedLabel,
    });
    if (!choice) return null;

    // --- dedup terhadap kontak yang sudah ada ---
    let existing;
    try {
      existing = await fetchAllContacts({}, (loaded, total) =>
        Picker.progress(`Memeriksa duplikat… ${loaded}/${total}`)
      );
    } catch (err) {
      Picker.progressDone();
      toast(err.message, 'error');
      return null;
    }

    const byPhone = new Map();
    existing.items.forEach((c) => {
      const d = digitsOf(c.phone);
      if (d && !byPhone.has(d)) byPhone.set(d, c);
    });

    const toCreate = wanted.filter((n) => !byPhone.has(n));
    const alreadyThere = wanted.filter((n) => byPhone.has(n));

    // --- label tujuan (buat baru bila perlu) ---
    let labelId = choice.labelId;
    if (choice.newLabelName) {
      try {
        const created = await ContactHTTP.post('/api/labels', { name: choice.newLabelName });
        labelId = created.id;
      } catch (err) {
        Picker.progressDone();
        toast(`Gagal membuat label: ${err.message}`, 'error');
        return null;
      }
    }

    // --- buat kontak yang belum ada ---
    const createdContacts = [];
    const failed = [];
    for (let i = 0; i < toCreate.length; i += 1) {
      const phone = toCreate[i];
      Picker.progress(`Menyimpan kontak… ${i + 1}/${toCreate.length}`);
      try {
        // Nama belum diketahui dari broadcast — pakai nomornya sendiri supaya
        // kontak tetap punya nama yang wajib diisi backend; user bisa merapikan
        // di tab Kontak.
        const c = await ContactHTTP.post('/api/contacts', { name: phone, phone });
        createdContacts.push(c);
      } catch (err) {
        failed.push({ phone, message: err.message });
      }
    }

    // --- pasang label ---
    let labelled = 0;
    const labelFailed = [];
    if (labelId) {
      const targets = [...createdContacts.map((c) => c.id), ...alreadyThere.map((n) => byPhone.get(n).id)];
      for (let i = 0; i < targets.length; i += 1) {
        const id = targets[i];
        Picker.progress(`Memasang label… ${i + 1}/${targets.length}`);
        try {
          // PUT mengganti SELURUH label kontak. Untuk kontak yang sudah ada,
          // label lamanya harus dibaca dan digabung dulu — kalau langsung dikirim
          // [labelId] saja, semua label lain milik kontak itu terhapus diam-diam.
          const cur = await ContactHTTP.get(`/api/contacts/${id}/labels`);
          const ids = (cur.items || []).map((l) => l.id);
          if (ids.includes(labelId)) continue;
          await ContactHTTP.put(`/api/contacts/${id}/labels`, { label_ids: [...ids, labelId] });
          labelled += 1;
        } catch (err) {
          labelFailed.push(id);
        }
      }
    }
    Picker.progressDone();

    const parts = [`${createdContacts.length} kontak baru disimpan`];
    if (alreadyThere.length) parts.push(`${alreadyThere.length} sudah ada`);
    if (labelled) parts.push(`${labelled} diberi label`);
    if (existing.truncated) {
      toast(
        `Kontak terlalu banyak untuk diperiksa seluruhnya (dibaca ${existing.items.length}) — ` +
          'sebagian duplikat mungkin lolos',
        'error'
      );
    }
    if (failed.length) {
      toast(`${failed.length} nomor gagal disimpan: ${failed[0].message}`, 'error');
    }
    if (labelFailed.length) {
      toast(`${labelFailed.length} kontak gagal diberi label`, 'error');
    }
    toast(parts.join(' · '), 'ok');

    return { created: createdContacts.length, existing: alreadyThere.length, failed: failed.length };
  }

  /* =======================================================================
   * Halaman detail kontak — /contacts/:id
   * ===================================================================== */

  /** Render halaman edit kontak (dipanggil router saat URL /contacts/:id). */
  async function renderDetailPage(id) {
    const el = document.getElementById('ct-detail');
    if (!el) return;
    setDetailMode(true);
    el.innerHTML = UI.skeleton('rows');

    try {
      // Kontak & labelnya diambil bersamaan — dua request independen, tak ada
      // gunanya menunggu berurutan.
      const [contact, labelData, allLabels] = await Promise.all([
        ContactHTTP.get(`/api/contacts/${id}`),
        ContactHTTP.get(`/api/contacts/${id}/labels`),
        fetchAllLabels(),
      ]);
      detailContact = contact;
      detailLabels = labelData.items || [];
      labelsCache = allLabels;
      renderDetail();
    } catch (err) {
      // Kontak dihapus / id ngawur di URL → jangan tinggalkan halaman kosong.
      // "Coba lagi" saja tidak cukup: kalau kontaknya memang sudah tidak ada,
      // mencoba lagi selamanya gagal dan user tersangkut di URL mati tanpa
      // jalan keluar selain mengetik ulang alamat.
      detailContact = null;
      detailLabels = [];
      el.innerHTML = `
        <div class="detail-head">
          <button class="btn small" onclick="Contacts.backToList()">← Kembali ke daftar</button>
        </div>
        ${UI.errorState(err.message, `Contacts.renderDetailPage('${id}')`)}`;
    }
  }

  function renderDetail() {
    const c = detailContact;
    const el = document.getElementById('ct-detail');

    const chips = detailLabels.length
      ? detailLabels.map((l) => `<span class="lbl-chip"><span class="lbl-name">${escapeHtml(l.name)}</span></span>`).join('')
      : '<span class="muted">Belum ada label</span>';

    el.innerHTML = `
      <div class="detail-head">
        <button class="btn small" onclick="Contacts.backToList()">← Kembali ke daftar</button>
        <button class="star-btn lg${c.is_favorite ? ' on' : ''}" onclick="Contacts.toggleDetailStar(this)"
                title="${c.is_favorite ? 'Lepas dari favorit' : 'Jadikan favorit'}">${c.is_favorite ? '★' : '☆'}</button>
        <h3>${escapeHtml(c.name)}</h3>
      </div>

      <div class="card">
        <form id="ctd-form" onsubmit="event.preventDefault(); Contacts.saveDetail();">
          <div class="row">
            <div class="col">
              <label for="ctd-name">Nama</label>
              <input type="text" id="ctd-name" value="${escapeHtml(c.name || '')}">
            </div>
            <div class="col">
              <label for="ctd-phone">Nomor WhatsApp</label>
              <input type="text" id="ctd-phone" value="${escapeHtml(c.phone || '')}">
              ${isSendableNumber(c.phone) ? '' : '<small class="rcp-warn">Bukan format nomor WhatsApp valid (8–15 digit) — broadcast ke nomor ini akan gagal.</small>'}
            </div>
          </div>
          <div class="row">
            <div class="col">
              <label for="ctd-email">Email</label>
              <input type="text" id="ctd-email" value="${escapeHtml(c.email || '')}">
            </div>
            <div class="col">
              <label for="ctd-address">Alamat</label>
              <input type="text" id="ctd-address" value="${escapeHtml(c.address || '')}">
            </div>
          </div>
          <label for="ctd-notes">Catatan</label>
          <textarea id="ctd-notes" rows="3">${escapeHtml(c.notes || '')}</textarea>
          <p class="muted ctd-hint">Mengosongkan sebuah kolom akan menghapus isinya.</p>

          <div class="row actions">
            <button type="submit" class="btn primary">Simpan perubahan</button>
            <button type="button" class="btn danger" onclick="Contacts.remove('${c.id}', this)">Hapus kontak</button>
          </div>
        </form>
      </div>

      <div class="ct-labels-head">
        <h3>Label kontak ini</h3>
        <button class="btn small" onclick="Contacts.editDetailLabels(this)">Atur label</button>
      </div>
      <div class="ct-labels">${chips}</div>

      <p class="muted ctd-meta">Dibuat ${escapeHtml(fmtTime(c.created_at))} · terakhir diubah ${escapeHtml(fmtTime(c.updated_at))}</p>`;
  }

  function backToList() {
    Router.navigate('contacts'); // URL kembali ke /contacts
  }

  /** Bintang di halaman detail. Terpisah dari toggleStar karena sumber datanya
   *  detailContact, bukan contactsCache — di halaman ini daftar tidak dimuat. */
  async function toggleDetailStar(btn) {
    if (!detailContact || btn.disabled) return;
    const next = !detailContact.is_favorite;
    btn.disabled = true;
    try {
      detailContact = await ContactHTTP.put(`/api/contacts/${detailContact.id}`, { is_favorite: next });
      renderDetail();
      toast(next ? 'Ditambahkan ke favorit' : 'Dilepas dari favorit', 'ok');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  async function saveDetail() {
    const btn = document.querySelector('#ctd-form button[type="submit"]');
    if (UI.isBusy(btn)) return;
    const name = document.getElementById('ctd-name').value.trim();
    const phone = document.getElementById('ctd-phone').value.trim();

    if (!name || !phone) {
      toast('Nama dan nomor wajib diisi', 'error');
      return;
    }

    UI.btnBusy(btn, true, 'Menyimpan…');
    try {
      // String kosong dikirim apa adanya — backend membedakan null (jangan diubah)
      // dari "" (kosongkan). Mengubahnya jadi null di sini akan membuat kolom
      // opsional mustahil dikosongkan lewat UI.
      const updated = await ContactHTTP.put(`/api/contacts/${detailContact.id}`, {
        name,
        phone,
        email: document.getElementById('ctd-email').value.trim(),
        address: document.getElementById('ctd-address').value.trim(),
        notes: document.getElementById('ctd-notes').value.trim(),
      });
      detailContact = updated;
      renderDetail();
      toast('Kontak diperbarui', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  /** Atur label kontak yang sedang dibuka di halaman detail. */
  async function editDetailLabels(btn) {
    if (UI.isBusy(btn)) return;
    if (labelsCache.length === 0) {
      toast('Belum ada label — buat dulu di daftar kontak lewat tombol "+ Label"', 'error');
      return;
    }
    const picked = await Picker.checkboxes({
      title: `Label untuk ${detailContact.name}`,
      body: 'Centang label yang ingin dipasang. Menghapus semua centang melepas seluruh label.',
      items: labelsCache.map((l) => ({ value: l.id, label: l.name, sub: `${l.contact_count} kontak` })),
      selected: detailLabels.map((l) => l.id),
      okText: 'Simpan label',
    });
    if (picked === null) return; // batal — beda dari [] (lepas semua)

    UI.btnBusy(btn, true, 'Menyimpan…');
    try {
      await ContactHTTP.put(`/api/contacts/${detailContact.id}/labels`, { label_ids: picked });
      const [labelData, allLabels] = await Promise.all([
        ContactHTTP.get(`/api/contacts/${detailContact.id}/labels`),
        fetchAllLabels(),
      ]);
      detailLabels = labelData.items || [];
      labelsCache = allLabels;
      renderDetail();
      toast('Label kontak diperbarui', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  return {
    load,
    save,
    remove,
    clearForm,
    renderDetailPage,
    backToList,
    toggleStar,
    togglePin,
    toggleDetailStar,
    saveDetail,
    editDetailLabels,
    addLabel,
    pickNumbers,
    saveNumbers,
    // dipakai Picker & modul lain
    digitsOf,
    isSendableNumber,
    // Dipakai ContactImport supaya base URL, amplop error, dan pesan
    // "tidak bisa menghubungi layanan kontak" tidak ditulis dua kali.
    // fetchAllContacts/fetchAllLabels TIDAK lagi diekspor: sejak impor memakai
    // endpoint bulk, browser tak perlu menarik seluruh kontak untuk dedup.
    http: ContactHTTP,
  };
})();

window.Contacts = Contacts;
