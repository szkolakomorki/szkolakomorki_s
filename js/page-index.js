// Uruchomienie strony index.html. Wymaga: config.js, auth.js, actions.js

document.getElementById('year').textContent = new Date().getFullYear();
updateNavAuth();

(async () => {
  try {
    const { count } = await _supabase
      .from('zadania_z_dostepem')
      .select('*', { count: 'exact', head: true });
    if (count != null) {
      const el = document.getElementById('lp-count');
      if (el) el.textContent = count.toLocaleString('pl-PL');
    }
  } catch (_) {}
})();
