// Panel administracyjny — logika dodawania i edycji zadań
// Wymaga: config.js, auth.js, Quill CDN, Supabase CDN

let adminSession = null;
let editingId    = null;
let qTresc, qKlucz, qOpr;

// ── Rejestracja blota "linie odpowiedzi" ─────────────────────
(function registerAnswerLinesBlot() {
  const BlockEmbed = Quill.import('blots/block/embed');
  class AnswerLinesBlot extends BlockEmbed {
    static create(rows) {
      const node = super.create();
      node.setAttribute('data-rows', rows);
      node.setAttribute('contenteditable', 'false');
      for (let i = 0; i < rows; i++) {
        const line = document.createElement('div');
        line.className = 'answer-line';
        node.appendChild(line);
      }
      return node;
    }
    static value(node) {
      const stored = node.getAttribute('data-rows');
      if (stored) return parseInt(stored, 10);
      return node.querySelectorAll('.answer-line').length || 3;
    }
  }
  AnswerLinesBlot.blotName  = 'answerLines';
  AnswerLinesBlot.tagName   = 'div';
  AnswerLinesBlot.className = 'answer-lines';
  Quill.register(AnswerLinesBlot);
})();

// ── Własny blot tabeli (bez zewnętrznych bibliotek) ──────────
(function registerTableBlot() {
  const BlockEmbed = Quill.import('blots/block/embed');

  class TableBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.setAttribute('contenteditable', 'false');
      node.innerHTML = typeof value === 'string'
        ? value
        : TableBlot._buildHtml(value.rows || 3, value.cols || 3);
      TableBlot._setup(node);
      return node;
    }

    static value(node) { return node.innerHTML; }

    static _buildHtml(rows, cols) {
      const cell = '<td contenteditable="true"><br></td>';
      const row  = '<tr>' + cell.repeat(cols) + '</tr>';
      return '<table class="ql-custom-table"><tbody>' + row.repeat(rows) + '</tbody></table>';
    }

    static _setup(node) {
      const table = node.querySelector('table');
      if (!table) return;
      table.className = 'ql-custom-table';
      table.querySelectorAll('td, th').forEach(c => c.setAttribute('contenteditable', 'true'));

      table.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const cell = e.target.closest('td, th');
        if (!cell || !cell.closest('.ql-custom-table')) return;

        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd+klik → przełącz zaznaczenie tej komórki
          e.preventDefault();
          cell.classList.toggle('ql-cell-sel');
          if (cell.classList.contains('ql-cell-sel')) table._selStart = cell;
        } else if (e.shiftKey && table._selStart) {
          // Shift+klik → prostokąt od punktu startowego do tej komórki
          e.preventDefault();
          table.querySelectorAll('.ql-cell-sel').forEach(c => c.classList.remove('ql-cell-sel'));
          TableBlot._selRange(table, table._selStart, cell);
        } else {
          // Zwykły klik → odznacz wszystko i zaznacz tylko tę komórkę
          // (klik na już zaznaczoną jedyną komórkę → odznacz)
          const sel = table.querySelectorAll('.ql-cell-sel');
          const alreadySingle = sel.length === 1 && sel[0] === cell;
          sel.forEach(c => c.classList.remove('ql-cell-sel'));
          if (!alreadySingle) {
            cell.classList.add('ql-cell-sel');
            table._selStart = cell;
            _tableDragging = table;
          } else {
            table._selStart = null;
          }
        }
      });

      table.addEventListener('mouseover', (e) => {
        if (_tableDragging !== table || !table._selStart) return;
        const cell = e.target.closest('td, th');
        if (!cell) return;
        table.querySelectorAll('.ql-cell-sel').forEach(c => c.classList.remove('ql-cell-sel'));
        TableBlot._selRange(table, table._selStart, cell);
      });

      table.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        _showTableCtx(e.clientX, e.clientY, table);
      });
    }

    static _selRange(table, a, b) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const rA = rows.indexOf(a.parentElement), cA = Array.from(a.parentElement.children).indexOf(a);
      const rB = rows.indexOf(b.parentElement), cB = Array.from(b.parentElement.children).indexOf(b);
      for (let r = Math.min(rA,rB); r <= Math.max(rA,rB); r++) {
        const cells = Array.from(rows[r].children);
        for (let c = Math.min(cA,cB); c <= Math.max(cA,cB); c++) {
          if (cells[c]) cells[c].classList.add('ql-cell-sel');
        }
      }
    }
  }

  TableBlot.blotName  = 'customTable';
  TableBlot.tagName   = 'div';
  TableBlot.className = 'ql-table-wrap';
  Quill.register(TableBlot);
})();

// ── Stan popupów ─────────────────────────────────────────────
let _activeInsertQuill = null;
let _answerRowCount    = 3;
let _tableRows         = 3;
let _tableCols         = 3;
let _tableDragging     = null;

document.addEventListener('mouseup', () => { _tableDragging = null; });

// Kliknięcie poza tabelą i menu kontekstowym → odznacz wszystkie komórki
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.ql-custom-table') && !e.target.closest('.ql-table-ctx')) {
    document.querySelectorAll('.ql-cell-sel').forEach(c => c.classList.remove('ql-cell-sel'));
  }
});

const TOOLBAR = [
  [{ header: [2, 3, false] }],
  ['bold', 'italic', 'underline', 'link'],
  [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
  ['image', 'answerLines', 'insertTable'],
  ['clean'],
];

async function initAdminPage() {
  adminSession = await requireAdmin();
  if (!adminSession) return;

  initEditors();
  buildDzialyPicker();
  loadAdminTasks();

  document.getElementById('task-form').addEventListener('submit', handleFormSubmit);

  initPodrecznikAdmin();
}

// ── Quill editors ─────────────────────────────────────────────
function initEditors() {
  const makeModules = (getQ) => ({
    toolbar: { container: TOOLBAR, handlers: {
      image:       makeImageHandler(getQ),
      answerLines: makeAnswerLinesHandler(getQ),
      insertTable: makeInsertTableHandler(getQ),
    } },
  });

  qTresc = new Quill('#ql-tresc', { theme: 'snow', modules: makeModules(() => qTresc), placeholder: 'Pełna treść zadania z arkusza CKE…' });
  qKlucz = new Quill('#ql-klucz', { theme: 'snow', modules: makeModules(() => qKlucz), placeholder: 'Klucz odpowiedzi / schemat oceniania CKE…' });
  qOpr   = new Quill('#ql-opr',   { theme: 'snow', modules: makeModules(() => qOpr),   placeholder: 'Szczegółowe wyjaśnienie rozwiązania, konteksty, wskazówki…' });
}

const IMAGE_EXT_BY_MIME = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif':  'gif',
};
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function makeImageHandler(getQ) {
  return function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = Object.keys(IMAGE_EXT_BY_MIME).join(',');
    input.click();

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      // Zgodne z ograniczeniami bucketu (SVG celowo niedozwolony — może zawierać skrypty)
      if (!IMAGE_EXT_BY_MIME[file.type]) {
        alert('Dozwolone formaty: PNG, JPEG, WebP, GIF.');
        return;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        alert('Plik jest za duży (maksymalnie 5 MB).');
        return;
      }

      const q = getQ();
      const range = q.getSelection(true);
      const placeholder = '⏳ wczytywanie…';
      q.insertText(range.index, placeholder, 'user');

      const ext  = IMAGE_EXT_BY_MIME[file.type];
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const { error } = await _supabase.storage
        .from('zadania-images')
        .upload(path, file, { contentType: file.type });

      q.deleteText(range.index, placeholder.length);

      if (error) {
        alert('Błąd przesyłania obrazu: ' + error.message);
        return;
      }

      const { data } = _supabase.storage.from('zadania-images').getPublicUrl(path);
      q.insertEmbed(range.index, 'image', data.publicUrl, 'user');
      q.setSelection(range.index + 1, 0, 'user');
    };
  };
}

function makeAnswerLinesHandler(getQ) {
  return function () {
    _activeInsertQuill = getQ();
    const toolbar = _activeInsertQuill.getModule('toolbar');
    const btn = toolbar.container.querySelector('.ql-answerLines');
    showAnswerLinesPopup(btn);
  };
}

function showAnswerLinesPopup(triggerEl) {
  const popup = document.getElementById('ql-answer-popup');
  const rect  = triggerEl.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = rect.left + 'px';
  document.getElementById('ql-answer-count').textContent = _answerRowCount;
  popup.style.display = 'flex';

  setTimeout(() => {
    document.addEventListener('click', _closePopupOnOutside, { once: true });
  }, 0);
}

function _closePopupOnOutside(e) {
  const popup = document.getElementById('ql-answer-popup');
  if (popup && !popup.contains(e.target)) {
    popup.style.display = 'none';
  } else if (popup) {
    document.addEventListener('click', _closePopupOnOutside, { once: true });
  }
}

window.changeAnswerRows = function (delta) {
  _answerRowCount = Math.max(1, Math.min(20, _answerRowCount + delta));
  document.getElementById('ql-answer-count').textContent = _answerRowCount;
};

window.confirmAnswerLines = function () {
  if (!_activeInsertQuill) return;
  const range = _activeInsertQuill.getSelection(true);
  const index = range ? range.index : _activeInsertQuill.getLength() - 1;
  _activeInsertQuill.insertEmbed(index, 'answerLines', _answerRowCount, 'user');
  _activeInsertQuill.setSelection(index + 1, 0, 'user');
  document.getElementById('ql-answer-popup').style.display = 'none';
};

window.closeAnswerLinesPopup = function () {
  document.getElementById('ql-answer-popup').style.display = 'none';
};

// ── Tabele ────────────────────────────────────────────────────
function makeInsertTableHandler(getQ) {
  return function () {
    _activeInsertQuill = getQ();
    const toolbar = _activeInsertQuill.getModule('toolbar');
    const btn = toolbar.container.querySelector('.ql-insertTable');
    showTablePopup(btn);
  };
}

function showTablePopup(triggerEl) {
  const popup = document.getElementById('ql-table-popup');
  const rect  = triggerEl.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = rect.left + 'px';
  document.getElementById('ql-table-rows').textContent = _tableRows;
  document.getElementById('ql-table-cols').textContent = _tableCols;
  popup.style.display = 'flex';
  setTimeout(() => {
    document.addEventListener('click', _closeTableOnOutside, { once: true });
  }, 0);
}

function _closeTableOnOutside(e) {
  const popup = document.getElementById('ql-table-popup');
  if (popup && !popup.contains(e.target)) {
    popup.style.display = 'none';
  } else if (popup) {
    document.addEventListener('click', _closeTableOnOutside, { once: true });
  }
}

window.changeTableDim = function (dim, delta) {
  if (dim === 'rows') {
    _tableRows = Math.max(1, Math.min(20, _tableRows + delta));
    document.getElementById('ql-table-rows').textContent = _tableRows;
  } else {
    _tableCols = Math.max(1, Math.min(10, _tableCols + delta));
    document.getElementById('ql-table-cols').textContent = _tableCols;
  }
};

window.confirmInsertTable = function () {
  if (!_activeInsertQuill) return;
  const range = _activeInsertQuill.getSelection(true);
  const index = range ? range.index : 0;
  _activeInsertQuill.insertEmbed(index, 'customTable', { rows: _tableRows, cols: _tableCols }, 'user');
  _activeInsertQuill.setSelection(index + 1, 0, 'user');
  document.getElementById('ql-table-popup').style.display = 'none';
};

window.closeTablePopup = function () {
  document.getElementById('ql-table-popup').style.display = 'none';
};

// ── Menu kontekstowe tabeli ───────────────────────────────────
let _ctxTable = null;

function _showTableCtx(x, y, table) {
  _ctxTable = table;
  let menu = document.getElementById('ql-table-ctx');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'ql-table-ctx';
    menu.className = 'ql-table-ctx';
    menu.innerHTML = `
      <button data-click="tblCmd" data-cmd="row-above">Dodaj wiersz powyżej</button>
      <button data-click="tblCmd" data-cmd="row-below">Dodaj wiersz poniżej</button>
      <button data-click="tblCmd" data-cmd="col-left">Dodaj kolumnę w lewo</button>
      <button data-click="tblCmd" data-cmd="col-right">Dodaj kolumnę w prawo</button>
      <hr style="border:none;border-top:1px solid rgba(0,0,0,.1);margin:3px 0">
      <button data-click="tblCmd" data-cmd="del-row" style="color:#8b2020">Usuń wiersz</button>
      <button data-click="tblCmd" data-cmd="del-col" style="color:#8b2020">Usuń kolumnę</button>
      <hr style="border:none;border-top:1px solid rgba(0,0,0,.1);margin:3px 0">
      <button data-click="tblCmd" data-cmd="merge">Scal zaznaczone komórki</button>
      <button data-click="tblCmd" data-cmd="unmerge">Rozdziel komórkę</button>`;
    document.body.appendChild(menu);
    document.addEventListener('click', () => { if (menu) menu.style.display = 'none'; }, true);
  }
  menu.style.cssText = `display:block;position:fixed;top:${y}px;left:${x}px`;
}

window._tblCmd = function (cmd) {
  const menu = document.getElementById('ql-table-ctx');
  if (menu) menu.style.display = 'none';
  if (!_ctxTable) return;

  const sel   = Array.from(_ctxTable.querySelectorAll('.ql-cell-sel'));
  const focus = sel[0] || _ctxTable.querySelector('td, th');
  if (!focus) return;

  const rows   = Array.from(_ctxTable.querySelectorAll('tr'));
  const tr     = focus.parentElement;
  const rowIdx = rows.indexOf(tr);
  const cells  = Array.from(tr.children);
  const colIdx = cells.indexOf(focus);
  const colCnt = _ctxTable.querySelector('tr')?.children.length || 1;

  const mkCell = () => { const td = document.createElement('td'); td.setAttribute('contenteditable','true'); td.innerHTML='<br>'; return td; };
  const mkRow  = (n) => { const r = document.createElement('tr'); for(let i=0;i<n;i++) r.appendChild(mkCell()); return r; };

  if (cmd === 'row-above')        tr.parentElement.insertBefore(mkRow(colCnt), tr);
  else if (cmd === 'row-below')   tr.parentElement.insertBefore(mkRow(colCnt), tr.nextSibling);
  else if (cmd === 'col-left')    rows.forEach(r => r.insertBefore(mkCell(), r.children[colIdx]));
  else if (cmd === 'col-right')   rows.forEach(r => { const ref = r.children[colIdx+1]; if(ref) r.insertBefore(mkCell(),ref); else r.appendChild(mkCell()); });
  else if (cmd === 'del-row'  && rows.length > 1) tr.remove();
  else if (cmd === 'del-col'  && colCnt > 1)      rows.forEach(r => { if(r.children[colIdx]) r.children[colIdx].remove(); });
  else if (cmd === 'merge'    && sel.length >= 2)  _tblMerge(sel);
  else if (cmd === 'unmerge')                      _tblUnmerge(focus, rows);

  sel.forEach(c => c.classList.remove('ql-cell-sel'));
};

function _tblMerge(sel) {
  const rows = Array.from(sel[0].closest('table').querySelectorAll('tr'));
  let r1=Infinity, r2=-Infinity, c1=Infinity, c2=-Infinity;
  sel.forEach(cell => {
    const ri = rows.indexOf(cell.parentElement);
    const ci = Array.from(cell.parentElement.children).indexOf(cell);
    if(ri<r1) r1=ri; if(ri>r2) r2=ri; if(ci<c1) c1=ci; if(ci>c2) c2=ci;
  });
  const first = rows[r1].children[c1];
  if(!first) return;
  const cs = c2-c1+1, rs = r2-r1+1;
  if(cs>1) first.setAttribute('colspan', cs); else first.removeAttribute('colspan');
  if(rs>1) first.setAttribute('rowspan', rs); else first.removeAttribute('rowspan');
  first.style.textAlign    = 'center';
  first.style.verticalAlign = 'middle';
  sel.forEach(c => { if(c !== first) c.remove(); });
}

function _tblUnmerge(cell, rows) {
  const cs = parseInt(cell.getAttribute('colspan')||1);
  const rs = parseInt(cell.getAttribute('rowspan')||1);
  cell.removeAttribute('colspan'); cell.removeAttribute('rowspan');
  const ri = rows.indexOf(cell.parentElement);
  const ci = Array.from(cell.parentElement.children).indexOf(cell);
  const mkCell = () => { const td = document.createElement('td'); td.setAttribute('contenteditable','true'); td.innerHTML='<br>'; return td; };
  for(let r=ri; r<ri+rs; r++) {
    for(let c=(r===ri?ci+1:ci); c<ci+cs; c++) {
      const ref = rows[r]?.children[c];
      if(ref) rows[r].insertBefore(mkCell(), ref);
      else    rows[r]?.appendChild(mkCell());
    }
  }
}

function getHtml(q) {
  const html = q.root.innerHTML.trim();
  if (html === '<p><br></p>' || html === '') return '';
  return html;
}

function setHtml(q, html) {
  if (html) {
    q.clipboard.dangerouslyPasteHTML(html);
  } else {
    q.setText('');
  }
}

// ── Działy picker ────────────────────────────────────────────
let selectedDzialy = [];

function buildDzialyPicker() {
  const el = document.getElementById('dzialy-picker');
  el.innerHTML = KATEGORIE.map(kat => {
    const mainSel = selectedDzialy.includes(kat.id);
    const subHtml = kat.sub.length ? `
      <div class="dzialy-sub-group">
        ${kat.sub.map(s => {
          const subSel = selectedDzialy.includes(s.id);
          return `<span class="dzial-pick dzial-pick--sub ${subSel ? 'selected' : ''}"
                        data-click="toggleAdminDzial" data-id="${escAdm(s.id)}">${escAdm(s.label)}</span>`;
        }).join('')}
      </div>` : '';
    return `<div class="dzialy-group">
      <span class="dzial-pick dzial-pick--main ${mainSel ? 'selected' : ''}"
            data-click="toggleAdminDzial" data-id="${escAdm(kat.id)}">${escAdm(kat.label)}</span>
      ${subHtml}
    </div>`;
  }).join('');
}

function toggleAdminDzial(d) {
  const idx = selectedDzialy.indexOf(d);
  if (idx === -1) selectedDzialy.push(d);
  else            selectedDzialy.splice(idx, 1);
  buildDzialyPicker();
}

window.toggleAdminDzial = toggleAdminDzial;

// ── Form submit ──────────────────────────────────────────────
async function handleFormSubmit(e) {
  e.preventDefault();
  const form     = e.target;
  const submitBtn = form.querySelector('[type="submit"]');
  const msgEl    = document.getElementById('form-msg');

  clearMsg(msgEl);

  const tresc = getHtml(qTresc);
  const klucz = getHtml(qKlucz);

  if (!form.rok.value || !form.numer_zadania.value.trim() || !tresc || !klucz) {
    showMsg(msgEl, 'Wypełnij wszystkie wymagane pola (rok, numer, treść, klucz).', 'error');
    return;
  }

  submitBtn.textContent = 'Zapisywanie…';
  submitBtn.disabled = true;

  const payload = {
    rok:           parseInt(form.rok.value),
    numer_zadania: form.numer_zadania.value.trim(),
    tresc_zadania: tresc,
    klucz_cke:     klucz,
    opracowanie:   getHtml(qOpr) || null,
    dzialy:        selectedDzialy,
    typ:           form.typ.value,
    kategoria:     form.kategoria.value   || null,
    formula:       form.formula.value     || null,
    poziom:        form.poziom.value      || null,
  };

  let result;
  if (editingId) {
    result = await _supabase.from('zadania').update(payload).eq('id', editingId);
  } else {
    result = await _supabase.from('zadania').insert([payload]);
  }

  submitBtn.textContent = editingId ? 'Zapisz zmiany' : 'Dodaj zadanie';
  submitBtn.disabled = false;

  if (result.error) {
    showMsg(msgEl, 'Błąd: ' + result.error.message, 'error');
    return;
  }

  showMsg(msgEl, editingId ? 'Zadanie zaktualizowane!' : 'Zadanie dodane!', 'success');
  resetForm();
  loadAdminTasks();
}

function resetForm() {
  editingId = null;
  const form = document.getElementById('task-form');
  form.reset();
  // form.reset() czyści selecty — przywróć domyślny poziom
  form.poziom.value = 'rozszerzony';
  setHtml(qTresc, '');
  setHtml(qKlucz, '');
  setHtml(qOpr, '');
  selectedDzialy = [];
  buildDzialyPicker();
  document.getElementById('form-title').textContent = 'Dodaj nowe zadanie';
  document.querySelector('[type="submit"]').textContent = 'Dodaj zadanie';
  document.getElementById('btn-cancel-edit').classList.add('hidden');
}

window.cancelEdit = function () { resetForm(); };

// ── Load tasks list ──────────────────────────────────────────
async function loadAdminTasks() {
  const el = document.getElementById('admin-task-list');
  el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Ładowanie…</p>';

  const { data, error } = await _supabase
    .from('zadania')
    .select('id, rok, numer_zadania, typ, kategoria, formula, poziom, dzialy, opracowanie')
    .order('data_dodania', { ascending: false })
    .limit(50);

  if (error) {
    el.innerHTML = '<p style="color:#8b2020;font-size:13px">Błąd ładowania zadań.</p>';
    return;
  }

  if (!data.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Brak zadań w bazie.</p>';
    return;
  }

  el.innerHTML = data.map(z => {
    const metaBits = [
      z.typ,
      z.kategoria ? KATEGORIA_LABELS[z.kategoria] || z.kategoria : null,
      z.formula   ? FORMULA_LABELS[z.formula]     || z.formula   : null,
      z.poziom    ? POZIOM_LABELS[z.poziom]        || z.poziom    : null,
    ].filter(Boolean).join(' · ');
    return `
    <div class="admin-task-item">
      <div class="admin-task-info">
        <strong>Rok ${z.rok} · Zad. ${escAdm(z.numer_zadania)}</strong>
        <span style="color:var(--text-muted);margin-left:8px;font-size:12px">${escAdm(metaBits)}</span>
        ${z.opracowanie ? '<span style="color:var(--forest);margin-left:6px;font-size:11px">+ opracowanie</span>' : ''}
      </div>
      <div class="admin-task-actions">
        <button class="btn btn-ghost btn-sm" data-click="editTask" data-id="${escAdm(z.id)}">Edytuj</button>
        <button class="btn btn-ghost btn-sm" style="color:#8b2020" data-click="deleteTask" data-id="${escAdm(z.id)}" data-label="${escAdm(z.rok + '-' + z.numer_zadania)}">Usuń</button>
      </div>
    </div>`;
  }).join('');
}

// ── Edit ─────────────────────────────────────────────────────
window.editTask = async function (id) {
  const { data, error } = await _supabase.from('zadania').select('*').eq('id', id).single();
  if (error || !data) { alert('Błąd ładowania zadania.'); return; }

  editingId = id;
  const form = document.getElementById('task-form');
  form.rok.value           = data.rok;
  form.numer_zadania.value = data.numer_zadania;
  form.typ.value           = data.typ;
  form.kategoria.value     = data.kategoria || '';
  form.formula.value       = data.formula   || '';
  form.poziom.value        = data.poziom    || '';

  setHtml(qTresc, data.tresc_zadania || '');
  setHtml(qKlucz, data.klucz_cke || '');
  setHtml(qOpr,   data.opracowanie || '');

  selectedDzialy = data.dzialy || [];
  buildDzialyPicker();

  document.getElementById('form-title').textContent = 'Edytuj zadanie';
  document.querySelector('[type="submit"]').textContent = 'Zapisz zmiany';
  document.getElementById('btn-cancel-edit').classList.remove('hidden');

  form.scrollIntoView({ behavior: 'smooth' });
};

// ── Delete ────────────────────────────────────────────────────
window.deleteTask = async function (id, label) {
  if (!confirm(`Usuń zadanie "${label}"?`)) return;
  const { error } = await _supabase.from('zadania').delete().eq('id', id);
  if (error) { alert('Błąd usuwania: ' + error.message); return; }
  loadAdminTasks();
};

// ── Helpers ───────────────────────────────────────────────────
function escAdm(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = 'form-message ' + type;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function clearMsg(el) {
  el.textContent = '';
  el.style.display = 'none';
}

// =====================================================================
// PODRĘCZNIK — zagadnienia teoretyczne (całkowicie niezależne od
// formularza zadań powyżej — osobny stan, osobny edytor, osobna tabela).
// =====================================================================
let qPodr;
let editingPodrId     = null;
let selectedDzialyPodr = [];

function initPodrecznikAdmin() {
  const mount = document.getElementById('ql-podr');
  if (!mount) return; // formularz podręcznika nieobecny na tej stronie

  qPodr = new Quill('#ql-podr', {
    theme: 'snow',
    modules: { toolbar: { container: TOOLBAR, handlers: {
      image:       makeImageHandler(() => qPodr),
      answerLines: makeAnswerLinesHandler(() => qPodr),
      insertTable: makeInsertTableHandler(() => qPodr),
    } } },
    placeholder: 'Treść zagadnienia — teoria, definicje, mechanizmy, ilustracje…',
  });

  buildDzialyPickerPodr();
  loadAdminPodrecznik();
  document.getElementById('podr-form').addEventListener('submit', handlePodrFormSubmit);
}

function buildDzialyPickerPodr() {
  const el = document.getElementById('dzialy-picker-podr');
  if (!el) return;
  el.innerHTML = KATEGORIE.map(kat => {
    const mainSel = selectedDzialyPodr.includes(kat.id);
    const subHtml = kat.sub.length ? `
      <div class="dzialy-sub-group">
        ${kat.sub.map(s => {
          const subSel = selectedDzialyPodr.includes(s.id);
          return `<span class="dzial-pick dzial-pick--sub ${subSel ? 'selected' : ''}"
                        data-click="toggleAdminDzialPodr" data-id="${escAdm(s.id)}">${escAdm(s.label)}</span>`;
        }).join('')}
      </div>` : '';
    return `<div class="dzialy-group">
      <span class="dzial-pick dzial-pick--main ${mainSel ? 'selected' : ''}"
            data-click="toggleAdminDzialPodr" data-id="${escAdm(kat.id)}">${escAdm(kat.label)}</span>
      ${subHtml}
    </div>`;
  }).join('');
}

function toggleAdminDzialPodr(d) {
  const idx = selectedDzialyPodr.indexOf(d);
  if (idx === -1) selectedDzialyPodr.push(d);
  else            selectedDzialyPodr.splice(idx, 1);
  buildDzialyPickerPodr();
}
window.toggleAdminDzialPodr = toggleAdminDzialPodr;

async function handlePodrFormSubmit(e) {
  e.preventDefault();
  const form      = e.target;
  const submitBtn = form.querySelector('[type="submit"]');
  const msgEl     = document.getElementById('podr-form-msg');

  clearMsg(msgEl);

  const tytul = form.tytul.value.trim();
  const tresc = getHtml(qPodr);

  if (!tytul || !selectedDzialyPodr.length || !tresc) {
    showMsg(msgEl, 'Wypełnij tytuł, wybierz co najmniej jeden dział i uzupełnij treść.', 'error');
    return;
  }

  submitBtn.textContent = 'Zapisywanie…';
  submitBtn.disabled = true;

  const payload = { tytul, dzialy: selectedDzialyPodr, tresc };

  let result;
  if (editingPodrId) {
    result = await _supabase.from('podrecznik').update(payload).eq('id', editingPodrId);
  } else {
    result = await _supabase.from('podrecznik').insert([payload]);
  }

  submitBtn.textContent = editingPodrId ? 'Zapisz zmiany' : 'Dodaj zagadnienie';
  submitBtn.disabled = false;

  if (result.error) {
    showMsg(msgEl, 'Błąd: ' + result.error.message, 'error');
    return;
  }

  showMsg(msgEl, editingPodrId ? 'Zagadnienie zaktualizowane!' : 'Zagadnienie dodane!', 'success');
  resetPodrForm();
  loadAdminPodrecznik();
}

function resetPodrForm() {
  editingPodrId = null;
  const form = document.getElementById('podr-form');
  form.reset();
  setHtml(qPodr, '');
  selectedDzialyPodr = [];
  buildDzialyPickerPodr();
  document.getElementById('podr-form-title').textContent = 'Dodaj zagadnienie do podręcznika';
  form.querySelector('[type="submit"]').textContent = 'Dodaj zagadnienie';
  document.getElementById('btn-cancel-edit-podr').classList.add('hidden');
}

window.cancelEditPodr = function () { resetPodrForm(); };

async function loadAdminPodrecznik() {
  const el = document.getElementById('admin-podrecznik-list');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Ładowanie…</p>';

  const { data, error } = await _supabase
    .from('podrecznik')
    .select('id, tytul, dzialy, data_dodania')
    .order('data_dodania', { ascending: false })
    .limit(50);

  if (error) {
    el.innerHTML = '<p style="color:#8b2020;font-size:13px">Błąd ładowania zagadnień.</p>';
    return;
  }

  if (!data.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Brak zagadnień w podręczniku.</p>';
    return;
  }

  el.innerHTML = data.map(p => {
    const dzialyLabel = (p.dzialy || []).map(d => getLabelForId(d)).join(', ');
    return `
    <div class="admin-task-item">
      <div class="admin-task-info">
        <strong>${escAdm(p.tytul)}</strong>
        <span style="color:var(--text-muted);margin-left:8px;font-size:12px">${escAdm(dzialyLabel)}</span>
      </div>
      <div class="admin-task-actions">
        <button class="btn btn-ghost btn-sm" data-click="copyPodrLink" data-id="${escAdm(p.id)}">Kopiuj link</button>
        <button class="btn btn-ghost btn-sm" data-click="editPodr" data-id="${escAdm(p.id)}">Edytuj</button>
        <button class="btn btn-ghost btn-sm" style="color:#8b2020" data-click="deletePodr" data-id="${escAdm(p.id)}" data-label="${escAdm(p.tytul)}">Usuń</button>
      </div>
    </div>`;
  }).join('');
}

window.copyPodrLink = function (id) {
  const base = window.location.href.replace(/admin\.html.*$/, '');
  const url  = base + 'podrecznik.html?z=' + id;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => alert('Link do zagadnienia skopiowany:\n' + url),
      () => prompt('Skopiuj link ręcznie:', url)
    );
  } else {
    prompt('Skopiuj link ręcznie:', url);
  }
};

window.editPodr = async function (id) {
  const { data, error } = await _supabase.from('podrecznik').select('*').eq('id', id).single();
  if (error || !data) { alert('Błąd ładowania zagadnienia.'); return; }

  editingPodrId = id;
  const form = document.getElementById('podr-form');
  form.tytul.value = data.tytul;
  setHtml(qPodr, data.tresc || '');
  selectedDzialyPodr = data.dzialy || [];
  buildDzialyPickerPodr();

  document.getElementById('podr-form-title').textContent = 'Edytuj zagadnienie';
  form.querySelector('[type="submit"]').textContent = 'Zapisz zmiany';
  document.getElementById('btn-cancel-edit-podr').classList.remove('hidden');

  form.scrollIntoView({ behavior: 'smooth' });
};

window.deletePodr = async function (id, label) {
  if (!confirm(`Usuń zagadnienie "${label}"?`)) return;
  const { error } = await _supabase.from('podrecznik').delete().eq('id', id);
  if (error) { alert('Błąd usuwania: ' + error.message); return; }
  loadAdminPodrecznik();
};

// ── Akcje (data-click w HTML, patrz actions.js) ──
registerActions({
  cancelEdit:            () => window.cancelEdit(),
  cancelEditPodr:        () => window.cancelEditPodr(),
  changeAnswerRows:      (el) => window.changeAnswerRows(parseInt(el.dataset.delta, 10)),
  confirmAnswerLines:    () => window.confirmAnswerLines(),
  closeAnswerLinesPopup: () => window.closeAnswerLinesPopup(),
  changeTableDim:        (el) => window.changeTableDim(el.dataset.dim === 'rows' ? 'rows' : 'cols', parseInt(el.dataset.delta, 10)),
  confirmInsertTable:    () => window.confirmInsertTable(),
  closeTablePopup:       () => window.closeTablePopup(),
  tblCmd:                (el) => window._tblCmd(el.dataset.cmd),
  toggleAdminDzial:      (el) => toggleAdminDzial(el.dataset.id),
  toggleAdminDzialPodr:  (el) => toggleAdminDzialPodr(el.dataset.id),
  editTask:              (el) => window.editTask(el.dataset.id),
  deleteTask:            (el) => window.deleteTask(el.dataset.id, el.dataset.label),
  copyPodrLink:          (el) => window.copyPodrLink(el.dataset.id),
  editPodr:              (el) => window.editPodr(el.dataset.id),
  deletePodr:            (el) => window.deletePodr(el.dataset.id, el.dataset.label),
});
