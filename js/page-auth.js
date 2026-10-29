// Logika strony auth.html (logowanie / rejestracja). Wymaga: config.js, auth.js, actions.js

// Czy użytkownik przyszedł z linku „Nie pamiętam hasła” z e-maila? (adres zapamiętany w auth.js)
const RECOVERY_MODE = /[#&?]type=recovery(&|$)/.test(AUTH_URL_AT_LOAD.hash + '&' + AUTH_URL_AT_LOAD.search);
// Link wygasł / został już użyty (Supabase dopisuje do adresu #error=…&error_code=otp_expired)
const LINK_EXPIRED = /error_code=(otp_expired|access_denied)/.test(AUTH_URL_AT_LOAD.hash + AUTH_URL_AT_LOAD.search);

// Przekieruj jeśli już zalogowany (ale nie w trakcie ustawiania nowego hasła)
(async () => {
  if (RECOVERY_MODE) return;
  const s = await getSession();
  if (s) redirectAfterAuth();
})();

function redirectAfterAuth() {
  const p = new URLSearchParams(window.location.search);
  window.location.href = safeRedirect(p.get('redirect'));
}

// Tylko ta sama origin i http(s) — blokuje javascript:, data: i obce domeny
function safeRedirect(raw) {
  if (!raw) return 'baza.html';
  try {
    const u = new URL(raw, window.location.href);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin === window.location.origin) return u.href;
  } catch (_) {}
  return 'baza.html';
}

function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('login-form').style.display    = isLogin ? '' : 'none';
  document.getElementById('register-form').style.display = isLogin ? 'none' : '';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  clearMsg();
}

function showMsg(text, type) {
  const el = document.getElementById('form-msg');
  el.textContent = text;
  el.className = 'form-message ' + type;
}
function clearMsg() {
  const el = document.getElementById('form-msg');
  el.textContent = '';
  el.className = 'form-message';
}
function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Proszę czekać…' : btn.dataset.label;
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  btn.dataset.label = btn.textContent;
  setLoading(btn, true);
  clearMsg();

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  const { error } = await _supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showMsg(error.message === 'Invalid login credentials'
      ? 'Nieprawidłowy e-mail lub hasło.'
      : error.message, 'error');
    setLoading(btn, false);
    return;
  }
  redirectAfterAuth();
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  btn.dataset.label = btn.textContent;
  setLoading(btn, true);
  clearMsg();

  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  const { error } = await _supabase.auth.signUp({ email, password });
  if (error) {
    showMsg(error.message, 'error');
    setLoading(btn, false);
    return;
  }
  showMsg('Konto utworzone! Sprawdź skrzynkę e-mail i potwierdź adres.', 'success');
  setLoading(btn, false);
}

// ── Reset hasła ───────────────────────────────────────────────
async function handleForgotPassword() {
  clearMsg();
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    showMsg('Wpisz adres e-mail w polu powyżej, a wyślemy na niego link do ustawienia nowego hasła.', 'error');
    return;
  }
  const { error } = await _supabase.auth.resetPasswordForEmail(email, {
    redirectTo: CONFIG.app.siteUrl + '/auth.html',
  });
  if (error) { showMsg(passwordErrorMessage(error), 'error'); return; }
  // Odpowiedź jest celowo taka sama, gdy konto nie istnieje (nie zdradzamy, kto ma konto)
  showMsg('Jeśli konto z tym adresem istnieje, wysłaliśmy na nie link do ustawienia nowego hasła. Sprawdź skrzynkę (także spam). Link jest ważny krótko.', 'success');
}

function showRecoveryForm() {
  document.querySelector('.tabs').style.display = 'none';
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('recovery-form').style.display = '';
  clearMsg();
}

async function handleNewPassword(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  btn.dataset.label = btn.textContent;
  clearMsg();

  const p1 = document.getElementById('new-password').value;
  const p2 = document.getElementById('new-password2').value;
  if (p1.length < MIN_PASSWORD_LENGTH) { showMsg(`Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, 'error'); return; }
  if (p1 !== p2) { showMsg('Hasła nie są takie same.', 'error'); return; }

  setLoading(btn, true);
  const { error } = await _supabase.auth.updateUser({ password: p1 });
  if (error) {
    showMsg(passwordErrorMessage(error), 'error');
    setLoading(btn, false);
    return;
  }
  showMsg('Hasło zostało zmienione. Za chwilę przejdziesz do bazy zadań.', 'success');
  setTimeout(() => { window.location.href = 'baza.html'; }, 1500);
}

async function handleMagicLink() {
  clearMsg();
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    showMsg('Wpisz adres e-mail powyżej.', 'error');
    return;
  }
  const { error } = await _supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: CONFIG.app.siteUrl + '/index.html' },
  });
  if (error) { showMsg(error.message, 'error'); return; }
  showMsg('Link logowania wysłany! Sprawdź skrzynkę e-mail.', 'success');
}

// Obsługa powrotu z magic link
_supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') { showRecoveryForm(); return; }
  if (event === 'SIGNED_IN' && !RECOVERY_MODE) redirectAfterAuth();
});

if (RECOVERY_MODE) showRecoveryForm();
if (LINK_EXPIRED) {
  showMsg('Link wygasł lub został już użyty. Wpisz e-mail i kliknij „Nie pamiętam hasła”, aby otrzymać nowy.', 'error');
}

registerActions({
  switchTab:       (el) => switchTab(el.dataset.tab),
  handleLogin:     (_el, e) => handleLogin(e),
  handleRegister:  (_el, e) => handleRegister(e),
  handleMagicLink: () => handleMagicLink(),
  handleForgotPassword: () => handleForgotPassword(),
  handleNewPassword: (_el, e) => handleNewPassword(e),
});
