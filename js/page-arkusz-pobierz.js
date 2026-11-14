// Strona „dziękujemy” (arkusz-pobierz.html) — otwierana od razu po zapisie na landingu.
(function () {
  var email = null, pending = false;
  try {
    email = sessionStorage.getItem('ar_email');
    pending = sessionStorage.getItem('ar_lead_pending') === '1';
  } catch (_) {}

  // Pokaż adres, na który poszedł mail (textContent — bez ryzyka wstrzyknięcia HTML)
  var sent = document.getElementById('dl-sent');
  if (sent && email) {
    sent.textContent = '';
    sent.appendChild(document.createTextNode('Wysłaliśmy go na adres '));
    var strong = document.createElement('strong');
    strong.textContent = email;
    sent.appendChild(strong);
    sent.appendChild(document.createTextNode('. Otwórz wiadomość od Szkoły Komórki i kliknij w niej przycisk pobierania.'));
  }

  // Zdarzenie Lead tylko raz, tuż po zapisie (nie przy odświeżeniu ani wejściu bezpośrednim).
  // fbq/gtag pojawiają się dopiero po zgodzie w banerze cookies, więc chwilę czekamy.
  if (pending) {
    try { sessionStorage.removeItem('ar_lead_pending'); } catch (_) {}
    var tries = 0, fired = { fb: false, ga: false };
    (function fire() {
      if (!fired.fb && window.fbq) { try { window.fbq('track', 'Lead'); fired.fb = true; } catch (_) {} }
      if (!fired.ga && window.gtag) { try { window.gtag('event', 'generate_lead'); fired.ga = true; } catch (_) {} }
      if (++tries < 10 && !(fired.fb && fired.ga)) setTimeout(fire, 800);
    })();
  }

  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
