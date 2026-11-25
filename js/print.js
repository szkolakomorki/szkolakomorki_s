// Drukowanie zadań do PDF (okno druku przeglądarki → „Zapisz jako PDF”).
// Wymaga: config.js, auth.js, safe-html.js, actions.js, zadania.js (state, applyFilters, escHtml, …)
//
// Dwa tryby:
//   1) „Z tej strony”      — zadania już wczytane na liście (state.items), wybór checkboxami / zakresem „2, 4-6”
//   2) „Według filtrów”    — własne filtry w oknie (niezależne od listy), wyniki pobierane z bazy (max MAX_TASKS)
//
// Bezpieczeństwo (zadania autorskie):
//   • Dane wydruku pochodzą WYŁĄCZNIE z widoku zadania_z_dostepem — tego samego, z którego czyta lista.
//     Baza sama odcina klucz i resztę treści zadań autorskich osobom bez premium, więc wydruk nie ma
//     dostępu do niczego więcej niż strona. Nie ma tu żadnego osobnego endpointu ani zapytania do tabeli.
//   • O pominięciu zadania decyduje pole z.zablokowane zwrócone przez bazę, nie flaga po stronie klienta.
//   • Nigdy nie pobieramy ani nie drukujemy opracowań (kolumna `opracowanie` nie jest nawet wybierana).
//   • Cała treść przechodzi przez safeHtml() (DOMPurify), jak na liście.

(function () {
  'use strict';

  const MAX_TASKS = 200;
  const PRINT_FIELDS = 'id, rok, numer_zadania, tresc_zadania, klucz_cke, dzialy, typ, kategoria, formula, poziom, zablokowane';
  const LOCKED_NOTE  = 'Zadanie autorskie — dostępne do wydruku w ramach subskrypcji premium.';

  const TYP_LABELS = { zamkniete: 'Zamknięte', otwarte: 'Otwarte' };

  // ── Stan okna ─────────────────────────────────────────────
  let modal = null;
  let tab = 'page';                    // 'page' | 'filters'
  let sel = new Set();                 // indeksy (0-based) zaznaczonych zadań na bieżącej stronie
  let pf  = emptyFilters();            // filtry trybu 2 (niezależne od state.filtry)
  const pfExpanded = new Set();
  let countTimer = null, countSeq = 0;
  let pfCount = null;                  // { total, locked } | { error } | null (liczenie)
  let busy = false;

  function emptyFilters() {
    return { dzialy: [], rok: '', typ: '', kategoria: '', formula: '', poziom: '' };
  }
  function cloneFilters(f) {
    return { dzialy: f.dzialy.slice(), rok: f.rok, typ: f.typ, kategoria: f.kategoria, formula: f.formula, poziom: f.poziom };
  }
  const $ = (sel_) => modal ? modal.querySelector(sel_) : null;

  // ── Zakres „2, 4-6” ───────────────────────────────────────
  function parseRange(str, max) {
    const out = new Set();
    const errors = [];
    const norm = String(str || '').replace(/\s*[-–—]\s*/g, '-').trim();
    if (!norm) return { set: out, errors };
    norm.split(/[,;\s]+/).filter(Boolean).forEach((tok) => {
      let m = tok.match(/^(\d{1,4})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n < 1 || n > max) errors.push(tok + ' (poza zakresem 1–' + max + ')');
        else out.add(n - 1);
        return;
      }
      m = tok.match(/^(\d{1,4})-(\d{1,4})$/);
      if (m) {
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b)                     errors.push(tok + ' (odwrócony zakres)');
        else if (a < 1 || b > max)     errors.push(tok + ' (poza zakresem 1–' + max + ')');
        else for (let i = a; i <= b; i++) out.add(i - 1);
        return;
      }
      errors.push(tok + ' (niepoprawny zapis)');
    });
    return { set: out, errors };
  }

  function formatRange(set) {
    const nums = Array.from(set).map((i) => i + 1).sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < nums.length; ) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push(j > i ? nums[i] + '-' + nums[j] : String(nums[i]));
      i = j + 1;
    }
    return parts.join(', ');
  }

  // ── Opis zakresu (strona tytułowa) ────────────────────────
  function describeFilters(f, emptyText) {
    const parts = [];
    if (f.dzialy.length) parts.push(f.dzialy.map(getLabelForId).join(', '));
    if (f.rok)           parts.push('rok ' + f.rok);
    if (f.typ)           parts.push(TYP_LABELS[f.typ] || '');
    if (f.kategoria)     parts.push(KATEGORIA_LABELS[f.kategoria] || '');
    if (f.formula)       parts.push(FORMULA_LABELS[f.formula] || '');
    if (f.poziom)        parts.push(POZIOM_LABELS[f.poziom] || '');
    return parts.filter(Boolean).join(' · ') || emptyText || 'Wszystkie zadania w bazie';
  }

  // ── Okno modalne ──────────────────────────────────────────
  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'pm-overlay';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pm-title');
    modal.innerHTML = `
      <div class="pm-dialog">
        <div class="pm-head">
          <h2 id="pm-title">Drukuj zadania</h2>
          <button type="button" class="pm-close" data-click="printClose" aria-label="Zamknij">×</button>
        </div>
        <div class="pm-tabs" role="tablist">
          <button type="button" class="pm-tab active" role="tab" data-click="printTab" data-tab="page">Z tej strony</button>
          <button type="button" class="pm-tab" role="tab" data-click="printTab" data-tab="filters">Według filtrów</button>
        </div>
        <div class="pm-body">
          <div class="pm-pane" data-pane="page">
            <p class="pm-lead">Wybierz zadania z listy: zaznacz je polem z numerem na karcie albo wpisz numery poniżej.</p>
            <div class="pm-field">
              <label class="pm-label" for="pm-range" id="pm-range-label">Numery zadań na tej stronie</label>
              <input type="text" id="pm-range" class="pm-input" placeholder="np. 2, 4-6" autocomplete="off" inputmode="text">
              <div class="pm-quick">
                <button type="button" class="pm-link" data-click="printSelectAll">Zaznacz wszystkie</button>
                <button type="button" class="pm-link" data-click="printSelectNone">Wyczyść</button>
              </div>
              <div class="pm-error" id="pm-range-error" hidden></div>
            </div>
            <div class="pm-summary" id="pm-page-summary"></div>
          </div>
          <div class="pm-pane" data-pane="filters" hidden>
            <p class="pm-lead">Ustaw filtry tak jak na stronie. Wydrukują się wszystkie pasujące zadania (maks. ${MAX_TASKS}).</p>
            <div id="pm-filters-ui"></div>
            <div class="pm-summary" id="pm-filters-summary"></div>
          </div>
          <div class="pm-group">
            <span class="pm-label">Co drukować</span>
            <div class="pm-checks">
              <label class="pm-check"><input type="checkbox" id="pm-opt-tresc" checked> <span>Treść zadań</span></label>
              <label class="pm-check"><input type="checkbox" id="pm-opt-klucz" checked> <span>Klucz odpowiedzi</span></label>
            </div>
            <p class="pm-hint">Opracowania nie są drukowane.</p>
          </div>
        </div>
        <div class="pm-foot">
          <span class="pm-status" id="pm-status" aria-live="polite"></span>
          <button type="button" class="btn btn-clay" id="pm-go" data-click="printGo">Wydrukuj zadania</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Kliknięcie w tło zamyka okno; pole zakresu reaguje na bieżąco (change z actions.js to za mało)
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
    modal.querySelector('#pm-range').addEventListener('input', onRangeInput);
    modal.querySelector('#pm-opt-tresc').addEventListener('change', updateGo);
    modal.querySelector('#pm-opt-klucz').addEventListener('change', updateGo);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) closeModal(); });
  }

  function isOpen() { return !!modal && !modal.hidden; }

  function openModal() {
    ensureModal();
    pf = cloneFilters(state.filtry);
    pfCount = null;
    modal.hidden = false;
    document.body.classList.add('pm-open');
    setTab('page');
    syncRangeField();
    refreshPagePane();
    const first = modal.querySelector('.pm-close');
    if (first) first.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('pm-open');
    clearTimeout(countTimer);
    countSeq++;                                   // unieważnij trwające liczenie
  }

  function setTab(name) {
    tab = name === 'filters' ? 'filters' : 'page';
    modal.querySelectorAll('.pm-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    modal.querySelectorAll('.pm-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    if (tab === 'filters') { renderFilters(); scheduleCount(); }
    setStatus('');
    updateGo();
  }

  function setStatus(text, isError) {
    const el = $('#pm-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('pm-status--error', !!isError);
  }

  // ── Tryb 1: wybór z bieżącej strony ───────────────────────
  function syncRangeField() {
    const input = $('#pm-range');
    if (input) input.value = formatRange(sel);
  }

  function syncCheckboxes() {
    document.querySelectorAll('.print-pick input[data-idx]').forEach((cb) => {
      cb.checked = sel.has(parseInt(cb.dataset.idx, 10));
    });
  }

  function onRangeInput() {
    const max = state.items.length;
    const { set, errors } = parseRange($('#pm-range').value, max);
    sel = set;
    syncCheckboxes();
    const errEl = $('#pm-range-error');
    errEl.hidden = !errors.length;
    errEl.textContent = errors.length ? 'Pominięto: ' + errors.join(', ') : '';
    refreshPagePane(true);
  }

  function refreshPagePane(keepRangeText) {
    if (!modal) return;
    const max = state.items.length;
    const label = $('#pm-range-label');
    if (label) label.textContent = max ? 'Numery zadań na tej stronie (1–' + max + ')' : 'Numery zadań na tej stronie';
    const input = $('#pm-range');
    if (input) input.disabled = !max;
    if (!keepRangeText) {
      syncRangeField();
      const errEl = $('#pm-range-error');
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    }

    const lockedSelected = Array.from(sel).filter((i) => state.items[i] && state.items[i].zablokowane).length;
    const lockedOnPage = state.items.filter((z) => z.zablokowane).length;
    let html = max
      ? 'Wybrano: <strong>' + sel.size + '</strong> z ' + max
      : 'Na tej stronie nie ma zadań do wydruku.';
    if (lockedOnPage) {
      html += '<br><span class="pm-hint">Zadania autorskie (' + lockedOnPage + ' na tej stronie) są dostępne do wydruku w premium'
        + (lockedSelected ? ' — w PDF pojawi się tylko adnotacja (' + lockedSelected + ').' : '.') + '</span>';
    }
    const sum = $('#pm-page-summary');
    if (sum) sum.innerHTML = html;
    updateGo();
  }

  // ── Tryb 2: własne filtry ─────────────────────────────────
  function radioGroup(field, options, current) {
    const all = [{ id: '', label: 'Wszystkie' }].concat(options);
    return '<div class="filter-radio-group">' + all.map((o) =>
      `<span class="filter-radio${o.id === current ? ' active' : ''}" role="button" tabindex="0" data-click="printSet" data-field="${field}" data-val="${escHtml(o.id)}">${escHtml(o.label)}</span>`
    ).join('') + '</div>';
  }

  function renderFilters() {
    const el = $('#pm-filters-ui');
    if (!el) return;

    const dzialy = KATEGORIE.map((kat) => {
      const hasSub     = kat.sub.length > 0;
      const isExpanded = pfExpanded.has(kat.id);
      const isActive   = pf.dzialy.includes(kat.id) || (hasSub && kat.sub.some((s) => pf.dzialy.includes(s.id)));
      const toggleBtn  = hasSub
        ? `<button type="button" class="kat-toggle-btn" data-click="printKatExpand" data-id="${escHtml(kat.id)}">${isExpanded ? '−' : '+'}</button>`
        : '<span class="kat-toggle-placeholder"></span>';
      const subs = hasSub ? `<div class="kat-subs${isExpanded ? '' : ' hidden'}">${kat.sub.map((s) =>
        `<span class="kat-sub-label${pf.dzialy.includes(s.id) ? ' active' : ''}" data-click="printDzial" data-id="${escHtml(s.id)}">${escHtml(s.label)}</span>`
      ).join('')}</div>` : '';
      return `<div class="kat-item"><div class="kat-item-row">${toggleBtn}<span class="kat-label${isActive ? ' active' : ''}" data-click="printDzial" data-id="${escHtml(kat.id)}">${escHtml(kat.label)}</span></div>${subs}</div>`;
    }).join('');

    const currentYear = new Date().getFullYear();
    let years = '<option value="">Wszystkie lata</option>';
    for (let y = currentYear; y >= 2015; y--) years += `<option value="${y}"${String(pf.rok) === String(y) ? ' selected' : ''}>${y}</option>`;

    el.innerHTML = `
      <div class="filter-group"><label>Dział biologii</label><div class="pm-dzialy">${dzialy}</div></div>
      <div class="pm-filter-grid">
        <div class="filter-group"><label>Rok matury</label><select class="filter-select" data-change="printSetRok">${years}</select></div>
        <div class="filter-group"><label>Typ zadania</label>${radioGroup('typ', [{ id: 'zamkniete', label: 'Zamknięte' }, { id: 'otwarte', label: 'Otwarte' }], pf.typ)}</div>
      </div>
      <div class="filter-group"><label>Kategoria</label>${radioGroup('kategoria', KATEGORIA_OPTIONS, pf.kategoria)}</div>
      <div class="filter-group"><label>Formuła</label>${radioGroup('formula', FORMULA_OPTIONS, pf.formula)}</div>
      <div class="filter-group"><label>Poziom</label>${radioGroup('poziom', POZIOM_OPTIONS, pf.poziom)}</div>
      <button type="button" class="btn-clear-filters" data-click="printClearFilters">Wyczyść filtry</button>`;
  }

  function onFiltersChanged() {
    renderFilters();
    pfCount = null;
    renderFiltersSummary();
    scheduleCount();
    updateGo();
  }

  function renderFiltersSummary() {
    const el = $('#pm-filters-summary');
    if (!el) return;
    let html = '<div class="pm-scope">' + escHtml(describeFilters(pf)) + '</div>';
    if (!pfCount) {
      html += '<div class="pm-count pm-count--loading">Liczenie zadań…</div>';
    } else if (pfCount.error) {
      html += '<div class="pm-count pm-count--error">Nie udało się policzyć zadań. Spróbuj ponownie.</div>';
    } else if (pfCount.total === 0) {
      html += '<div class="pm-count pm-count--error">Brak zadań dla wybranych filtrów.</div>';
    } else {
      html += 'Pasuje: <strong>' + pfCount.total + '</strong> zadań';
      if (pfCount.total > MAX_TASKS) {
        html += '<div class="pm-count pm-count--error">Limit wydruku to ' + MAX_TASKS + ' zadań — zawęź filtry.</div>';
      }
      if (pfCount.locked > 0) {
        html += '<br><span class="pm-hint">W tym ' + pfCount.locked + ' zadań autorskich dostępnych do wydruku w premium (w PDF tylko adnotacja).</span>';
      }
    }
    el.innerHTML = html;

    // Podsumowanie jest pod filtrami (trzeba przewinąć) — krótka wersja także w stopce okna
    if (tab === 'filters') {
      if (!pfCount)            setStatus('Liczenie zadań…');
      else if (pfCount.error)  setStatus('Nie udało się policzyć zadań.', true);
      else if (pfCount.total === 0)        setStatus('Brak zadań dla filtrów.', true);
      else if (pfCount.total > MAX_TASKS)  setStatus('Pasuje ' + pfCount.total + ' — limit ' + MAX_TASKS + ', zawęź filtry.', true);
      else                     setStatus('Pasuje: ' + pfCount.total + ' zadań');
    }
  }

  function scheduleCount() {
    clearTimeout(countTimer);
    pfCount = null;
    renderFiltersSummary();
    countTimer = setTimeout(runCount, 250);
  }

  async function runCount() {
    const seq = ++countSeq;
    try {
      const base = () => applyFilters(
        _supabase.from('zadania_z_dostepem').select('id', { count: 'exact', head: true }), pf);
      const totalRes = await base();
      if (totalRes.error) throw totalRes.error;
      let locked = 0;
      // Informacyjnie: ile z wyników to zadania autorskie zablokowane dla tego użytkownika (z bazy)
      const lockedRes = await base().eq('zablokowane', true);
      if (!lockedRes.error) locked = lockedRes.count || 0;
      if (seq !== countSeq) return;
      pfCount = { total: totalRes.count || 0, locked };
    } catch (err) {
      console.error('[print count]', err);
      if (seq !== countSeq) return;
      pfCount = { error: true };
    }
    renderFiltersSummary();
    updateGo();
  }

  // ── Przycisk „Wydrukuj” ───────────────────────────────────
  function wantsContent() {
    const t = $('#pm-opt-tresc'), k = $('#pm-opt-klucz');
    return { tresc: !!(t && t.checked), klucz: !!(k && k.checked) };
  }

  function updateGo() {
    const btn = $('#pm-go');
    if (!btn) return;
    const o = wantsContent();
    let ok = !busy && (o.tresc || o.klucz);
    if (tab === 'page')    ok = ok && sel.size > 0;
    if (tab === 'filters') ok = ok && !!pfCount && !pfCount.error && pfCount.total > 0 && pfCount.total <= MAX_TASKS;
    btn.disabled = !ok;
    if (!o.tresc && !o.klucz) setStatus('Wybierz, co drukować: treść i/lub klucz.', true);
    else if (($('#pm-status') || {}).textContent === 'Wybierz, co drukować: treść i/lub klucz.') setStatus('');
  }

  async function doPrint() {
    const opts = wantsContent();
    if (busy || (!opts.tresc && !opts.klucz)) return;
    busy = true;
    updateGo();
    setStatus('Przygotowuję wydruk…');

    try {
      let items, scope;
      if (tab === 'page') {
        items = Array.from(sel).sort((a, b) => a - b).map((i) => state.items[i]).filter(Boolean);
        const f = describeFilters(state.filtry, '');
        scope = f ? f + ' (wybrane zadania)' : 'Wybrane zadania z bazy';
      } else {
        let q = _supabase.from('zadania_z_dostepem').select(PRINT_FIELDS)
          .order('rok', { ascending: false })
          .order('numer_zadania_sort', { ascending: true, nullsFirst: false })
          .order('numer_zadania', { ascending: true })
          .range(0, MAX_TASKS - 1);
        q = applyFilters(q, pf);
        const { data, error } = await q;
        if (error) throw error;
        items = data || [];
        scope = describeFilters(pf);
      }
      if (!items.length) { setStatus('Brak zadań do wydruku.', true); return; }

      closeModal();
      await printItems(items, opts, scope);
    } catch (err) {
      console.error('[print]', err);
      setStatus('Nie udało się przygotować wydruku. Spróbuj ponownie.', true);
    } finally {
      busy = false;
      updateGo();
    }
  }

  // ── Budowa dokumentu do druku ─────────────────────────────
  function metaLine(z) {
    const parts = [];
    if (z.kategoria && KATEGORIA_LABELS[z.kategoria]) parts.push(KATEGORIA_LABELS[z.kategoria]);
    if (z.formula   && FORMULA_LABELS[z.formula])     parts.push(FORMULA_LABELS[z.formula]);
    if (z.poziom    && POZIOM_LABELS[z.poziom])       parts.push(POZIOM_LABELS[z.poziom]);
    if (z.dzialy && z.dzialy.length)                  parts.push(z.dzialy.map(getLabelForId).join(', '));
    return parts.map(escHtml).join(' · ');
  }

  // Dokument to jedna tabela (thead/tfoot = marginesy powtarzane na każdej stronie), a każdy element
  // treści zadania to OSOBNY WIERSZ tabeli. Przeglądarki zgodnie przestrzegają zakazu łamania wiersza
  // (break-inside: avoid), więc wiersz z obrazkiem nigdy nie zostanie przecięty między stronami —
  // jeśli się nie mieści, w całości przechodzi na następną. Zwykły tekst dzieli się normalnie.
  function row(inner, cls) {
    return `<tr class="pr-row${cls ? ' ' + cls : ''}"><td>${inner}</td></tr>`;
  }

  // Dzieli (już zsanityzowany) HTML na wiersze: po jednym na element najwyższego poziomu;
  // luźny tekst / elementy liniowe obok siebie trafiają do wspólnego wiersza.
  function contentRows(safe, keyed) {
    const tpl = document.createElement('template');
    tpl.innerHTML = safe;
    const out = [];
    let inline = [];
    const wrap = (html, solid) =>
      row(`<div class="pr-body rich-content">${html}</div>`, (solid ? 'pr-row--solid ' : '') + (keyed ? 'pr-row--key' : ''));
    const flush = () => {
      if (!inline.length) return;
      const html = inline.map((n) => (n.nodeType === 1 ? n.outerHTML : escHtml(n.textContent))).join('');
      out.push(wrap(html, inline.some((n) => n.nodeType === 1 && (n.tagName === 'IMG' || n.querySelector('img')))));
      inline = [];
    };
    tpl.content.childNodes.forEach((node) => {
      if (node.nodeType === 1 && /^(P|UL|OL|H2|H3|DIV|TABLE)$/.test(node.tagName)) {
        flush();
        out.push(wrap(node.outerHTML, !!node.querySelector('img')));
      } else if (node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim())) {
        inline.push(node);
      }
    });
    flush();
    return out.join('');
  }

  function taskHtml(z, opts) {
    const head =
      row(`<header class="pr-task-head">
             <span class="pr-task-id">Rok ${escHtml(z.rok)} · Zad. ${escHtml(z.numer_zadania)}</span>
             <span class="pr-task-typ">${escHtml(TYP_LABELS[z.typ] || '')}</span>
           </header>`, 'pr-row--keep') +
      row(`<div class="pr-task-meta">${metaLine(z)}</div>`, 'pr-row--keep');

    // Decyzja po stronie bazy (z.zablokowane): bez premium zadanie autorskie nie jest drukowane
    if (z.zablokowane) {
      return `<tbody class="pr-task pr-task--locked">${head}${row(`<p class="pr-locked">${escHtml(LOCKED_NOTE)}</p>`, 'pr-row--solid')}</tbody>`;
    }

    let body = '';
    if (opts.tresc) {
      body += row('<div class="pr-label">Treść zadania</div>', 'pr-row--keep') + contentRows(safeHtml(z.tresc_zadania));
    }
    if (opts.klucz) {
      const label = z.kategoria === 'zadanie_autorskie' ? 'Klucz odpowiedzi' : 'Klucz CKE';
      const key = z.klucz_cke ? safeHtml(z.klucz_cke) : '<p class="pr-none">Brak klucza dla tego zadania.</p>';
      body += row(`<div class="pr-label">${label}</div>`, 'pr-row--keep') + contentRows(key, true);
    }
    return `<tbody class="pr-task">${head}${body}</tbody>`;
  }

  function buildPrintRoot(items, opts, scope) {
    const lockedCount = items.filter((z) => z.zablokowane).length;
    const what = opts.tresc && opts.klucz ? 'Treść zadań i klucz odpowiedzi'
               : opts.tresc ? 'Treść zadań' : 'Klucz odpowiedzi';
    const date = new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const cover = `
      <section class="pr-cover">
        <div class="pr-cover-kicker">Szkoła Komórki · Baza zadań</div>
        <h1 class="pr-cover-title">Zadania maturalne<br>z <em>biologii</em></h1>
        <div class="pr-cover-rule"></div>
        <dl class="pr-cover-meta">
          <div><dt>Zakres</dt><dd>${escHtml(scope)}</dd></div>
          <div><dt>Liczba zadań</dt><dd>${items.length}</dd></div>
          <div><dt>Zawartość</dt><dd>${what}</dd></div>
          <div><dt>Wygenerowano</dt><dd>${date}</dd></div>
        </dl>
        ${lockedCount ? `<p class="pr-cover-note">Zadania autorskie (${lockedCount}) są dostępne do wydruku w ramach subskrypcji premium.</p>` : ''}
      </section>`;

    const root = document.createElement('div');
    root.id = 'print-root';
    root.innerHTML = `
      <table class="pr-table">
        <thead><tr><td><div class="pr-sp-top"></div></td></tr></thead>
        <tfoot><tr><td><div class="pr-sp-bot"></div></td></tr></tfoot>
        <tbody class="pr-cover-body"><tr class="pr-row"><td>${cover}</td></tr></tbody>
        ${items.map((z) => taskHtml(z, opts)).join('')}
      </table>
      <footer class="pr-footer">
        <img src="img/logo-stopka.png" alt="Szkoła Komórki">
        <span>szkolakomorki.pl · Treści zadań pochodzą z arkuszy CKE</span>
      </footer>`;
    return root;
  }

  function waitForImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    return Promise.all(imgs.map((img) => {
      img.loading = 'eager';
      if (img.complete) return null;
      return new Promise((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 10000);                  // nie blokuj wydruku w nieskończoność
      });
    }));
  }

  let cleanupPrint = null;

  async function printItems(items, opts, scope) {
    if (cleanupPrint) cleanupPrint();

    const root = buildPrintRoot(items, opts, scope);
    document.body.appendChild(root);

    // @page tylko na czas wydruku, żeby nie zmieniać zwykłego drukowania innych stron
    const pageStyle = document.createElement('style');
    pageStyle.id = 'print-page-style';
    pageStyle.textContent = '@page { size: A4; margin: 0; }';
    document.head.appendChild(pageStyle);

    const oldTitle = document.title;
    document.title = 'Szkola Komorki - zadania z biologii';

    cleanupPrint = function () {
      window.removeEventListener('afterprint', cleanupPrint);
      root.remove();
      pageStyle.remove();
      document.body.classList.remove('printing');
      document.title = oldTitle;
      cleanupPrint = null;
    };
    window.addEventListener('afterprint', cleanupPrint);

    try {
      await waitForImages(root);
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) {} }
    } catch (_) {}

    document.body.classList.add('printing');
    window.print();
  }

  // ── Integracja z listą ────────────────────────────────────
  // Wywoływane z zadania.js po każdym wyrenderowaniu listy (nowa strona / filtry).
  window.printOnListRendered = function () {
    sel = new Set();
    if (isOpen()) { refreshPagePane(); }
  };

  registerActions({
    printOpen:  () => openModal(),
    printClose: () => closeModal(),
    printTab:   (el) => setTab(el.dataset.tab),
    printPick:  (el) => {
      const idx = parseInt(el.dataset.idx, 10);
      if (!(idx >= 0)) return;
      if (el.checked) sel.add(idx); else sel.delete(idx);
      if (isOpen()) { syncRangeField(); refreshPagePane(true); }
    },
    printSelectAll:  () => {
      sel = new Set(state.items.map((_, i) => i));
      syncCheckboxes(); syncRangeField(); refreshPagePane();
    },
    printSelectNone: () => {
      sel = new Set();
      syncCheckboxes(); syncRangeField(); refreshPagePane();
    },
    printGo: () => { doPrint(); },

    printDzial: (el) => {
      const id = el.dataset.id;
      if (!KATEGORIE_MAP[id]) return;
      const idx = pf.dzialy.indexOf(id);
      if (idx === -1) {
        pf.dzialy.push(id);
        const parent = KATEGORIE.find((k) => k.sub.some((s) => s.id === id));
        if (parent) pfExpanded.add(parent.id);
        const kat = KATEGORIE.find((k) => k.id === id);
        if (kat && kat.sub.length) pfExpanded.add(id);
      } else {
        pf.dzialy.splice(idx, 1);
      }
      onFiltersChanged();
    },
    printKatExpand: (el) => {
      const id = el.dataset.id;
      if (!KATEGORIE_MAP[id]) return;
      if (pfExpanded.has(id)) pfExpanded.delete(id); else pfExpanded.add(id);
      renderFilters();
    },
    printSet: (el) => {
      const field = el.dataset.field, val = el.dataset.val || '';
      const allowed = {
        typ:       (v) => v === '' || v === 'zamkniete' || v === 'otwarte',
        kategoria: (v) => v === '' || Object.prototype.hasOwnProperty.call(KATEGORIA_LABELS, v),
        formula:   (v) => v === '' || Object.prototype.hasOwnProperty.call(FORMULA_LABELS, v),
        poziom:    (v) => v === '' || Object.prototype.hasOwnProperty.call(POZIOM_LABELS, v),
      };
      if (!allowed[field] || !allowed[field](val)) return;
      pf[field] = val;
      onFiltersChanged();
    },
    printSetRok: (el) => {
      const v = el.value;
      pf.rok = /^\d{4}$/.test(v) ? v : '';
      onFiltersChanged();
    },
    printClearFilters: () => {
      pf = emptyFilters();
      onFiltersChanged();
    },
  });
})();
