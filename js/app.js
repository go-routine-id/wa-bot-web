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
  }

  function init() {
    Connection.start(); // poll status setiap 2.5 detik (render hanya saat tab aktif)
    Router.init();      // URL routing: back/forward, deep-link, klik menu
  }

  return { showTab, init };
})();

document.addEventListener('DOMContentLoaded', App.init);
window.App = App;
