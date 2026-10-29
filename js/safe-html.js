// Wspólna sanityzacja HTML z bazy (treści zadań, opracowania, podręcznik, demo na landingu).
// Wymaga: config.js (CONFIG.supabase.url), DOMPurify (js/vendor/purify-*.min.js)
//
// Co jest egzekwowane niezależnie od tego, co zapisano w bazie (np. po przejęciu konta admina):
//  - tylko wymienione tagi i atrybuty, bez dowolnych data-*,
//  - <img src> wyłącznie z Supabase Storage tego projektu, z hostów z IMG_HOSTS (patrz też CSP: img-src)
//    oraz data:image/(png|jpeg|webp|gif);base64,
//  - <a href> wyłącznie http(s) i mailto:, zawsze w nowej karcie,
//  - style tylko z allowlisty właściwości i prostych wartości (bez url(), position itp.).

(function () {
  const ALLOWED_TAGS = [
    'p','br','strong','em','u','s','ul','ol','li','h2','h3','img','span','div','a',
    'table','colgroup','col','thead','tbody','tfoot','tr','td','th',
  ];
  const ALLOWED_ATTR = ['src','alt','width','height','class','style','colspan','rowspan','data-rows','href','target','rel'];

  // Dodatkowe hosty obrazków poza Supabase Storage (muszą być też w CSP img-src)
  const IMG_HOSTS = ['https://maturabiolchem.pl'];

  const STYLE_PROPS = new Set([
    'color','background-color','text-align','vertical-align',
    'font-weight','font-style','text-decoration','width','height',
  ]);
  const STYLE_VALUE_OK  = /^[#a-z0-9(),.%\s-]+$/i;
  const STYLE_VALUE_BAD = /url\s*\(|expression|var\s*\(|image\s*\(|attr\s*\(/i;

  // Obrazki wklejone do edytora jako base64 (bez SVG)
  const DATA_IMG_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

  function isAllowedImageUrl(raw) {
    if (DATA_IMG_RE.test(String(raw).trim())) return true;
    try {
      const u = new URL(raw, window.location.href);
      if (u.protocol !== 'https:') return false;
      const supa = new URL(CONFIG.supabase.url);
      if (u.origin === supa.origin && u.pathname.startsWith('/storage/v1/object/')) return true;
      return IMG_HOSTS.includes(u.origin);
    } catch (_) {
      return false;
    }
  }

  function isAllowedLinkUrl(raw) {
    try {
      const u = new URL(raw, window.location.href);
      return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
    } catch (_) {
      return false;
    }
  }

  function filterStyle(css) {
    const kept = [];
    css.split(';').forEach((decl) => {
      const i = decl.indexOf(':');
      if (i < 1) return;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const val  = decl.slice(i + 1).trim();
      if (STYLE_PROPS.has(prop) && STYLE_VALUE_OK.test(val) && !STYLE_VALUE_BAD.test(val)) {
        kept.push(`${prop}: ${val}`);
      }
    });
    return kept.join('; ');
  }

  if (typeof DOMPurify !== 'undefined') {
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName === 'src' && node.tagName === 'IMG' && !isAllowedImageUrl(data.attrValue)) {
        data.keepAttr = false;
      }
      if (data.attrName === 'href' && !isAllowedLinkUrl(data.attrValue)) {
        data.keepAttr = false;
      }
    });

    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      // Każdy link w treści ma się otwierać w nowej karcie
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.hasAttribute && node.hasAttribute('style')) {
        const css = filterStyle(node.getAttribute('style'));
        if (css) node.setAttribute('style', css);
        else node.removeAttribute('style');
      }
    });
  }

  window.safeHtml = function safeHtml(html) {
    if (!html) return '';
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
    }
    // Bez DOMPurify nie renderujemy HTML w ogóle
    return String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
})();
