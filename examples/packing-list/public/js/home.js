'use strict';
// Home page: create a list.
(function () {
  const L = window.PackingLogic;
  const A = window.PackingApi;
  const form = document.getElementById('create-form');
  const field = document.getElementById('trip-name');
  const error = document.getElementById('trip-name-error');
  const button = document.getElementById('create-button');
  const NETWORK = 'Could not create the list. Check that the app is running and try again.';

  function showError(message) {
    error.textContent = message;
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }

  function clearError() {
    error.textContent = '';
    field.removeAttribute('aria-invalid');
  }

  function setBusy(busy) {
    button.textContent = busy ? 'Creating...' : 'Create list';
    if (busy) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.getAttribute('aria-disabled') === 'true') return;
    const check = L.checkName(field.value);
    if (!check.ok) { showError(check.message); return; }
    clearError();
    setBusy(true);
    let res = null;
    try { res = await A.request('POST', '/api/lists', { name: check.value }); } catch (err) { res = null; }
    if (res && res.status === 201 && res.body && typeof res.body.id === 'string') {
      try { sessionStorage.setItem('packing-created', res.body.id); } catch (err) { /* focus hint only */ }
      window.location.assign('/l/' + encodeURIComponent(res.body.id));
      return;
    }
    setBusy(false);
    showError(res && res.status >= 400 && res.status < 500 ? A.errorMessage(res, NETWORK) : NETWORK);
  });
}());
