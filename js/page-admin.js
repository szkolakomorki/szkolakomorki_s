// Uruchomienie strony admin.html. Wymaga: config.js, auth.js, admin.js, actions.js

async function signOut() {
  await _supabase.auth.signOut();
  window.location.href = 'auth.html';
}

registerActions({ signOut: () => signOut() });

document.addEventListener('DOMContentLoaded', () => {
  const emailEl = document.getElementById('user-email');
  getSession().then(s => { if (s && emailEl) emailEl.textContent = s.user.email; });
  initAdminPage();
});
