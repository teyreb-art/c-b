const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#login-error');
const button = document.querySelector('#login-submit');
const password = document.querySelector('#login-password');
const show = document.querySelector('#show-password');
show.addEventListener('click', () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  show.textContent = visible ? 'Verberg' : 'Toon';
  show.setAttribute('aria-pressed', String(visible));
  show.setAttribute('aria-label', visible ? 'Wachtwoord verbergen' : 'Wachtwoord tonen');
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.hidden = true; button.disabled = true; button.textContent = 'Bezig met inloggen…';
  try {
    const response = await fetch('/api/dashboard/auth/login', {
      method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.querySelector('#login-email').value.trim(), password: password.value })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Inloggen is niet gelukt. Probeer opnieuw.');
    password.value = '';
    window.location.replace('/beheer/');
  } catch (error) {
    errorBox.textContent = error instanceof TypeError || error instanceof SyntaxError ? 'Er is geen verbinding met de loginservice. Probeer opnieuw.' : error.message;
    errorBox.hidden = false;
    button.disabled = false; button.textContent = 'Inloggen';
  }
});
