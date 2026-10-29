// Logika strony podręcznika: kafelki z zagadnieniami, filtrowanie po działach,
// leniwe wczytywanie treści (płatnej) i głębokie linkowanie do zagadnienia.
// Wymaga: config.js, auth.js, DOMPurify, Supabase CDN

const stateP = {
  dzialy: [],
};

const expandedKatsPodr = new Set();
const podrContentCache = new Map(); // id -> tresc (string) | null

// ── Supabase query ──────────────────────────────────────────
async function fetchPodrList() {
  let query = _supabase
    .from('podrecznik_z_dostepem')
    .select('id, tytul, dzialy')
    .order('tytul', { ascending: true });

  if (stateP.dzialy.length) {
    query = query.overlaps('dzialy', expandKatIds(stateP.dzialy));
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ── Render helpers ──────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDzialTags(dzialy) {
  if (!dzialy || !dzialy.length) return '';
  return `<div class="dzial-tags">${dzialy.map(d => `<span class="dzial-tag">${escHtml(getLabelForId(d))}</span>`).join('')}</div>`;
}

function renderTile(p) {
  return `
    <article class="podr-tile" id="podr-${p.id}">
      <button type="button" class="podr-tile-header" aria-expanded="false">
        <span class="podr-tile-heading">
          <span class="podr-tile-title">${escHtml(p.tytul)}</span>
          ${renderDzialTags(p.dzialy)}
        </span>
        <svg class="podr-tile-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="podr-tile-body">
        <div class="podr-tile-content" id="podr-content-${p.id}"></div>
      </div>
    </article>`;
}

function renderLockedContent() {
  const blurText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.';
  return `
    <div class="opracowanie-locked">
      <div class="opracowanie-blur-text">${blurText}</div>
      <div class="opracowanie-overlay">
        <div class="opracowanie-overlay-icon">🔒</div>
        <div class="opracowanie-overlay-text">Odblokuj treść podręcznika</div>
        <div class="opracowanie-overlay-sub">Dostępne w ramach tej samej subskrypcji co opracowania zadań</div>
        <a href="subscription.html" class="btn btn-clay btn-sm mt-8">Odblokuj dostęp</a>
      </div>
    </div>`;
}

function renderTileContent(id, tresc) {
  const el = document.getElementById(`podr-content-${id}`);
  if (!el) return;
  el.innerHTML = tresc
    ? `<div class="podr-tile-rich rich-content">${safeHtml(tresc)}</div>`
    : renderLockedContent();
}

async function loadTileContent(id) {
  const el = document.getElementById(`podr-content-${id}`);
  if (el) el.innerHTML = '<div class="state-loading"><div class="spinner"></div></div>';

  try {
    const { data, error } = await _supabase
      .from('podrecznik_z_dostepem')
      .select('tresc')
      .eq('id', id)
      .single();
    if (error) throw error;
    podrContentCache.set(id, data.tresc || null);
    renderTileContent(id, data.tresc);
  } catch (err) {
    console.error(err);
    if (el) el.innerHTML = '<p style="color:#8b2020;font-size:13px">Błąd ładowania treści. Spróbuj odświeżyć stronę.</p>';
  }
}

async function togglePodrTile(id, forceOpen) {
  const tile = document.getElementById(`podr-${id}`);
  if (!tile) return;
  const header = tile.querySelector('.podr-tile-header');
  const isOpen = tile.classList.contains('expanded');

  if (isOpen && !forceOpen) {
    tile.classList.remove('expanded');
    if (header) header.setAttribute('aria-expanded', 'false');
    return;
  }

  tile.classList.add('expanded');
  if (header) header.setAttribute('aria-expanded', 'true');

  if (!podrContentCache.has(id)) {
    await loadTileContent(id);
  }
}

// Delegacja zdarzeń: jeden listener na kontener, przetrwa każde przeładowanie
// listy (loadPodrList wymienia innerHTML), więc nie trzeba go doczepiać ponownie.
function handlePodrListClick(e) {
  const header = e.target.closest('.podr-tile-header');
  if (!header) return;
  const tile = header.closest('.podr-tile');
  if (!tile) return;
  togglePodrTile(tile.id.replace(/^podr-/, ''));
}

// ── Render list ─────────────────────────────────────────────
function renderCountPodr(count) {
  const el = document.getElementById('results-count-podr');
  if (el) el.innerHTML = `Znaleziono <strong>${count}</strong> zagadnień`;
}

async function loadPodrList() {
  const el = document.getElementById('podrecznik-list');
  el.innerHTML = '<div class="state-loading"><div class="spinner"></div><p>Ładowanie podręcznika…</p></div>';

  try {
    const items = await fetchPodrList();
    if (!items.length) {
      el.innerHTML = `
        <div class="state-empty">
          <span class="state-empty-icon">📖</span>
          <h3>Brak zagadnień dla wybranych działów</h3>
          <p>Spróbuj zmienić lub wyczyścić filtry.</p>
        </div>`;
      renderCountPodr(0);
      return;
    }
    el.innerHTML = items.map(renderTile).join('');
    renderCountPodr(items.length);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="state-error"><p>Błąd ładowania podręcznika. Spróbuj odświeżyć stronę.</p></div>`;
  }
}

// ── Filters UI (tylko działy biologii) ───────────────────────
function buildFiltersUIPodr() {
  const el = document.getElementById('filter-dzialy-podr');
  if (!el) return;

  el.innerHTML = KATEGORIE.map(kat => {
    const hasSub     = kat.sub.length > 0;
    const isExpanded = expandedKatsPodr.has(kat.id);
    const isMainSel  = stateP.dzialy.includes(kat.id);
    const hasSubSel  = hasSub && kat.sub.some(s => stateP.dzialy.includes(s.id));
    const isActive   = isMainSel || hasSubSel;

    const toggleBtn = hasSub
      ? `<button class="kat-toggle-btn" data-click="toggleKatExpandPodr" data-id="${escHtml(kat.id)}">${isExpanded ? '−' : '+'}</button>`
      : `<span class="kat-toggle-placeholder"></span>`;

    const subsHtml = hasSub ? `
      <div class="kat-subs${isExpanded ? '' : ' hidden'}">
        ${kat.sub.map(s => {
          const isSel = stateP.dzialy.includes(s.id);
          return `<span class="kat-sub-label${isSel ? ' active' : ''}" data-click="toggleDzialPodr" data-id="${escHtml(s.id)}">${escHtml(s.label)}</span>`;
        }).join('')}
      </div>` : '';

    return `<div class="kat-item">
      <div class="kat-item-row">
        ${toggleBtn}
        <span class="kat-label${isActive ? ' active' : ''}" data-click="toggleDzialPodr" data-id="${escHtml(kat.id)}">${escHtml(kat.label)}</span>
      </div>${subsHtml}</div>`;
  }).join('');
}

function toggleKatExpandPodr(id) {
  if (expandedKatsPodr.has(id)) expandedKatsPodr.delete(id);
  else                           expandedKatsPodr.add(id);
  buildFiltersUIPodr();
}

function toggleDzialPodr(id) {
  const idx = stateP.dzialy.indexOf(id);
  if (idx === -1) {
    stateP.dzialy.push(id);
    const parent = KATEGORIE.find(k => k.sub.some(s => s.id === id));
    if (parent) expandedKatsPodr.add(parent.id);
    const kat = KATEGORIE.find(k => k.id === id);
    if (kat && kat.sub.length > 0) expandedKatsPodr.add(id);
  } else {
    stateP.dzialy.splice(idx, 1);
  }
  buildFiltersUIPodr();
  updateActiveFiltersChipsPodr();
  loadPodrList();
}

function clearFiltersPodr() {
  stateP.dzialy = [];
  buildFiltersUIPodr();
  updateActiveFiltersChipsPodr();
  loadPodrList();
}

function updateActiveFiltersChipsPodr() {
  const el = document.getElementById('active-filters-podr');
  if (!el) return;

  const chips = stateP.dzialy.map(id =>
    `<span class="active-filter-chip">${escHtml(getLabelForId(id))}<button data-click="toggleDzialPodr" data-id="${escHtml(id)}">×</button></span>`
  );

  if (chips.length) {
    el.innerHTML = `<div class="active-filters-label">Aktywne filtry:</div>${chips.join('')}`;
    el.style.display = 'block';
  } else {
    el.innerHTML = '';
    el.style.display = 'none';
  }
}

function toggleMobileFiltersPodr() {
  const panel = document.getElementById('filters-panel-podr');
  if (panel) panel.classList.toggle('open');
}

// ── Deep link: podrecznik.html?z=<id> ────────────────────────
async function handleDeepLinkPodr() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('z');
  if (!id) return;

  const tile = document.getElementById(`podr-${id}`);
  if (!tile) return; // np. odfiltrowane albo usunięte zagadnienie

  await togglePodrTile(id, true);
  tile.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Init ─────────────────────────────────────────────────────
async function initPodrecznikPage() {
  await updateNavAuth();

  const listEl = document.getElementById('podrecznik-list');
  if (listEl) listEl.addEventListener('click', handlePodrListClick);

  buildFiltersUIPodr();
  updateActiveFiltersChipsPodr();
  await loadPodrList();
  await handleDeepLinkPodr();
}

// ── Akcje (data-click w HTML, patrz actions.js) ──
registerActions({
  toggleKatExpandPodr:    (el) => { if (KATEGORIE_MAP[el.dataset.id]) toggleKatExpandPodr(el.dataset.id); },
  toggleDzialPodr:        (el) => { if (KATEGORIE_MAP[el.dataset.id]) toggleDzialPodr(el.dataset.id); },
  clearFiltersPodr:       () => clearFiltersPodr(),
  toggleMobileFiltersPodr: () => toggleMobileFiltersPodr(),
});
