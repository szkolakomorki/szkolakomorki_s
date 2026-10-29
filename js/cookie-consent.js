/* Szkoła Komórki — zgoda na cookies + ładowanie narzędzi analitycznych/marketingowych.
 *
 * Jeden plik dla wszystkich podstron. Do czasu zgody NIE jest ładowany żaden skrypt
 * Google / Meta / Microsoft. Wybór użytkownika zapisuje się w localStorage (współdzielony
 * przez wszystkie podstrony tego samego origin), więc baner nie pojawia się ponownie
 * przy zmianie podstrony ani przy powrocie na stronę (do 12 miesięcy).
 *
 * Kategorie (osobne zgody, domyślnie wyłączone):
 *   - analytics: Google Analytics 4, Microsoft Clarity
 *   - marketing: Meta Pixel
 */
(function () {
  'use strict';

  var GA_ID = 'G-4M0LFNG3B5';
  var META_PIXEL_ID = '1835413614484793';
  var CLARITY_ID = 'y4p5cse0q1';

  var CONSENT_KEY = 'sk_cookie_consent';
  var CONSENT_VERSION = 3;                       // podbij, aby wymusić ponowne zapytanie
  var CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 12 miesięcy (zgodnie z polityką prywatności)

  // Ścieżka do polityki liczona względem tego skryptu (działa też z podkatalogu /zadanie/)
  var POLICY_URL = 'polityka-prywatnosci.html#cookies';
  try {
    var cs = document.currentScript;
    if (cs && cs.src) POLICY_URL = new URL('../polityka-prywatnosci.html#cookies', cs.src).href;
  } catch (e) {}

  /* ───────── Zgoda: odczyt / zapis ───────── */

  function getConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.version !== CONSENT_VERSION) return null;
      if (Date.now() - new Date(d.timestamp).getTime() > CONSENT_MAX_AGE_MS) return null;
      return d;
    } catch (e) { return null; }
  }

  function saveConsent(analytics, marketing) {
    var d = {
      necessary: true,
      analytics: !!analytics,
      marketing: !!marketing,
      timestamp: new Date().toISOString(),
      version: CONSENT_VERSION
    };
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(d)); } catch (e) {}
    return d;
  }

  /* ───────── Narzędzia (ładowane dopiero po zgodzie) ───────── */

  function loadGoogleAnalytics() {
    if (window.__gaLoaded) return;
    window.__gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    // Consent Mode v2 — ładujemy dopiero po zgodzie, więc analityka jest granted,
    // a reklamowe sygnały Google pozostają wyłączone.
    gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function loadClarity() {
    if (window.__clarityLoaded) return;
    window.__clarityLoaded = true;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
    // Clarity Consent API v2 — informujemy narzędzie o udzielonej zgodzie
    window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
  }

  function loadMetaPixel() {
    if (window.__metaPixelLoaded) return;
    window.__metaPixelLoaded = true;
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', META_PIXEL_ID);
    fbq('track', 'PageView');
  }

  function applyConsent(c) {
    if (!c) return;
    if (c.analytics) { loadGoogleAnalytics(); loadClarity(); }
    if (c.marketing) { loadMetaPixel(); }
  }

  /* ───────── Cofnięcie zgody: usunięcie cookies i przeładowanie ───────── */

  function deleteCookie(name) {
    var host = location.hostname;
    var parts = host.split('.');
    var domains = [undefined, host, '.' + host];
    for (var i = 1; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
    domains.forEach(function (d) {
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
        (d ? '; domain=' + d : '');
    });
  }

  function purgeCookies(prev, next) {
    var names = (document.cookie || '').split(';').map(function (x) { return x.split('=')[0].trim(); });
    names.forEach(function (n) {
      var analyticsCookie = /^(_ga|_gid|_gat|_gcl|_clck|_clsk|CLID|ANONCHK|MR|MUID|SM|SRM_B)/.test(n);
      var marketingCookie = /^(_fbp|_fbc|fr)$/.test(n);
      if ((prev.analytics && !next.analytics && analyticsCookie) ||
          (prev.marketing && !next.marketing && marketingCookie)) deleteCookie(n);
    });
  }

  /* ───────── Baner (CSS + HTML wstrzykiwane przez skrypt) ───────── */

  var CSS = '' +
    '#cookie-banner{display:none;position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#16261A;color:#FAF5EA;' +
    'padding:18px 20px;box-shadow:0 -8px 32px rgba(0,0,0,.35);font-family:"Inter",system-ui,sans-serif;font-size:14px;line-height:1.5;' +
    'max-height:100vh;overflow-y:auto;box-sizing:border-box}' +
    '#cookie-banner *{box-sizing:border-box}' +
    '#cookie-banner.visible{display:block}' +
    '#cookie-banner .cookie-inner{max-width:1180px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}' +
    '#cookie-banner .cookie-text{flex:1;min-width:240px}' +
    '#cookie-banner .cookie-text a{color:#C9A876;text-decoration:underline}' +
    '#cookie-banner .cookie-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}' +
    '#cookie-banner .cookie-btn{display:inline-flex;align-items:center;justify-content:center;padding:11px 20px;border-radius:999px;' +
    'font-weight:600;font-size:14px;cursor:pointer;border:1.5px solid #FAF5EA;background:#FAF5EA;color:#16261A;font-family:inherit;transition:transform .2s,box-shadow .2s}' +
    '#cookie-banner .cookie-btn:hover{transform:translateY(-1px);box-shadow:0 8px 20px -10px rgba(250,245,234,.4)}' +
    '#cookie-banner .cookie-btn:focus-visible,#cookie-banner input:focus-visible{outline:2px solid #C9A876;outline-offset:2px}' +
    '#cookie-banner .cookie-btn-settings{background:transparent;color:#C9A876;border-color:transparent;padding:11px 12px;text-decoration:underline;font-weight:500}' +
    '#cookie-banner .cookie-btn-settings:hover{box-shadow:none}' +
    '#cookie-banner #cookie-settings-panel{display:none;width:100%;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12);flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:0}' +
    '#cookie-banner #cookie-settings-panel.open{display:flex}' +
    '#cookie-banner #cookie-settings-panel label{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;cursor:pointer;color:#FAF5EA}' +
    '#cookie-banner #cookie-settings-panel input[type=checkbox]{margin-top:3px;accent-color:#C9A876;width:16px;height:16px;flex:none}' +
    '#cookie-banner #cookie-settings-panel .cookie-cat-title{font-weight:600}' +
    '#cookie-banner #cookie-settings-panel .cookie-cat-desc{opacity:.75;font-size:13px;margin-top:2px;display:block}' +
    '@media (max-width:640px){#cookie-banner{padding:16px}#cookie-banner .cookie-inner{flex-direction:column;align-items:stretch}' +
    '#cookie-banner .cookie-actions{width:100%}#cookie-banner .cookie-btn{flex:1}' +
    '#cookie-banner .cookie-btn-settings{flex:none;width:100%}body.has-sticky-cta #cookie-banner{bottom:64px}}';

  var HTML = '' +
    '<div class="cookie-inner">' +
      '<div class="cookie-text" id="cookieDesc">' +
        'Używamy plików cookies i podobnych technologii. Niezbędne zapisują Twój wybór i działanie serwisu. ' +
        'Za Twoją zgodą używamy też cookies <strong>analitycznych</strong> (Google Analytics, Microsoft Clarity) ' +
        'oraz <strong>marketingowych</strong> (Meta Pixel). Zgoda jest dobrowolna, a jej brak nie ogranicza dostępu do serwisu. ' +
        'Wybór możesz w każdej chwili zmienić w stopce („Ustawienia cookies”). ' +
        'Szczegóły: <a href="' + POLICY_URL + '">Polityka prywatności i cookies</a>.' +
      '</div>' +
      '<div class="cookie-actions">' +
        '<button type="button" class="cookie-btn cookie-btn-settings" id="cookieSettingsBtn" aria-expanded="false" aria-controls="cookie-settings-panel">Ustawienia</button>' +
        '<button type="button" class="cookie-btn" id="cookieRejectBtn">Odrzucam niekonieczne</button>' +
        '<button type="button" class="cookie-btn" id="cookieAcceptBtn">Akceptuję wszystkie</button>' +
      '</div>' +
    '</div>' +
    '<div id="cookie-settings-panel" class="cookie-inner">' +
      '<label><input type="checkbox" checked disabled><span>' +
        '<span class="cookie-cat-title">Niezbędne</span>' +
        '<span class="cookie-cat-desc">Zapamiętanie wyboru cookies i działanie serwisu (np. sesja logowania). Zawsze aktywne.</span></span></label>' +
      '<label><input type="checkbox" id="cookieAnalyticsToggle"><span>' +
        '<span class="cookie-cat-title">Analityczne</span>' +
        '<span class="cookie-cat-desc">Google Analytics i Microsoft Clarity — statystyki odwiedzin oraz mapy cieplne i nagrania sesji (pola formularzy są maskowane).</span></span></label>' +
      '<label><input type="checkbox" id="cookieMarketingToggle"><span>' +
        '<span class="cookie-cat-title">Marketingowe</span>' +
        '<span class="cookie-cat-desc">Meta Pixel — pomiar skuteczności reklam i remarketing.</span></span></label>' +
      '<div class="cookie-actions" style="margin-top:4px">' +
        '<button type="button" class="cookie-btn" id="cookieSaveSettingsBtn">Zapisz wybór</button>' +
      '</div>' +
    '</div>';

  var banner;

  function buildBanner() {
    if (banner) return banner;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Zgoda na pliki cookies');
    banner.setAttribute('aria-describedby', 'cookieDesc');
    banner.innerHTML = HTML;
    document.body.appendChild(banner);

    if (document.querySelector('.sticky-cta')) document.body.classList.add('has-sticky-cta');

    var $ = function (id) { return document.getElementById(id); };

    $('cookieAcceptBtn').addEventListener('click', function () { commit(true, true); });
    $('cookieRejectBtn').addEventListener('click', function () { commit(false, false); });
    $('cookieSaveSettingsBtn').addEventListener('click', function () {
      commit($('cookieAnalyticsToggle').checked, $('cookieMarketingToggle').checked);
    });
    $('cookieSettingsBtn').addEventListener('click', function () {
      var open = $('cookie-settings-panel').classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    return banner;
  }

  function showBanner(openSettings) {
    buildBanner();
    var c = getConsent();
    document.getElementById('cookieAnalyticsToggle').checked = !!(c && c.analytics);
    document.getElementById('cookieMarketingToggle').checked = !!(c && c.marketing);
    var panel = document.getElementById('cookie-settings-panel');
    panel.classList.toggle('open', !!openSettings);
    document.getElementById('cookieSettingsBtn').setAttribute('aria-expanded', openSettings ? 'true' : 'false');
    banner.classList.add('visible');
    if (openSettings) document.getElementById('cookieAnalyticsToggle').focus();
  }

  function hideBanner() {
    if (banner) banner.classList.remove('visible');
  }

  function commit(analytics, marketing) {
    var prev = getConsent() || { analytics: false, marketing: false };
    var next = saveConsent(analytics, marketing);
    hideBanner();
    var withdrawn = (prev.analytics && !next.analytics) || (prev.marketing && !next.marketing);
    if (withdrawn) {
      // Skryptów już załadowanych nie da się „wyładować” — usuwamy cookies i odświeżamy stronę.
      purgeCookies(prev, next);
      location.reload();
      return;
    }
    applyConsent(next);
  }

  /* ───────── Start ───────── */

  function init() {
    var existing = getConsent();
    if (existing) applyConsent(existing); else showBanner(false);

    // Link „Ustawienia cookies” (stopka) — dostępny na każdej podstronie
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-cookie-settings]');
      if (!t) return;
      e.preventDefault();
      showBanner(true);
    });
  }

  window.openCookieSettings = function () { showBanner(true); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
