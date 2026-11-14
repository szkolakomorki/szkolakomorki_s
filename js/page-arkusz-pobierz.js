// Strona „pobierz” (arkusz-pobierz.html) — otwierana po kliknięciu „Potwierdzam zapis” w mailu z MailerLite.
(function () {
  // Zdarzenie Lead dopiero po potwierdzeniu e-maila = zweryfikowany lead (lepszy sygnał dla reklam niż samo wypełnienie formularza).
  // fbq/gtag pojawiają się dopiero po zgodzie w banerze cookies, więc chwilę czekamy.
  var tries = 0, fired = { fb: false, ga: false };
  (function fire() {
    if (!fired.fb && window.fbq) { try { window.fbq('track', 'Lead'); fired.fb = true; } catch (_) {} }
    if (!fired.ga && window.gtag) { try { window.gtag('event', 'sign_up_confirmed'); fired.ga = true; } catch (_) {} }
    if (++tries < 10 && !(fired.fb && fired.ga)) setTimeout(fire, 800);
  })();

  var dl = document.getElementById('dl-btn');
  if (dl) dl.addEventListener('click', function () {
    try { if (window.gtag) window.gtag('event', 'file_download', { file_name: 'darmowy-arkusz-biologia' }); } catch (_) {}
  });

  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
