// Uruchomienie strony baza.html. Wymaga: config.js, auth.js, zadania.js, actions.js

document.getElementById('year').textContent = new Date().getFullYear();
document.addEventListener('DOMContentLoaded', () => { initZadaniaPage(); });
