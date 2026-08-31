'use strict';

/**
 * Router berbasis History API (path bersih): setiap menu punya URL sendiri
 * (/sessions, /create, /templates, /history) supaya back/forward browser dan
 * deep-link berfungsi. Server statis memakai SPA fallback (server.js) — path
 * tanpa ekstensi file selalu disajikan index.html; tab yang aktif ditentukan
 * di sini dari URL. Detail broadcast punya halaman sendiri di /history/:id.
 */
const Router = (() => {
  // Path → tab (tab = id section `tab-<tab>` di index.html)
  const ROUTES = [
    { path: '/', tab: 'connection' },
    { path: '/sessions', tab: 'connection' },
    { path: '/create', tab: 'create' },
    { path: '/templates', tab: 'templates' },
    { path: '/contacts', tab: 'contacts' },
    { path: '/history', tab: 'history' },
  ];

  // Halaman detail broadcast: /history/:id (angka id broadcast)
  const DETAIL_RE = /^\/history\/(\d+)$/;

  // Halaman detail kontak: /contacts/:id. Id kontak adalah UUID, bukan angka —
  // polanya dibatasi ketat supaya path lain di bawah /contacts (kalau nanti ada,
  // mis. /contacts/import) tidak salah ditangkap sebagai id.
  const CONTACT_RE = /^\/contacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

  function tabFromPath(pathname) {
    const route = ROUTES.find((r) => r.path === pathname);
    return route ? route.tab : null;
  }

  /** Path kanonik sebuah tab (tab connection → /sessions, bukan "/"). */
  function pathFromTab(tab) {
    const route = ROUTES.find((r) => r.tab === tab && r.path !== '/');
    return route ? route.path : '/sessions';
  }

  /** Pindah tab tanpa reload: update URL (pushState) lalu render konten. */
  function navigate(tab) {
    const path = pathFromTab(tab);
    if (window.location.pathname !== path) {
      window.history.pushState({ tab }, '', path);
    }
    App.showTab(tab);
  }

  /** Buka halaman detail kontak: pushState ke /contacts/:id lalu render detail. */
  function goContact(id) {
    const path = `/contacts/${id}`;
    if (window.location.pathname !== path) {
      window.history.pushState({ contactId: id }, '', path);
    }
    Contacts.renderDetailPage(id);
  }

  /** Buka halaman detail broadcast: pushState ke /history/:id lalu render detail. */
  function goDetail(id) {
    const path = `/history/${id}`;
    if (window.location.pathname !== path) {
      window.history.pushState({ detailId: id }, '', path);
    }
    History.renderDetailPage(id);
  }

  /** Back/forward browser → render tab/halaman sesuai URL saat ini. */
  function renderFromLocation() {
    const path = window.location.pathname;
    const detailMatch = path.match(DETAIL_RE);
    if (detailMatch) {
      // Halaman detail broadcast → tab history aktif + render detail.
      App.showTab('history');
      History.renderDetailPage(Number(detailMatch[1]));
      return;
    }
    const contactMatch = path.match(CONTACT_RE);
    if (contactMatch) {
      // Halaman detail kontak → tab kontak aktif + render detail.
      App.showTab('contacts');
      Contacts.renderDetailPage(contactMatch[1]);
      return;
    }
    let tab = tabFromPath(path);
    if (!tab) {
      // path tak dikenal → fallback halaman default (tanpa menambah history)
      window.history.replaceState({ tab: 'connection' }, '', '/sessions');
      tab = 'connection';
    } else if (path === '/') {
      // kanonik: "/" disamakan ke /sessions
      window.history.replaceState({ tab: 'connection' }, '', '/sessions');
      tab = 'connection';
    }
    App.showTab(tab);
  }

  function init() {
    window.addEventListener('popstate', renderFromLocation);

    // Klik menu → pushState (bukan full reload). cmd/ctrl/shift+klik tetap
    // buka tab baru di browser (default anchor dibiarkan berjalan).
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a.tab-btn');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const tab = tabFromPath(a.getAttribute('href'));
      if (tab) {
        e.preventDefault();
        navigate(tab);
      }
    });

    renderFromLocation(); // deep-link / refresh di path non-root
  }

  return { init, navigate, tabFromPath, goDetail, goContact };
})();

window.Router = Router;
