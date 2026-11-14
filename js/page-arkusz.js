// Landing „Darmowy arkusz” (arkusz.html) — zapis na newsletter przez MailerLite.
// Bez zależności; zgodne z CSP (brak inline-skryptów).
//
// KONFIGURACJA (po założeniu formularza w MailerLite):
//   MailerLite → Formularze → Embedded form → „Kod HTML” — w kodzie znajdziesz adres w stylu
//   https://assets.mailerlite.com/jsonp/ACCOUNT_ID/forms/FORM_ID/subscribe
//   Wpisz ACCOUNT_ID i FORM_ID poniżej. Dopóki są puste, strona działa w trybie podglądu
//   (symuluje sukces, nic nie wysyła) — wygodne do oglądania designu.

(function () {
  var ML_ACCOUNT_ID = '2579721';
  var ML_FORM_ID    = '204128509779511215';

  var CONFIGURED = !!(ML_ACCOUNT_ID && ML_FORM_ID);
  var ENDPOINT = 'https://assets.mailerlite.com/jsonp/' + ML_ACCOUNT_ID + '/forms/' + ML_FORM_ID + '/subscribe';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function showError(form, text) {
    var box = form.querySelector('.ar-msg');
    box.textContent = text;
    box.className = 'ar-msg error';
  }
  function clearError(form) {
    var box = form.querySelector('.ar-msg');
    box.textContent = '';
    box.className = 'ar-msg';
  }

  // Po zapisie przechodzimy na stronę „dziękujemy”. E-mail przekazujemy przez sessionStorage (nie w adresie URL).
  function goToThanks(email) {
    try {
      sessionStorage.setItem('ar_email', email);
      sessionStorage.setItem('ar_lead_pending', '1');
    } catch (_) {}
    window.location.href = 'arkusz-pobierz.html';
  }

  function subscribe(email) {
    if (!CONFIGURED) {
      console.warn('[arkusz] Tryb podglądu: uzupełnij ML_ACCOUNT_ID i ML_FORM_ID w js/page-arkusz.js, aby zapisy trafiały do MailerLite.');
      return new Promise(function (resolve) { setTimeout(function () { resolve({ success: true }); }, 600); });
    }
    var body = new FormData();
    body.append('fields[email]', email);
    body.append('ml-submit', '1');
    body.append('anticsrf', 'true');
    return fetch(ENDPOINT, { method: 'POST', body: body })
      .then(function (r) { return r.json(); });
  }

  function onSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var card = form.closest('.ar-form-card');
    var email = form.elements.email.value.trim();
    clearError(form);

    if (!EMAIL_RE.test(email)) {
      showError(form, 'Wpisz poprawny adres e-mail.');
      form.elements.email.focus();
      return;
    }
    if (!form.elements.consent.checked) {
      showError(form, 'Zaznacz zgodę na newsletter - bez niej nie możemy wysłać arkusza.');
      return;
    }
    // Pułapka na boty: człowiek nie widzi tego pola
    if (form.elements.website.value) { goToThanks(email); return; }

    card.classList.add('is-busy');
    subscribe(email).then(function (res) {
      if (res && res.success) {
        goToThanks(email);
        return;
      }
      card.classList.remove('is-busy');
      var msg = res && res.errors && res.errors.fields && res.errors.fields.email;
      showError(form, (Array.isArray(msg) ? msg[0] : '') || 'Nie udało się zapisać. Sprawdź adres e-mail i spróbuj ponownie.');
    }).catch(function () {
      card.classList.remove('is-busy');
      showError(form, 'Błąd połączenia (może blokuje go dodatek do przeglądarki). Spróbuj ponownie albo napisz: kontakt@szkolakomorki.pl.');
    });
  }

  document.querySelectorAll('.sheet-form').forEach(function (f) { f.addEventListener('submit', onSubmit); });

  // Przyciski „do formularza” — płynne przewinięcie + fokus na polu e-mail
  document.querySelectorAll('[data-scroll-form]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var target = document.getElementById('zapis');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var input = target.querySelector('input[type=email]');
      if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, 500);
    });
  });

  // Sticky CTA na telefonie: widoczny, gdy żaden formularz nie jest na ekranie
  var sticky = document.getElementById('sticky-cta');
  var cards = document.querySelectorAll('.ar-form-card');
  if (sticky && 'IntersectionObserver' in window) {
    var visible = new Set();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.isIntersecting ? visible.add(en.target) : visible.delete(en.target); });
      sticky.classList.toggle('show', visible.size === 0 && window.scrollY > 300);
    });
    cards.forEach(function (c) { io.observe(c); });
    window.addEventListener('scroll', function () {
      sticky.classList.toggle('show', visible.size === 0 && window.scrollY > 300);
    }, { passive: true });
  }

  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
