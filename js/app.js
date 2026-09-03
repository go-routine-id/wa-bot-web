'use strict';

const App = (() => {
  function showTab(name) {
    document.querySelectorAll('.tab-section').forEach((s) => {
      s.classList.toggle('active', s.id === `tab-${name}`);
    });
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === name);
    });

    // refresh konten sesuai tab yang dibuka
    if (name === 'connection') Connection.refresh(); // render sesi langsung, bukan nunggu poll
    if (name === 'templates') Templates.load();
    if (name === 'contacts') Contacts.load();
    if (name === 'history') History.load();
    if (name === 'create') Broadcast.loadTemplates();
    if (name === 'profile') Profile.load();
  }

  /** Tampilkan siapa yang sedang masuk, beserta tombol keluar. */
  function renderWho() {
    const box = document.getElementById('who');
    if (!box) return;
    if (Auth.disabled()) {
      box.hidden = true; // tidak ada login → tidak ada identitas untuk ditampilkan
      return;
    }
    const p = Auth.profile();
    const nama = box.querySelector('.who-name');
    nama.textContent = (p && (p.displayName || p.email)) || 'Pengguna';
    nama.title = (p && p.email) || 'Lihat profil';
    box.hidden = false;
  }

  async function init() {
    // Gerbang login DULU. Tanpa ini, polling sesi dan render tab langsung
    // menembakkan request tanpa token dan seluruh layar dipenuhi toast 401
    // sebelum pengguna sempat melihat form masuknya.
    await Session.gate();
    renderWho();
    Connection.start(); // poll status setiap 2.5 detik (render hanya saat tab aktif)
    Router.init();      // URL routing: back/forward, deep-link, klik menu
  }

  return { showTab, init, renderWho };
})();

document.addEventListener('DOMContentLoaded', App.init);
window.App = App;
