// Logika listy zadań: filtrowanie, paginacja, renderowanie
// Wymaga: config.js, auth.js (i Supabase CDN)

// ── Stan aplikacji ──────────────────────────────────────────
const state = {
  filtry: {
    dzialy:    [],
    rok:       '',
    typ:       '',
    kategoria: '',
    formula:   '',
    poziom:    '',
  },
  strona:    1,
  totalCount: 0,
  hasSubscription: false,
};

// ── URL params sync ─────────────────────────────────────────
// Wartości z URL są niezaufane — każda przechodzi przez allowlistę.
function allowedKey(val, labels) {
  return Object.prototype.hasOwnProperty.call(labels, val) ? val : '';
}

function stateFromURL() {
  const p = new URLSearchParams(window.location.search);

  const raw = p.get('dzialy') ? p.get('dzialy').split(',') : [];
  state.filtry.dzialy = [...new Set(raw.filter(id => Object.prototype.hasOwnProperty.call(KATEGORIE_MAP, id)))];

  const rok = p.get('rok') || '';
  const rokNum = /^\d{4}$/.test(rok) ? parseInt(rok, 10) : 0;
  state.filtry.rok = (rokNum >= 2000 && rokNum <= new Date().getFullYear()) ? String(rokNum) : '';

  const typ = p.get('typ');
  state.filtry.typ       = (typ === 'zamkniete' || typ === 'otwarte') ? typ : '';
  state.filtry.kategoria = allowedKey(p.get('kategoria') || '', KATEGORIA_LABELS);
  state.filtry.formula   = allowedKey(p.get('formula')   || '', FORMULA_LABELS);
  state.filtry.poziom    = allowedKey(p.get('poziom')    || '', POZIOM_LABELS);

  const strona = /^\d{1,4}$/.test(p.get('strona') || '') ? parseInt(p.get('strona'), 10) : 1;
  state.strona = strona >= 1 ? strona : 1;
}

function stateToURL() {
  const p = new URLSearchParams();
  if (state.filtry.dzialy.length) p.set('dzialy',    state.filtry.dzialy.join(','));
  if (state.filtry.rok)           p.set('rok',       state.filtry.rok);
  if (state.filtry.typ)           p.set('typ',       state.filtry.typ);
  if (state.filtry.kategoria)     p.set('kategoria', state.filtry.kategoria);
  if (state.filtry.formula)       p.set('formula',   state.filtry.formula);
  if (state.filtry.poziom)        p.set('poziom',    state.filtry.poziom);
  if (state.strona > 1)           p.set('strona',    state.strona);

  const qs = p.toString();
  const newURL = window.location.pathname + (qs ? '?' + qs : '');
  history.pushState(null, '', newURL);
}

// ── Supabase query ──────────────────────────────────────────
async function fetchZadania() {
  const pageSize = CONFIG.app.pageSize;
  const from = (state.strona - 1) * pageSize;
  const to   = from + pageSize - 1;

  let query = _supabase
    .from('zadania_z_dostepem')
    .select('id, rok, numer_zadania, tresc_zadania, klucz_cke, dzialy, typ, kategoria, formula, poziom, data_dodania, ma_opracowanie', { count: 'exact' })
    .order('rok', { ascending: false })
    .order('numer_zadania_sort', { ascending: true, nullsFirst: false })
    .order('numer_zadania', { ascending: true })
    .range(from, to);

  if (state.filtry.dzialy.length) {
    query = query.overlaps('dzialy', expandKatIds(state.filtry.dzialy));
  }
  if (state.filtry.rok)       query = query.eq('rok',       parseInt(state.filtry.rok));
  if (state.filtry.typ)       query = query.eq('typ',       state.filtry.typ);
  if (state.filtry.kategoria) query = query.eq('kategoria', state.filtry.kategoria);
  if (state.filtry.formula)   query = query.eq('formula',   state.filtry.formula);
  if (state.filtry.poziom)    query = query.eq('poziom',    state.filtry.poziom);

  const { data, count, error } = await query;
  if (error) throw error;
  return { data: data || [], count: count || 0 };
}

// ── Render helpers ──────────────────────────────────────────
function renderTypBadge(typ) {
  return `<span class="typ-badge ${typ}">${typ === 'zamkniete' ? 'Zamknięte' : 'Otwarte'}</span>`;
}

function renderDzialTags(dzialy) {
  if (!dzialy || !dzialy.length) return '';
  return `<div class="dzial-tags">${dzialy.map(d => `<span class="dzial-tag">${escHtml(getLabelForId(d))}</span>`).join('')}</div>`;
}

function buildSlug(zadanie) {
  return `${zadanie.rok}-${zadanie.numer_zadania.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '')}`;
}

function renderOpracowanie(zadanie) {
  if (!state.hasSubscription) {
    const blurText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.';

    return `
      <div class="zadanie-section opracowanie-section">
        <div class="zadanie-section-label">Opracowanie</div>
        <div class="opracowanie-locked">
          <div class="opracowanie-blur-text">${blurText}</div>
          <div class="opracowanie-overlay">
            <div class="opracowanie-overlay-icon">🔒</div>
            <div class="opracowanie-overlay-text">Odblokuj opracowanie</div>
            <div class="opracowanie-overlay-sub">Dostępne w ramach subskrypcji</div>
            <a href="subscription.html" class="btn btn-clay btn-sm mt-8">Odblokuj dostęp</a>
          </div>
        </div>
      </div>`;
  }

  if (!zadanie.ma_opracowanie) {
    return `
      <div class="zadanie-section opracowanie-section">
        <div class="zadanie-section-label">Opracowanie</div>
        <p class="opracowanie-brak">Brak opracowania dla tego zadania.</p>
      </div>`;
  }

  return `
    <div class="zadanie-section opracowanie-section klucz-collapsed" id="opracowanie-${zadanie.id}">
      <div class="zadanie-section-label">Opracowanie</div>
      <button class="klucz-toggle" data-click="toggleOpracowanie" data-id="${escHtml(zadanie.id)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        Pokaż opracowanie
      </button>
      <div class="klucz-body opracowanie-body rich-content" data-loaded="0"></div>
    </div>`;
}

async function toggleOpracowanie(id) {
  const el = document.getElementById(`opracowanie-${id}`);
  if (!el) return;
  const btn  = el.querySelector('.klucz-toggle');
  const body = el.querySelector('.opracowanie-body');

  if (el.classList.contains('klucz-collapsed')) {
    if (body.dataset.loaded !== '1') {
      body.innerHTML = '<p class="opracowanie-loading">Ładowanie…</p>';
      try {
        const { data, error } = await _supabase
          .from('zadania_z_dostepem')
          .select('opracowanie')
          .eq('id', id)
          .single();
        if (error) throw error;
        body.innerHTML = safeHtml(data && data.opracowanie);
        body.dataset.loaded = '1';
      } catch (err) {
        console.error(err);
        body.innerHTML = '<p class="state-error">Błąd ładowania opracowania. Spróbuj ponownie.</p>';
      }
    }
    el.classList.remove('klucz-collapsed');
    btn.innerHTML = btn.innerHTML.replace('Pokaż opracowanie', 'Ukryj opracowanie');
  } else {
    el.classList.add('klucz-collapsed');
    btn.innerHTML = btn.innerHTML.replace('Ukryj opracowanie', 'Pokaż opracowanie');
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMetaBadges(z) {
  const parts = [];
  if (z.kategoria && KATEGORIA_LABELS[z.kategoria]) parts.push(`<span class="meta-badge meta-badge--kategoria">${escHtml(KATEGORIA_LABELS[z.kategoria])}</span>`);
  if (z.formula   && FORMULA_LABELS[z.formula])     parts.push(`<span class="meta-badge meta-badge--formula">${escHtml(FORMULA_LABELS[z.formula])}</span>`);
  if (z.poziom    && POZIOM_LABELS[z.poziom])       parts.push(`<span class="meta-badge meta-badge--poziom">${escHtml(POZIOM_LABELS[z.poziom])}</span>`);
  return parts.length ? `<div class="meta-badges">${parts.join('')}</div>` : '';
}

function renderZadanieCard(z) {
  const slug = buildSlug(z);
  const hasOpr = !!z.ma_opracowanie;

  return `
    <article class="zadanie-card" id="z-${z.id}">
      <div class="zadanie-header">
        <div>
          <div class="zadanie-meta">
            <span class="zadanie-id">Rok ${z.rok} · Zad. ${escHtml(z.numer_zadania)}</span>
            ${renderTypBadge(z.typ)}
            ${hasOpr ? '<span class="nav-sub-badge" style="font-size:10px">opracowanie ✓</span>' : ''}
          </div>
          ${renderMetaBadges(z)}
          ${renderDzialTags(z.dzialy)}
        </div>
        <a href="zadanie/${escHtml(slug)}.html" class="zadanie-link" title="Stały link do zadania">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          #${escHtml(slug)}
        </a>
      </div>

      <div class="zadanie-section">
        <div class="zadanie-section-label">Treść zadania</div>
        <div class="zadanie-tresc rich-content">${safeHtml(z.tresc_zadania)}</div>
      </div>

      <div class="zadanie-section klucz-collapsed" id="klucz-${z.id}">
        <div class="zadanie-section-label">Klucz CKE</div>
        <button class="klucz-toggle" data-click="toggleKlucz" data-id="${escHtml(z.id)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
          Pokaż klucz odpowiedzi
        </button>
        <div class="klucz-body zadanie-klucz rich-content">${safeHtml(z.klucz_cke)}</div>
      </div>

      ${renderOpracowanie(z)}
    </article>`;
}

function toggleKlucz(id) {
  const el = document.getElementById(`klucz-${id}`);
  const btn = el.querySelector('.klucz-toggle');
  if (el.classList.contains('klucz-collapsed')) {
    el.classList.remove('klucz-collapsed');
    btn.innerHTML = btn.innerHTML.replace('Pokaż klucz odpowiedzi', 'Ukryj klucz odpowiedzi');
  } else {
    el.classList.add('klucz-collapsed');
    btn.innerHTML = btn.innerHTML.replace('Ukryj klucz odpowiedzi', 'Pokaż klucz odpowiedzi');
  }
}

// ── Render list ─────────────────────────────────────────────
function renderList(items) {
  const el = document.getElementById('zadania-list');
  if (!items.length) {
    el.innerHTML = `
      <div class="state-empty">
        <span class="state-empty-icon">🔍</span>
        <h3>Brak zadań dla wybranych filtrów</h3>
        <p>Spróbuj zmienić lub wyczyścić filtry.</p>
      </div>`;
    return;
  }
  el.innerHTML = items.map(renderZadanieCard).join('');
}

function renderCount(count) {
  const el = document.getElementById('results-count');
  if (el) el.innerHTML = `Znaleziono <strong>${count}</strong> zadań`;
}

// ── Pagination ──────────────────────────────────────────────
function renderPagination(total) {
  const el = document.getElementById('pagination');
  if (!el) return;

  const pageSize = CONFIG.app.pageSize;
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) { el.innerHTML = ''; return; }

  const cur = state.strona;
  let html = '';

  html += `<button class="page-btn" data-click="goToPage" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>‹ Wstecz</button>`;

  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= cur - 2 && i <= cur + 2)) {
      html += `<button class="page-btn ${i === cur ? 'active' : ''}" data-click="goToPage" data-page="${i}">${i}</button>`;
    } else if (i === cur - 3 || i === cur + 3) {
      html += `<span class="page-btn" style="border:none;background:none;cursor:default">…</span>`;
    }
  }

  html += `<button class="page-btn" data-click="goToPage" data-page="${cur + 1}" ${cur === pages ? 'disabled' : ''}>Dalej ›</button>`;
  el.innerHTML = html;
}

function goToPage(n) {
  state.strona = n;
  stateToURL();
  loadZadania();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Load ────────────────────────────────────────────────────
async function loadZadania() {
  const listEl = document.getElementById('zadania-list');
  listEl.innerHTML = '<div class="state-loading"><div class="spinner"></div><p>Ładowanie zadań…</p></div>';

  try {
    const { data, count } = await fetchZadania();
    state.totalCount = count;
    const heroCountEl = document.getElementById('hero-count');
    if (heroCountEl) heroCountEl.textContent = count.toLocaleString('pl-PL');
    renderList(data);
    renderCount(count);
    renderPagination(count);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="state-error"><p>Błąd ładowania zadań. Spróbuj odświeżyć stronę.</p></div>`;
  }
}

// ── Filters UI ───────────────────────────────────────────────
const expandedKats = new Set();

function buildFiltersUI() {
  const dzialyEl = document.getElementById('filter-dzialy');
  if (dzialyEl) {
    dzialyEl.innerHTML = KATEGORIE.map(kat => {
      const hasSub     = kat.sub.length > 0;
      const isExpanded = expandedKats.has(kat.id);
      const isMainSel  = state.filtry.dzialy.includes(kat.id);
      const hasSubSel  = hasSub && kat.sub.some(s => state.filtry.dzialy.includes(s.id));
      const isActive   = isMainSel || hasSubSel;

      const toggleBtn = hasSub
        ? `<button class="kat-toggle-btn" data-click="toggleKatExpand" data-id="${escHtml(kat.id)}">${isExpanded ? '−' : '+'}</button>`
        : `<span class="kat-toggle-placeholder"></span>`;

      const subsHtml = hasSub ? `
        <div class="kat-subs${isExpanded ? '' : ' hidden'}">
          ${kat.sub.map(s => {
            const isSel = state.filtry.dzialy.includes(s.id);
            return `<span class="kat-sub-label${isSel ? ' active' : ''}" data-click="toggleDzial" data-id="${escHtml(s.id)}">${escHtml(s.label)}</span>`;
          }).join('')}
        </div>` : '';

      return `<div class="kat-item">
        <div class="kat-item-row">
          ${toggleBtn}
          <span class="kat-label${isActive ? ' active' : ''}" data-click="toggleDzial" data-id="${escHtml(kat.id)}">${escHtml(kat.label)}</span>
        </div>${subsHtml}</div>`;
    }).join('');
  }

  const rokEl = document.getElementById('filter-rok');
  if (rokEl) {
    const currentYear = new Date().getFullYear();
    let opts = '<option value="">Wszystkie lata</option>';
    for (let y = currentYear; y >= 2015; y--) {
      opts += `<option value="${y}" ${state.filtry.rok == y ? 'selected' : ''}>${y}</option>`;
    }
    rokEl.innerHTML = opts;
  }

  updateTypUI();
  updateRadioGroup('filter-kategoria-group', state.filtry.kategoria);
  updateRadioGroup('filter-formula-group',   state.filtry.formula);
  updateRadioGroup('filter-poziom-group',    state.filtry.poziom);
}

function toggleKatExpand(id) {
  if (expandedKats.has(id)) expandedKats.delete(id);
  else                       expandedKats.add(id);
  buildFiltersUI();
}

function toggleDzial(id) {
  const idx = state.filtry.dzialy.indexOf(id);
  if (idx === -1) {
    state.filtry.dzialy.push(id);
    // auto-rozwiń rodzica jeśli wybrano podkategorię
    const parent = KATEGORIE.find(k => k.sub.some(s => s.id === id));
    if (parent) expandedKats.add(parent.id);
    // auto-rozwiń główną jeśli ma podkategorie
    const kat = KATEGORIE.find(k => k.id === id);
    if (kat && kat.sub.length > 0) expandedKats.add(id);
  } else {
    state.filtry.dzialy.splice(idx, 1);
  }
  state.strona = 1;
  buildFiltersUI();
  updateActiveFiltersChips();
  stateToURL();
  loadZadania();
}

function setRok(val) {
  state.filtry.rok = val;
  state.strona = 1;
  updateActiveFiltersChips();
  stateToURL();
  loadZadania();
}

function setTyp(val) {
  state.filtry.typ = val;
  state.strona = 1;
  updateTypUI();
  updateActiveFiltersChips();
  stateToURL();
  loadZadania();
}

function updateTypUI() {
  document.querySelectorAll('#filters-panel .filter-radio[data-val]').forEach(el => {
    if (el.closest('[id^="filter-kategoria"]') || el.closest('[id^="filter-formula"]') || el.closest('[id^="filter-poziom"]')) return;
    const val = el.dataset.val;
    el.classList.toggle('active', val === state.filtry.typ);
  });
}

function updateRadioGroup(groupId, currentVal) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.filter-radio').forEach(el => {
    el.classList.toggle('active', el.dataset.val === currentVal);
  });
}

function setKategoria(val) {
  state.filtry.kategoria = val;
  state.strona = 1;
  updateRadioGroup('filter-kategoria-group', val);
  updateActiveFiltersChips();
  stateToURL();
  loadZadania();
}

function setFormula(val) {
  state.filtry.formula = val;
  state.strona = 1;
  updateRadioGroup('filter-formula-group', val);
  updateActiveFiltersChips();
  stateToURL();
  loadZadania();
}

function setPoziom(val) {
  state.filtry.poziom = val;
  state.strona = 1;
  updateRadioGroup('filter-poziom-group', val);
  updateActiveFiltersChips();
  stateToURL();
  loadZadania();
}

function clearFilters() {
  state.filtry.dzialy    = [];
  state.filtry.rok       = '';
  state.filtry.typ       = '';
  state.filtry.kategoria = '';
  state.filtry.formula   = '';
  state.filtry.poziom    = '';
  state.strona = 1;
  buildFiltersUI();
  updateActiveFiltersChips();
  stateToURL();
  loadZadania();
}

function updateActiveFiltersChips() {
  const el = document.getElementById('active-filters');
  if (!el) return;

  const chips = [];
  state.filtry.dzialy.forEach(id =>
    chips.push(`<span class="active-filter-chip">${escHtml(getLabelForId(id))}<button data-click="toggleDzial" data-id="${escHtml(id)}">×</button></span>`)
  );
  if (state.filtry.rok)
    chips.push(`<span class="active-filter-chip">Rok: ${escHtml(state.filtry.rok)}<button data-click="clearFilter" data-field="rok">×</button></span>`);
  if (state.filtry.typ)
    chips.push(`<span class="active-filter-chip">${state.filtry.typ === 'zamkniete' ? 'Zamknięte' : 'Otwarte'}<button data-click="clearFilter" data-field="typ">×</button></span>`);
  if (state.filtry.kategoria)
    chips.push(`<span class="active-filter-chip">${escHtml(KATEGORIA_LABELS[state.filtry.kategoria] || '')}<button data-click="clearFilter" data-field="kategoria">×</button></span>`);
  if (state.filtry.formula)
    chips.push(`<span class="active-filter-chip">${escHtml(FORMULA_LABELS[state.filtry.formula] || '')}<button data-click="clearFilter" data-field="formula">×</button></span>`);
  if (state.filtry.poziom)
    chips.push(`<span class="active-filter-chip">${escHtml(POZIOM_LABELS[state.filtry.poziom] || '')}<button data-click="clearFilter" data-field="poziom">×</button></span>`);

  if (chips.length) {
    el.innerHTML = `<div class="active-filters-label">Aktywne filtry:</div>${chips.join('')}`;
    el.style.display = 'block';
  } else {
    el.innerHTML = '';
    el.style.display = 'none';
  }
}

function toggleMobileFilters() {
  const panel = document.getElementById('filters-panel');
  panel.classList.toggle('open');
}

// ── Total count for hero (no filters) ───────────────────────
async function updateHeroCount() {
  const el = document.getElementById('hero-count');
  if (!el) return;
  for (const table of ['zadania_z_dostepem', 'zadania']) {
    const { count, error } = await _supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (!error && count != null) {
      el.textContent = count.toLocaleString('pl-PL');
      return;
    }
    if (error) console.warn('[hero-count]', table, error.message);
  }
}

// ── Init ─────────────────────────────────────────────────────
async function initZadaniaPage() {
  stateFromURL();

  // Aktualizuj nawigację i sprawdź subskrypcję
  await updateNavAuth({
    onSession: (_session, active) => { state.hasSubscription = active; }
  });

  buildFiltersUI();
  updateActiveFiltersChips();
  updateHeroCount();
  loadZadania();

  // Obsługa przycisk wstecz/naprzód przeglądarki
  window.addEventListener('popstate', () => {
    stateFromURL();
    buildFiltersUI();
    updateActiveFiltersChips();
    loadZadania();
  });
}

// ── Akcje (data-click / data-change w HTML, patrz actions.js) ──
const FILTER_SETTERS = { rok: setRok, typ: setTyp, kategoria: setKategoria, formula: setFormula, poziom: setPoziom };

registerActions({
  toggleKlucz:         (el) => toggleKlucz(el.dataset.id),
  toggleOpracowanie:   (el) => toggleOpracowanie(el.dataset.id),
  toggleDzial:         (el) => { if (KATEGORIE_MAP[el.dataset.id]) toggleDzial(el.dataset.id); },
  toggleKatExpand:     (el) => { if (KATEGORIE_MAP[el.dataset.id]) toggleKatExpand(el.dataset.id); },
  clearFilter:         (el) => { const fn = FILTER_SETTERS[el.dataset.field]; if (fn) fn(''); },
  setRok:              (el) => setRok(el.value),
  setTyp:              (el) => setTyp(el.dataset.val),
  setKategoria:        (el) => setKategoria(el.dataset.val),
  setFormula:          (el) => setFormula(el.dataset.val),
  setPoziom:           (el) => setPoziom(el.dataset.val),
  clearFilters:        () => clearFilters(),
  goToPage:            (el) => { const n = parseInt(el.dataset.page, 10); if (n >= 1) goToPage(n); },
  toggleMobileFilters: () => toggleMobileFilters(),
});
