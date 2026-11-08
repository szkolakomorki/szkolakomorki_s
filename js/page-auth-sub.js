// Logika strony auth_sub.html — rejestracja/logowanie w drodze do zakupu subskrypcji (bez tarcia).
// Wymaga: config.js, auth.js, actions.js
//
// Przepływ:
//   subscription.html → (niezalogowany) auth_sub.html?plan=… → rejestracja → Stripe
//   Gdy Supabase wymaga potwierdzenia e-maila: link z maila wraca na auth_sub.html?plan=…,
//   użytkownik jest już zalogowany i widzi tylko wybór planu + przycisk „Przejdź do płatności”.
// Zwykłe logowanie/rejestracja (auth.html) działa po staremu.

const SEARCH = new URLSearchParams(AUTH_URL_AT_LOAD.search);
let currentPlan = SEARCH.get('plan') === 'annual' ? 'annual' : 'monthly';

// Link wygasł / został już użyty (Supabase dopisuje do adresu #error=…&error_code=otp_expired)
const LINK_EXPIRED = /error_code=(otp_expired|access_denied)/.test(AUTH_URL_AT_LOAD.hash + AUTH_URL_AT_LOAD.search);

const PLAN_LABELS = {
  monthly: '<strong>Miesięczny</strong> - 15 zł / miesiąc, pierwsze 3 dni gratis',
  annual:  '<strong>Roczny</strong> - 90 zł / rok (−50%), pierwsze 3 dni gratis',
};

let busy = false;       // trwa rejestracja/logowanie — nie reaguj na zdarzenia auth
let redirecting = false; // już ruszyliśmy do Stripe

const STEPS = ['step-plan', 'register-form', 'login-form', 'step-confirm'];
function showStep(id) {
  STEPS.forEach((s) => { document.getElementById(s).style.display = s === id ? '' : 'none'; });
}

function showMsg(text, type) {
  const el = document.getElementById('form-msg');
  el.textContent = text;
  el.className = 'form-message' + (type ? ' ' + type : '');
}
function clearMsg() { showMsg('', ''); }

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) btn.dataset.label = btn.textContent;
  btn.disabled = loading;
  btn.textContent = loading ? 'Proszę czekać…' : (btn.dataset.label || btn.textContent);
}

function renderPlan() {
  document.getElementById('as-plan-monthly').classList.toggle('selected', currentPlan === 'monthly');
  document.getElementById('as-plan-annual').classList.toggle('selected', currentPlan === 'annual');
  document.getElementById('reg-summary').innerHTML = PLAN_LABELS[currentPlan];
  document.getElementById('login-summary').innerHTML = PLAN_LABELS[currentPlan];
}

function showRegister() { clearMsg(); showStep('register-form'); }
function showLogin()    { clearMsg(); showStep('login-form'); }
function showPlanStep() { clearMsg(); showStep('step-plan'); }

// Tworzy sesję Stripe i przekierowuje. Wywoływane tylko dla zalogowanego.
async function goToStripe() {
  if (redirecting) return;
  redirecting = true;
  const btn = document.getElementById('pay-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Przekierowywanie do Stripe…';
  clearMsg();

  // Gdy wywołane tuż po rejestracji/logowaniu, formularz może być jeszcze widoczny — pokaż ekran planu
  showStep('step-plan');

  const res = await createCheckoutSession(currentPlan);
  if (!res.url) {
    redirecting = false;
    btn.disabled = false;
    btn.textContent = label;
    showMsg(res.error, 'error');
    if (res.alreadySubscribed) {
      setTimeout(() => { window.location.href = 'subscription.html'; }, 2500);
    }
    return;
  }
  window.location.href = res.url;
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  setLoading(btn, true);
  clearMsg();
  busy = true;

  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  const { data, error } = await _supabase.auth.signUp({
    email,
    password,
    // Link z maila wraca tutaj — użytkownik widzi tylko wybór planu i jedno kliknięcie do Stripe
    options: {
      emailRedirectTo: CONFIG.app.siteUrl + '/auth_sub.html?plan=' + currentPlan,
      // Znacznik używany w szablonie maila „Confirm signup" do rozróżnienia rejestracji pod zakup
      data: { signup_flow: 'subscription' },
    },
  });
  busy = false;

  if (error) {
    showMsg(passwordErrorMessage(error), 'error');
    setLoading(btn, false);
    return;
  }

  // Potwierdzanie e-maila wyłączone → mamy od razu sesję → prosto do Stripe
  if (data.session) {
    goToStripe();
    return;
  }

  // Adres już zarejestrowany (Supabase nie zwraca błędu, tylko usera bez identities)
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    setLoading(btn, false);
    document.getElementById('login-email').value = email;
    showLogin();
    showMsg('Konto z tym adresem już istnieje. Zaloguj się - przejdziesz od razu do płatności.', 'error');
    return;
  }

  // Wymagane potwierdzenie e-maila
  setLoading(btn, false);
  document.getElementById('confirm-email').textContent = email;
  showStep('step-confirm');
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  setLoading(btn, true);
  clearMsg();
  busy = true;

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  const { error } = await _supabase.auth.signInWithPassword({ email, password });
  busy = false;
  if (error) {
    showMsg(error.message === 'Invalid login credentials'
      ? 'Nieprawidłowy e-mail lub hasło.'
      : passwordErrorMessage(error), 'error');
    setLoading(btn, false);
    return;
  }
  goToStripe();
}

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
  showMsg('Jeśli konto z tym adresem istnieje, wysłaliśmy na nie link do ustawienia nowego hasła. Sprawdź skrzynkę (także spam).', 'success');
}

// Zmiana planu na ekranie wyboru
function pickPlan(plan) {
  currentPlan = plan === 'annual' ? 'annual' : 'monthly';
  renderPlan();
}

// Powrót z linku w mailu (SIGNED_IN) albo zalogowanie w innej karcie
_supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' && !busy && !redirecting) showPlanStep();
});

(async function init() {
  renderPlan();

  const session = await getSession();
  if (session) { showPlanStep(); return; }

  if (LINK_EXPIRED) {
    showLogin();
    showMsg('Link wygasł lub został już użyty. Zaloguj się hasłem, które ustawiłeś(-aś) przy rejestracji.', 'error');
    return;
  }
  if (SEARCH.get('mode') === 'login') showLogin(); else showRegister();
})();

registerActions({
  pickPlan:       (el) => pickPlan(el.dataset.plan),
  goToStripe:     () => goToStripe(),
  handleRegister: (_el, e) => handleRegister(e),
  handleLogin:    (_el, e) => handleLogin(e),
  handleForgotPassword: () => handleForgotPassword(),
  showLogin:      (_el, e) => { e.preventDefault(); showLogin(); },
  showRegister:   (_el, e) => { e.preventDefault(); showRegister(); },
});
