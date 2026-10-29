// Uruchomienie strony podrecznik.html. Wymaga: config.js, auth.js, podrecznik.js, actions.js

document.getElementById('year').textContent = new Date().getFullYear();
document.addEventListener('DOMContentLoaded', () => { initPodrecznikPage(); });
