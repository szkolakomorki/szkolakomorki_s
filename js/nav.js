// Rozwijane menu w pasku górnym (widoczne na wąskich ekranach, patrz css/style.css → .nav-toggle).
// Samodzielny plik (bez actions.js), bo ładuje się także na stronach statycznych i prawnych.
(function () {
  function init() {
    document.querySelectorAll('.nav').forEach(function (nav) {
      var btn = nav.querySelector('.nav-toggle');
      if (!btn) return;

      function setOpen(open) {
        nav.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Zamknij menu' : 'Otwórz menu');
      }

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(!nav.classList.contains('open'));
      });
      // Klik poza paskiem i Escape zamykają menu
      document.addEventListener('click', function (e) { if (!nav.contains(e.target)) setOpen(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
      // Po powrocie do szerokiego ekranu (np. obrót telefonu) wyczyść stan
      window.matchMedia('(min-width: 761px)').addEventListener('change', function (m) { if (m.matches) setOpen(false); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
