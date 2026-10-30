// Logika strony subscription.html. Wymaga: config.js, auth.js, actions.js

document.getElementById('year').textContent = new Date().getFullYear();

let selectedPlan = 'monthly';

function selectPlan(plan) {
  selectedPlan = plan;
  document.getElementById('plan-monthly').classList.toggle('selected', plan === 'monthly');
  document.getElementById('plan-annual').classList.toggle('selected',  plan === 'annual');
}

function showCheckoutMsg(text, type) {
  const el = document.getElementById('checkout-msg');
  el.textContent = text;
  el.className = 'form-message ' + type;
}

// _fbp/_fbc istnieją tylko po zgodzie marketingowej; dodatkowo sprawdzamy zapisaną zgodę.
function getMetaCookies() {
  try {
    const consent = JSON.parse(localStorage.getItem('sk_cookie_consent') || 'null');
    if (!consent || !consent.marketing) return {};
  } catch (_) { return {}; }
  const get = (n) => (document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')) || [])[1];
  const out = {};
  const fbp = get('_fbp'), fbc = get('_fbc');
  if (fbp) out.fbp = decodeURIComponent(fbp);
  if (fbc) out.fbc = decodeURIComponent(fbc);
  return out;
}

async function startCheckout() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'auth.html?redirect=subscription.html';
    return;
  }

  const btn = document.getElementById('checkout-btn');
  btn.disabled = true;
  btn.textContent = 'Przekierowywanie do Stripe…';
  showCheckoutMsg('', '');

  // Serwer sam dobiera cenę i adresy powrotu — klient podaje tylko plan
  // (+ cookies Meta, wyłącznie gdy jest zgoda marketingowa — do Conversions API)
  const { data: fnData, error: fnError } = await _supabase.functions.invoke('create-checkout', {
    body: { plan: selectedPlan === 'annual' ? 'annual' : 'monthly', ...getMetaCookies() },
  });

  if (fnError || !fnData?.url) {
    let msg = 'Błąd podczas tworzenia sesji płatności. Spróbuj ponownie.';
    try {
      const detail = await fnError?.context?.json?.();
      if (detail?.code === 'already_subscribed') {
        msg = 'Masz już aktywną subskrypcję. Zarządzaj nią przyciskiem „Zarządzaj subskrypcją”.';
      }
    } catch (_) {}
    showCheckoutMsg(msg, 'error');
    btn.disabled = false;
    btn.textContent = 'Zacznij 3-dniowy trial →';
    return;
  }

  window.location.href = fnData.url;
}

async function openBillingPortal() {
  const btn = document.getElementById('portal-btn');
  btn.disabled = true;
  btn.textContent = 'Przekierowywanie do Stripe…';

  const { data, error } = await _supabase.functions.invoke('create-portal-session');

  if (error || !data?.url) {
    btn.disabled = false;
    btn.textContent = 'Zarządzaj subskrypcją / anuluj';
    alert('Błąd podczas otwierania panelu Stripe. Spróbuj ponownie później.');
    return;
  }

  window.location.href = data.url;
}

// ── Zmiana hasła ──────────────────────────────────────────────
function showPwMsg(text, type) {
  const el = document.getElementById('pw-msg');
  el.textContent = text;
  el.className = 'form-message ' + type;
}

async function handleChangePassword(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  const label = btn.textContent;
  showPwMsg('', '');

  const current = document.getElementById('current-password').value;
  const p1 = document.getElementById('change-password').value;
  const p2 = document.getElementById('change-password2').value;
  if (p1.length < MIN_PASSWORD_LENGTH) { showPwMsg(`Nowe hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, 'error'); return; }
  if (p1 !== p2) { showPwMsg('Nowe hasła nie są takie same.', 'error'); return; }

  const session = await getSession();
  if (!session) { window.location.href = 'auth.html?redirect=subscription.html'; return; }

  btn.disabled = true;
  btn.textContent = 'Proszę czekać…';

  // Obecne hasło musi się zgadzać — sama sesja (np. skradziona lub zostawiona na cudzym komputerze) nie wystarcza
  const { error: signInError } = await _supabase.auth.signInWithPassword({ email: session.user.email, password: current });
  if (signInError) {
    showPwMsg(signInError.status === 429 ? passwordErrorMessage(signInError) : 'Obecne hasło jest nieprawidłowe.', 'error');
    btn.disabled = false; btn.textContent = label;
    return;
  }

  const { error } = await _supabase.auth.updateUser({ password: p1 });
  btn.disabled = false; btn.textContent = label;
  if (error) { showPwMsg(passwordErrorMessage(error), 'error'); return; }

  e.target.reset();
  showPwMsg('Hasło zostało zmienione.', 'success');
}

// Dla kogoś, kto nie zna obecnego hasła (albo nigdy go nie ustawił): link na własny adres e-mail
async function sendResetLink() {
  const session = await getSession();
  if (!session) { window.location.href = 'auth.html'; return; }
  const { error } = await _supabase.auth.resetPasswordForEmail(session.user.email, {
    redirectTo: CONFIG.app.siteUrl + '/auth.html',
  });
  if (error) { showPwMsg(passwordErrorMessage(error), 'error'); return; }
  showPwMsg('Wysłaliśmy link do ustawienia hasła na ' + session.user.email + '. Sprawdź skrzynkę (także spam).', 'success');
}

async function initSubscriptionPage() {
  const p = new URLSearchParams(window.location.search);

  // Obsługa powrotu ze Stripe
  if (p.get('success') === '1') {
    showCheckoutMsg('Subskrypcja aktywowana! Poczekaj chwilę, aż Stripe potwierdzi płatność (może zająć do minuty), a następnie wróć do bazy zadań.', 'success');
  }
  if (p.get('cancel') === '1') {
    showCheckoutMsg('Płatność anulowana. Możesz spróbować ponownie w dowolnym momencie.', 'error');
  }

  const session = await getSession();

  if (!session) {
    document.getElementById('login-cta').classList.remove('hidden');
    document.getElementById('checkout-btn').classList.add('hidden');
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) authBtn.textContent = 'Zaloguj się';
    return;
  }

  // Zalogowany może zmienić hasło
  document.getElementById('konto-haslo').classList.remove('hidden');

  // Użytkownik zalogowany - pokaż jego e-mail
  const emailEl = document.getElementById('user-email');
  if (emailEl) emailEl.textContent = session.user.email;

  const authBtn = document.getElementById('auth-btn');
  if (authBtn) {
    authBtn.textContent = 'Wyloguj';
    authBtn.href = '#';
    authBtn.onclick = async (e) => {
      e.preventDefault();
      await _supabase.auth.signOut();
      window.location.reload();
    };
  }

  // Sprawdź czy ma już aktywną subskrypcję
  const active = await hasActiveSubscription();
  if (active) {
    const { data: aktualnaDo } = await _supabase.rpc('get_my_subscription_expiry');

    document.getElementById('status-block').classList.remove('hidden');
    document.getElementById('sub-hero').classList.add('hidden');
    document.getElementById('plans-section').classList.add('hidden');
    document.getElementById('jak-anulowac').classList.remove('hidden');

    if (aktualnaDo) {
      const d = new Date(aktualnaDo);
      document.getElementById('status-desc').textContent =
        `Twoja subskrypcja jest aktywna do ${d.toLocaleDateString('pl-PL', { year:'numeric', month:'long', day:'numeric' })}.`;
    }
  }
}

registerActions({
  selectPlan:       (el) => selectPlan(el.dataset.plan),
  startCheckout:    () => startCheckout(),
  openBillingPortal: () => openBillingPortal(),
  handleChangePassword: (_el, e) => handleChangePassword(e),
  sendResetLink:    () => sendResetLink(),
});

document.addEventListener('DOMContentLoaded', initSubscriptionPage);
