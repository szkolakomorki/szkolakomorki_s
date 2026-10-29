// Wspólna logika autoryzacji — import na każdej stronie po config.js i supabase CDN

// Adres z chwili załadowania strony — zapamiętujemy PRZED utworzeniem klienta, bo supabase-js po
// obsłużeniu linku z e-maila (reset hasła, magic link) czyści fragment URL (#access_token=…).
const AUTH_URL_AT_LOAD = { hash: window.location.hash, search: window.location.search };

const _supabase = supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);

// Minimalna długość hasła po stronie formularzy. Serwer (Supabase → Authentication → Password policy)
// może wymagać więcej — wtedy jego błąd jest tłumaczony w passwordErrorMessage().
const MIN_PASSWORD_LENGTH = 8;

// Polski komunikat dla błędów związanych z hasłem / wysyłką maili
function passwordErrorMessage(error) {
  const code = error && error.code;
  const msg  = (error && error.message) || '';
  if (code === 'same_password' || /different from the old password/i.test(msg)) {
    return 'Nowe hasło musi się różnić od dotychczasowego.';
  }
  if (code === 'weak_password' || /password.*(weak|least|characters|pwned|breach)/i.test(msg)) {
    return 'Hasło jest zbyt słabe (zbyt krótkie, zbyt proste albo znane z wycieków danych). Wybierz dłuższe, unikalne hasło.';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || (error && error.status === 429)) {
    return 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.';
  }
  if (code === 'reauthentication_needed' || code === 'reauthentication_not_valid') {
    return 'Ze względów bezpieczeństwa zaloguj się ponownie i spróbuj jeszcze raz.';
  }
  if (/session.*missing|not authenticated/i.test(msg)) {
    return 'Link wygasł lub został już użyty. Poproś o nowy.';
  }
  return msg || 'Wystąpił błąd. Spróbuj ponownie.';
}

// Zwraca aktualną sesję lub null
async function getSession() {
  const { data } = await _supabase.auth.getSession();
  return data.session;
}

// Zwraca true jeśli user ma aktywną subskrypcję
// Korzysta z tej samej funkcji SQL (has_active_subscription), co widok
// zadania_z_dostepem — jedno źródło prawdy, zamiast dwóch niezależnych sprawdzeń.
async function hasActiveSubscription() {
  const session = await getSession();
  if (!session) return false;

  const { data, error } = await _supabase.rpc('has_active_subscription');
  if (error) {
    console.error('[hasActiveSubscription]', error);
    return false;
  }
  return !!data;
}

// Aktualizuje nawigację na podstawie stanu sesji
async function updateNavAuth(opts = {}) {
  const session = await getSession();
  const authBtn  = document.getElementById('auth-btn');
  const subBtn   = document.getElementById('sub-btn');
  const userEl   = document.getElementById('user-email');
  const subBadge = document.getElementById('sub-badge');

  if (!session) {
    if (authBtn)  { authBtn.textContent = 'Zaloguj się'; authBtn.href = 'auth.html'; authBtn.onclick = null; }
    if (subBtn)   subBtn.classList.remove('hidden');
    if (userEl)   userEl.textContent = '';
    if (subBadge) subBadge.classList.add('hidden');
    return;
  }

  const user = session.user;
  if (userEl) userEl.textContent = user.email;

  if (authBtn) {
    authBtn.textContent = 'Wyloguj';
    authBtn.href = '#';
    authBtn.onclick = async (e) => {
      e.preventDefault();
      await _supabase.auth.signOut();
      window.location.reload();
    };
  }

  const active = await hasActiveSubscription();
  if (subBadge && active) subBadge.classList.remove('hidden');
  if (subBtn && active) {
    subBtn.textContent = 'Zarządzaj subskrypcją';
    subBtn.href = 'subscription.html';
    subBtn.classList.remove('hidden');
  }

  if (opts.onSession) opts.onSession(session, active);
}

// Przekierowanie jeśli niezalogowany
async function requireAuth(redirectTo = 'auth.html') {
  const session = await getSession();
  if (!session) {
    window.location.href = redirectTo + '?redirect=' + encodeURIComponent(window.location.href);
  }
  return session;
}

// Przekierowanie jeśli nie admin
async function requireAdmin() {
  const session = await requireAuth();
  // app_metadata może zmienić tylko serwer — user_metadata użytkownik edytuje sam, więc się do tego nie nadaje
  const isAdmin = session?.user?.app_metadata?.is_admin === true;
  if (!isAdmin) {
    document.body.innerHTML = '<div class="form-page"><div class="form-card"><h1 style="text-align:center;color:#8b2020">Brak dostępu</h1><p style="text-align:center;margin-top:12px">Ta strona jest dostępna tylko dla administratora.</p><div style="text-align:center;margin-top:24px"><a href="index.html" class="btn">Wróć na stronę główną</a></div></div></div>';
    return null;
  }
  return session;
}
