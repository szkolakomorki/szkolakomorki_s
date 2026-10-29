// Logika landing page'a (matura-z-biologii.html):
//  - liczniki (liczba zadań / zagadnień),
//  - darmowa próbka: jedno opracowanie zadania + jedno zagadnienie z podręcznika.
//
// Próbka pochodzi z funkcji SQL get_demo_content() (patrz migration_demo_landing.sql).
// Funkcja zwraca WYŁĄCZNIE dwa rekordy wskazane w tabeli demo_wybor — reszta płatnej
// treści jest nadal chroniona widokami zadania_z_dostepem / podrecznik_z_dostepem.
// Wymaga: config.js, auth.js, DOMPurify, Supabase CDN

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Liczniki ─────────────────────────────────────────────────
async function loadCounters() {
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (el && n != null) el.textContent = n.toLocaleString('pl-PL');
  };
  try {
    const [z, p] = await Promise.all([
      _supabase.from('zadania_z_dostepem').select('*', { count: 'exact', head: true }),
      _supabase.from('podrecznik_z_dostepem').select('*', { count: 'exact', head: true }),
    ]);
    set('count-zadania', z.count);
    set('count-podrecznik', p.count);
  } catch (_) { /* liczniki są ozdobne — brak liczby nie psuje strony */ }
}

// ── Próbka: render ───────────────────────────────────────────
function renderDzialTags(dzialy) {
  if (!dzialy || !dzialy.length) return '';
  return `<div class="dzial-tags">${dzialy.map(d => `<span class="dzial-tag">${escHtml(getLabelForId(d))}</span>`).join('')}</div>`;
}

function renderMetaBadges(z) {
  const parts = [];
  if (z.kategoria && KATEGORIA_LABELS[z.kategoria]) parts.push(`<span class="meta-badge meta-badge--kategoria">${escHtml(KATEGORIA_LABELS[z.kategoria])}</span>`);
  if (z.formula   && FORMULA_LABELS[z.formula])     parts.push(`<span class="meta-badge meta-badge--formula">${escHtml(FORMULA_LABELS[z.formula])}</span>`);
  if (z.poziom    && POZIOM_LABELS[z.poziom])       parts.push(`<span class="meta-badge meta-badge--poziom">${escHtml(POZIOM_LABELS[z.poziom])}</span>`);
  return parts.length ? `<div class="meta-badges">${parts.join('')}</div>` : '';
}

function renderDemoZadanie(z) {
  const typ = z.typ === 'zamkniete' ? 'zamkniete' : 'otwarte';
  const opracowanie = z.opracowanie
    ? `<div class="zadanie-section opracowanie-section">
         <div class="zadanie-section-label">Opracowanie</div>
         <div class="opracowanie-body rich-content">${safeHtml(z.opracowanie)}</div>
       </div>`
    : `<div class="zadanie-section opracowanie-section">
         <div class="zadanie-section-label">Opracowanie</div>
         <p class="opracowanie-brak">Opracowanie tego zadania pojawi się wkrótce.</p>
       </div>`;

  return `
    <article class="zadanie-card mk-demo-card">
      <div class="zadanie-header">
        <div>
          <div class="zadanie-meta">
            <span class="zadanie-id">Rok ${escHtml(z.rok)} · Zad. ${escHtml(z.numer_zadania)}</span>
            <span class="typ-badge ${typ}">${typ === 'zamkniete' ? 'Zamknięte' : 'Otwarte'}</span>
            <span class="nav-sub-badge" style="font-size:10px">opracowanie ✓</span>
          </div>
          ${renderMetaBadges(z)}
          ${renderDzialTags(z.dzialy)}
        </div>
      </div>

      <div class="zadanie-section">
        <div class="zadanie-section-label">Treść zadania</div>
        <div class="zadanie-tresc rich-content">${safeHtml(z.tresc_zadania)}</div>
      </div>

      <div class="zadanie-section klucz-collapsed" id="demo-klucz">
        <div class="zadanie-section-label">Klucz CKE</div>
        <button type="button" class="klucz-toggle" data-click="toggleDemoKlucz">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
          <span>Pokaż klucz odpowiedzi</span>
        </button>
        <div class="klucz-body zadanie-klucz rich-content">${safeHtml(z.klucz_cke)}</div>
      </div>

      ${opracowanie}
    </article>`;
}

function renderDemoPodrecznik(p) {
  return `
    <article class="podr-tile" id="demo-podr">
      <button type="button" class="podr-tile-header" aria-expanded="false" data-click="toggleDemoPodr">
        <span class="podr-tile-heading">
          <span class="podr-tile-title">${escHtml(p.tytul)}</span>
          ${renderDzialTags(p.dzialy)}
        </span>
        <svg class="podr-tile-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="podr-tile-body">
        <div class="podr-tile-content">
          <div class="podr-tile-rich rich-content">${safeHtml(p.tresc)}</div>
        </div>
      </div>
    </article>`;
}

function toggleDemoKlucz() {
  const el = document.getElementById('demo-klucz');
  if (!el) return;
  const label = el.querySelector('.klucz-toggle span');
  const collapsed = el.classList.toggle('klucz-collapsed');
  if (label) label.textContent = collapsed ? 'Pokaż klucz odpowiedzi' : 'Ukryj klucz odpowiedzi';
}

function toggleDemoPodr() {
  const tile = document.getElementById('demo-podr');
  if (!tile) return;
  const open = tile.classList.toggle('expanded');
  const header = tile.querySelector('.podr-tile-header');
  if (header) header.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// ── Próbka: ładowanie ────────────────────────────────────────
function demoFallback(el, what) {
  el.innerHTML = `
    <div class="state-error">
      <p>Nie udało się wczytać próbki (${escHtml(what)}). Odśwież stronę albo
      <a href="${what === 'podręcznik' ? 'podrecznik.html' : 'baza.html'}">przejdź do serwisu</a>.</p>
    </div>`;
}

async function loadDemo() {
  const zEl = document.getElementById('demo-zadanie');
  const pEl = document.getElementById('demo-podrecznik');
  if (!zEl || !pEl) return;

  try {
    const { data, error } = await _supabase.rpc('get_demo_content');
    if (error) throw error;

    if (data && data.zadanie) zEl.innerHTML = renderDemoZadanie(data.zadanie);
    else                      demoFallback(zEl, 'zadanie');

    if (data && data.podrecznik) pEl.innerHTML = renderDemoPodrecznik(data.podrecznik);
    else                         demoFallback(pEl, 'podręcznik');
  } catch (err) {
    console.error('[demo]', err);
    demoFallback(zEl, 'zadanie');
    demoFallback(pEl, 'podręcznik');
  }
}

// ── FAQ: tylko jedna otwarta odpowiedź naraz ─────────────────
function initFaq() {
  const items = document.querySelectorAll('.mk-faq details');
  items.forEach(d => d.addEventListener('toggle', () => {
    if (d.open) items.forEach(o => { if (o !== d) o.open = false; });
  }));
}

// ── Init ─────────────────────────────────────────────────────
async function initLanding() {
  document.getElementById('year').textContent = new Date().getFullYear();
  initFaq();
  updateNavAuth();   // przycisk Zaloguj / Wyloguj + plakietka subskrypcji
  loadCounters();
  loadDemo();
}


// ── Akcje (data-click w HTML, patrz actions.js) ──
registerActions({
  toggleDemoKlucz: () => toggleDemoKlucz(),
  toggleDemoPodr:  () => toggleDemoPodr(),
});
