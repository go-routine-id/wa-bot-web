'use strict';

/**
 * Gerbang login: menampilkan layar masuk selagi belum ada kredensial, dan
 * menyembunyikan aplikasi di baliknya.
 *
 * Dipisah dari auth.js dengan sengaja — auth.js hanya tahu soal token dan
 * jaringan, tidak tahu apa-apa soal DOM. Itu yang membuatnya bisa diuji tanpa
 * browser.
 */
const Session = (() => {
  let overlay = null;
  let siapPakai = null; // resolve() dipanggil setelah login berhasil

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.innerHTML = `
      <form class="login-card" autocomplete="on">
        <div class="login-brand">📣 WA Broadcast</div>
        <p class="login-sub"></p>
        <label for="login-email">Email</label>
        <input type="email" id="login-email" name="email" autocomplete="username" required>
        <label for="login-password">Kata sandi</label>
        <div class="pw-field">
          <input type="password" id="login-password" name="password" autocomplete="current-password" required>
          <button type="button" class="pw-peek" aria-label="Tampilkan kata sandi" aria-pressed="false" title="Tampilkan kata sandi">👁️</button>
        </div>
        <p class="login-error hidden"></p>
        <button type="submit" class="btn primary login-submit">Masuk</button>
        <p class="login-foot muted"></p>
      </form>`;
    document.body.appendChild(overlay);

    // Intip kata sandi. type="button" penting: tanpa itu ia ikut men-submit form.
    const peek = overlay.querySelector('.pw-peek');
    peek.addEventListener('click', () => {
      const input = overlay.querySelector('#login-password');
      const tampil = input.type === 'text';
      input.type = tampil ? 'password' : 'text';
      peek.textContent = tampil ? '👁️' : '🙈';
      peek.setAttribute('aria-pressed', String(!tampil));
      const label = tampil ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi';
      peek.setAttribute('aria-label', label);
      peek.title = label;
      // Kembalikan fokus & posisi kursor ke akhir teks: tanpa ini fokus tertinggal
      // di tombol dan pengguna harus klik lagi untuk melanjutkan mengetik.
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });

    overlay.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await submit();
    });
  }

  function pesanError(text) {
    const el = overlay.querySelector('.login-error');
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  async function submit() {
    const btn = overlay.querySelector('.login-submit');
    if (UI.isBusy(btn)) return;
    const email = overlay.querySelector('#login-email').value.trim();
    const password = overlay.querySelector('#login-password').value;
    if (!email || !password) {
      pesanError('Email dan kata sandi wajib diisi');
      return;
    }

    pesanError('');
    UI.btnBusy(btn, true, 'Masuk…');
    try {
      const profil = await Auth.login(email, password);
      hide();
      // Segarkan identitas di kaki sidebar. App.renderWho() sudah dipanggil
      // sekali saat boot; ini untuk login yang terjadi DI TENGAH sesi (token
      // kedaluwarsa lalu masuk lagi, mungkin sebagai akun lain).
      App.renderWho();
      if (siapPakai) {
        const r = siapPakai;
        siapPakai = null;
        r(profil);
      }
    } catch (err) {
      // Pesan dari account-service dipakai apa adanya: ia sudah membedakan
      // kredensial salah, akun terkunci, dan pendaftaran dikunci admin —
      // menggantinya dengan "login gagal" justru menghilangkan petunjuk.
      pesanError(err.message);
      overlay.querySelector('#login-password').value = '';
      overlay.querySelector('#login-password').focus();
    } finally {
      UI.btnBusy(btn, false);
    }
  }

  function show(catatan) {
    if (!overlay) build();
    overlay.querySelector('.login-sub').textContent =
      catatan || 'Masuk dengan akun ikavia untuk melanjutkan';
    overlay.querySelector('.login-foot').textContent = `Akun diverifikasi oleh ${Auth.base()}`;
    overlay.classList.remove('hidden');
    document.body.classList.add('login-active');
    const email = overlay.querySelector('#login-email');
    if (!email.value) email.focus();
    else overlay.querySelector('#login-password').focus();
  }

  function hide() {
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('login-active');
  }

  /**
   * Tampilkan layar masuk dan tunggu sampai berhasil.
   * Dipanggil saat boot, dan juga saat refresh token gagal di tengah pemakaian.
   */
  // Beberapa pemanggil bisa menunggu login yang sama (gerbang boot, plus request
  // mana pun yang menerima 401). Semuanya menunggu SATU promise — versi
  // sebelumnya mengembalikan Promise.resolve() untuk pemanggil kedua, sehingga
  // ia melanjutkan seolah sudah masuk padahal layar login masih terbuka.
  let menungguLogin = null;

  function requireLogin(catatan) {
    show(catatan);
    if (!menungguLogin) {
      menungguLogin = new Promise((resolve) => {
        siapPakai = (v) => {
          menungguLogin = null;
          resolve(v);
        };
      });
    }
    return menungguLogin;
  }

  /** Gerbang saat aplikasi dimuat. Resolve begitu boleh masuk. */
  async function gate() {
    // Tanya backend dulu: dialah yang tahu autentikasi menyala atau tidak.
    await Auth.discover();
    if (Auth.disabled()) return; // backend memang berjalan tanpa autentikasi
    if (Auth.loggedIn()) {
      // Ada token tersimpan, tapi umurnya cuma ±15 menit dan halaman bisa saja
      // dibuka setelah lama ditinggal. Tukar dulu supaya request pertama tidak
      // langsung 401 dan memicu kedip layar login.
      try {
        await Auth.refresh();
        return;
      } catch (_) {
        Auth.clear();
      }
    }
    await requireLogin();
  }

  /** Keluar: cabut sesi di server, bersihkan, lalu tampilkan layar masuk. */
  async function signOut() {
    await Auth.logout();
    location.reload(); // paling bersih: seluruh state dalam memori ikut hilang
  }

  return { gate, requireLogin, signOut, show, hide };
})();

window.Session = Session;
