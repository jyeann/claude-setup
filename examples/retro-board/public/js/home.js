import { createBoard } from './api.js';
import { validateTitle } from './logic.js';
import { announceAssertive } from './live.js';

const form = document.getElementById('create-form');
const input = document.getElementById('title-input');
const titleError = document.getElementById('title-error');
const createError = document.getElementById('create-error');
const submit = document.getElementById('create-submit');

function showFieldError(message) {
  titleError.textContent = message;
  titleError.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function clearErrors() {
  titleError.textContent = '';
  titleError.hidden = true;
  createError.textContent = '';
  createError.hidden = true;
  input.removeAttribute('aria-invalid');
}

input.addEventListener('input', clearErrors);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  clearErrors();
  const problem = validateTitle(input.value);
  if (problem) { showFieldError(problem); return; }
  submit.disabled = true;
  submit.textContent = 'Creating...';
  try {
    const { data } = await createBoard(input.value.trim());
    try { sessionStorage.setItem('retroBoard.justCreated', '1'); } catch { /* storage may be blocked */ }
    window.location.assign(`/b/${data.participantToken}/f/${data.facilitatorToken}`);
  } catch (err) {
    if (err.status === 400 && /title/.test(err.code)) {
      showFieldError(err.code === 'title_empty' ? validateTitle('') : validateTitle('x'.repeat(101)));
    } else {
      const msg = 'Could not create the retro. Check that the app is still running and try again.';
      createError.textContent = msg;
      createError.hidden = false;
      announceAssertive(msg);
    }
    submit.disabled = false;
    submit.textContent = 'Create retro';
  }
});
