const CONFIG = {
  supabase: {
    url:     'https://dtfkjtsjubfxsahrgkua.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0ZmtqdHNqdWJmeHNhaHJna3VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTgwOTcsImV4cCI6MjEwNDQzNDA5N30.8GJKk3CVOT5mtRY5teAjZMcyvzdkI7BzdgdJCKjtMqE',
  },
  app: {
    pageSize: 20,
    // Adres, pod którym strona jest aktualnie otwarta (localhost albo domena produkcyjna).
    // Używany do powrotów ze Stripe i do linków w e-mailach. Katalog ze strony zachowujemy,
    // więc działa też, gdy strona stoi w podkatalogu (np. github.io/repo/).
    siteUrl:  window.location.origin + window.location.pathname.replace(/\/[^/]*$/, ''),
  },
};

// ── Hierarchia kategorii ─────────────────────────────────────
const KATEGORIE = [
  { id: 'chemizm',        label: 'Chemizm',        sub: [] },
  { id: 'budowa_komorki', label: 'Budowa komórki', sub: [] },
  { id: 'metabolizm',     label: 'Metabolizm',     sub: [] },
  { id: 'wirusy',         label: 'Wirusy',         sub: [] },
  { id: 'bakterie',       label: 'Bakterie',       sub: [] },
  { id: 'grzyby',         label: 'Grzyby',         sub: [] },
  { id: 'protisty',       label: 'Protisty',       sub: [] },
  { id: 'rosliny', label: 'Rośliny', sub: [
    { id: 'tkanki_roslinne',           label: 'tkanki roślinne' },
    { id: 'budowa_rozmnazanie_roslin', label: 'budowa i rozmnażanie roślin' },
    { id: 'fizjologia_roslin',         label: 'fizjologia roślin' },
  ]},
  { id: 'bezkregowce', label: 'Bezkręgowce', sub: [
    { id: 'gabki',            label: 'gąbki' },
    { id: 'parzydelkowce',    label: 'parzydełkowce' },
    { id: 'plazince',         label: 'płazińce' },
    { id: 'nicienie',         label: 'nicienie' },
    { id: 'pierscenice',      label: 'pierścienice' },
    { id: 'mieczaki',         label: 'mięczaki' },
    { id: 'stawonogi',        label: 'stawonogi' },
    { id: 'szkarłupnie',      label: 'szkarłupnie' },
    { id: 'bezczaszkowce',    label: 'bezczaszkowce' },
    { id: 'bezkregowce_inne', label: 'bezkręgowce - inne' },
  ]},
  { id: 'kregowce', label: 'Kręgowce', sub: [
    { id: 'ryby',          label: 'ryby' },
    { id: 'plazy',         label: 'płazy' },
    { id: 'gady',          label: 'gady' },
    { id: 'ptaki',         label: 'ptaki' },
    { id: 'ssaki',         label: 'ssaki' },
    { id: 'kregowce_inne', label: 'kręgowce - inne' },
  ]},
  { id: 'fizjologia_czlowieka', label: 'Fizjologia zwierząt i człowieka', sub: [
    { id: 'tkanki_zwierzece',     label: 'tkanki zwierzęce' },
    { id: 'uklad_powlokowy',      label: 'układ powłokowy (skóra)' },
    { id: 'uklad_kostny',         label: 'układ kostny i mięśniowy' },
    { id: 'uklad_pokarmowy',      label: 'układ pokarmowy' },
    { id: 'uklad_hormonalny',     label: 'układ hormonalny' },
    { id: 'uklad_nerwowy',        label: 'układ nerwowy oraz narządy zmysłów' },
    { id: 'uklad_immunologiczny', label: 'układ immunologiczny' },
    { id: 'uklad_krazenia',       label: 'układ krążenia' },
    { id: 'uklad_oddechowy',      label: 'układ oddechowy' },
    { id: 'uklad_wydalniczy',     label: 'układ wydalniczy' },
    { id: 'uklad_rozrodczy',      label: 'układ rozrodczy' },
    { id: 'fizjologia_inne',      label: 'fizjologia zwierząt i człowieka - inne' },
  ]},
  { id: 'ewolucjonizm', label: 'Ewolucjonizm', sub: [] },
  { id: 'ekologia', label: 'Ekologia', sub: [
    { id: 'ekologia_zadania',   label: 'ekologia - zadania' },
    { id: 'ochrona_srodowiska', label: 'ochrona środowiska' },
  ]},
  { id: 'genetyka', label: 'Genetyka', sub: [
    { id: 'biologia_molekularna', label: 'biologia molekularna, w tym mutacje' },
    { id: 'dziedziczenie',        label: 'dziedziczenie' },
    { id: 'biotechnologia',       label: 'biotechnologia' },
  ]},
  { id: 'doswiadczenia', label: 'Doświadczenia', sub: [] },
  { id: 'inne',          label: 'Inne',           sub: [] },
];

// ── Kategorie matury ─────────────────────────────────────────
const KATEGORIA_OPTIONS = [
  { id: 'matura_maj',         label: 'Matura maj' },
  { id: 'matura_czerwiec',    label: 'Matura czerwiec' },
  { id: 'matura_kwiecien',    label: 'Matura kwiecień (COVID)' },
  { id: 'matura_lipiec',      label: 'Matura lipiec (COVID)' },
  { id: 'informator_cke',     label: 'Informator CKE' },
  { id: 'matura_dwujezyczna', label: 'Matura dwujęzyczna' },
  { id: 'zadanie_autorskie',  label: 'Zadanie autorskie' },
  { id: 'matura_probna',      label: 'Matura próbna' },
  { id: 'inne',               label: 'Inne' },
];

const KATEGORIA_LABELS = {};
KATEGORIA_OPTIONS.forEach(k => { KATEGORIA_LABELS[k.id] = k.label; });

// ── Formuły ───────────────────────────────────────────────────
const FORMULA_OPTIONS = [
  { id: '2007', label: 'Formuła 2007' },
  { id: '2015', label: 'Formuła 2015' },
  { id: '2023', label: 'Formuła 2023' },
];

const FORMULA_LABELS = {};
FORMULA_OPTIONS.forEach(f => { FORMULA_LABELS[f.id] = f.label; });

// ── Poziomy ───────────────────────────────────────────────────
const POZIOM_OPTIONS = [
  { id: 'rozszerzony', label: 'Rozszerzony' },
  { id: 'podstawowy',  label: 'Podstawowy' },
];

const POZIOM_LABELS = {};
POZIOM_OPTIONS.forEach(p => { POZIOM_LABELS[p.id] = p.label; });

// ── Hierarchia kategorii biologii ────────────────────────────
const KATEGORIE_MAP = {};
KATEGORIE.forEach(k => {
  KATEGORIE_MAP[k.id] = k.label;
  k.sub.forEach(s => { KATEGORIE_MAP[s.id] = s.label; });
});

function getLabelForId(id) {
  return KATEGORIE_MAP[id] || id;
}

// Dla wybranej listy ID, rozwiń kategorie główne na ich podkategorie
function expandKatIds(selected) {
  const result = new Set();
  selected.forEach(id => {
    const kat = KATEGORIE.find(k => k.id === id);
    if (kat && kat.sub.length > 0) {
      kat.sub.forEach(s => result.add(s.id));
      result.add(id);
    } else {
      result.add(id);
    }
  });
  return Array.from(result);
}
