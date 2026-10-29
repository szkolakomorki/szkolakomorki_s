// Delegacja zdarzeń zamiast inline onclick/onchange/onsubmit/onerror (wymóg CSP bez 'unsafe-inline').
//
// W HTML:  <button data-click="nazwaAkcji" data-id="123">…</button>
//          <select data-change="nazwaAkcji">…</select>
//          <form data-submit="nazwaAkcji">…</form>
//          <img data-error-remove=".klasa-rodzica">   (usuwa rodzica, gdy obrazek się nie wczyta)
// W JS:    registerActions({ nazwaAkcji: (el, event) => { … el.dataset.id … } });
//
// Wywoływane są wyłącznie akcje zarejestrowane jawnie — nazwa z atrybutu nie trafia do window[...].
(function () {
  const registry = Object.create(null);

  window.registerActions = function (map) {
    Object.assign(registry, map);
  };

  function dispatch(attr, e) {
    const el = e.target.closest ? e.target.closest(`[${attr}]`) : null;
    if (!el || el.disabled) return;
    const fn = registry[el.getAttribute(attr)];
    if (typeof fn === 'function') fn(el, e);
  }

  document.addEventListener('click',  (e) => dispatch('data-click', e));
  document.addEventListener('change', (e) => dispatch('data-change', e));
  document.addEventListener('submit', (e) => dispatch('data-submit', e));

  // 'error' na <img> nie bąbelkuje — nasłuch w fazie przechwytywania
  function removeOnError(img) {
    const sel = img.dataset.errorRemove;
    const target = sel && img.closest(sel);
    if (target) target.remove();
  }
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG' && e.target.dataset.errorRemove) removeOnError(e.target);
  }, true);

  // Obrazki, które zdążyły się nie wczytać, zanim ten skrypt się załadował
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('img[data-error-remove]').forEach((img) => {
      if (img.complete && img.naturalWidth === 0) removeOnError(img);
    });
  });
})();
