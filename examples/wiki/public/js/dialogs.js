// The four modal dialogs (new note, rename, delete, leave). Each opener returns a promise and puts focus back.
import { h } from './dom.js';
import { validateTitle } from './titles.js';
import { focusEl } from './live.js';

const CREATE_FAILED = 'Could not create the note. Check that the server is still running and try again.';
const RENAME_DIRTY = 'Save or discard your unsaved changes before renaming.';
const RENAME_FAILED = 'Could not rename the note. Check that the server is still running and try again.';
const DELETE_FAILED = 'Could not delete the note. Try again.';
const RENAME_GONE = 'This note no longer exists.';

// Message for a failed title request: the server's own text for title rules, a fallback otherwise.
export function titleErrorMessage(err, fallback) {
  if (err && err.status >= 400 && err.status < 500 && typeof err.code === 'string' && err.code.startsWith('title_')) return err.message;
  return fallback;
}

function frame(doc, testid, id, heading, body) {
  const dialog = h(doc, 'dialog', { testid, 'aria-labelledby': `${id}-title`, class: 'dialog' });
  dialog.appendChild(h(doc, 'form', { class: 'dialog-form', novalidate: true }, [h(doc, 'h2', { id: `${id}-title`, text: heading }), ...body]));
  return dialog;
}

// A modal that resolves once, with whatever finish() was given (Escape and backdrop close give `fallback`).
function session(dialog, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onClose = () => finish(fallback);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    dialog.finish = finish;
  });
}

function titleDialog(doc, { id, ids, heading, label, hint, submitText, busyText }) {
  const input = h(doc, 'input', { id: `${id}-input`, testid: ids.input, type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `${id}-hint ${id}-error` });
  const error = h(doc, 'p', { id: `${id}-error`, testid: ids.error, class: 'dialog-error', role: 'alert' });
  const submit = h(doc, 'button', { type: 'submit', testid: ids.submit, class: 'btn btn-primary', text: submitText });
  const cancel = h(doc, 'button', { type: 'button', testid: ids.cancel, class: 'btn', text: 'Cancel' });
  const dialog = frame(doc, ids.dialog, id, heading, [
    h(doc, 'label', { for: `${id}-input`, text: label }),
    input,
    h(doc, 'p', { id: `${id}-hint`, class: 'hint', text: hint }),
    error,
    h(doc, 'div', { class: 'dialog-actions' }, [cancel, submit]),
  ]);
  const form = dialog.querySelector('form');
  const fail = (message) => {
    error.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    focusEl(input);
  };
  const reset = (value) => {
    input.value = value;
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    submit.removeAttribute('disabled');
    submit.textContent = submitText;
  };
  const busy = (on) => {
    if (on) submit.setAttribute('disabled', '');
    else submit.removeAttribute('disabled');
    submit.textContent = on ? busyText : submitText;
  };
  cancel.addEventListener('click', () => dialog.finish && dialog.finish(null));
  return { dialog, form, input, fail, reset, busy };
}

export function createDialogs({ doc, api, root = doc.body }) {
  const nn = titleDialog(doc, { id: 'dlg-new', ids: { dialog: 'new-note-dialog', input: 'new-note-input', error: 'new-note-error', submit: 'new-note-submit', cancel: 'new-note-cancel' }, heading: 'New note', label: 'Title', hint: 'For example, Meeting notes. Up to 200 characters.', submitText: 'Create note', busyText: 'Creating...' });
  const rn = titleDialog(doc, { id: 'dlg-rename', ids: { dialog: 'rename-dialog', input: 'rename-input', error: 'rename-error', submit: 'rename-submit', cancel: 'rename-cancel' }, heading: 'Rename note', label: 'New title', hint: 'Links in other notes are updated for you.', submitText: 'Rename note', busyText: 'Renaming...' });

  const delHeading = h(doc, 'span');
  const delText = h(doc, 'p', { class: 'dialog-text' });
  const delError = h(doc, 'p', { class: 'dialog-error', role: 'alert' });
  const delCancel = h(doc, 'button', { type: 'button', testid: 'delete-cancel', class: 'btn', text: 'Cancel' });
  const delConfirm = h(doc, 'button', { type: 'submit', testid: 'delete-confirm', class: 'btn btn-danger', text: 'Delete note' });
  const delTextId = 'dlg-delete-text';
  delText.setAttribute('id', delTextId);
  const del = frame(doc, 'delete-dialog', 'dlg-delete', '', [delText, delError, h(doc, 'div', { class: 'dialog-actions' }, [delCancel, delConfirm])]);
  del.setAttribute('aria-describedby', delTextId);
  const delTitle = del.querySelector('h2');
  delTitle.appendChild(delHeading);

  const leaveText = h(doc, 'p', { class: 'dialog-text' });
  const stay = h(doc, 'button', { type: 'button', testid: 'leave-stay', class: 'btn btn-primary', text: 'Keep editing' });
  const discard = h(doc, 'button', { type: 'button', testid: 'leave-discard', class: 'btn', text: 'Discard changes' });
  leaveText.setAttribute('id', 'dlg-leave-text');
  const leave = frame(doc, 'leave-dialog', 'dlg-leave', 'Leave without saving?', [leaveText, h(doc, 'div', { class: 'dialog-actions' }, [stay, discard])]);

  leave.setAttribute('aria-describedby', 'dlg-leave-text');

  for (const d of [nn.dialog, rn.dialog, del, leave]) root.appendChild(d);

  const stop = (ev) => ev.preventDefault();

  nn.form.addEventListener('submit', async (ev) => {
    stop(ev);
    const v = validateTitle(nn.input.value);
    if (!v.ok) { nn.fail(v.message); return; }
    nn.busy(true);
    try {
      const created = await api.createNote(v.title);
      nn.dialog.finish({ title: created.title });
    } catch (e) {
      nn.busy(false);
      nn.fail(titleErrorMessage(e, CREATE_FAILED));
    }
  });

  const dialogs = {
    async newNote({ opener } = {}) {
      nn.reset('');
      const p = session(nn.dialog, null);
      focusEl(nn.input);
      const result = await p;
      if (!result) focusEl(opener);
      return result;
    },

    async rename({ opener, title, dirty = false } = {}) {
      rn.reset(title);
      let current = title;
      const onSubmit = async (ev) => {
        stop(ev);
        if (rn.input.value === current) { rn.dialog.finish(null); return; }
        if (dirty) { rn.fail(RENAME_DIRTY); return; }
        const v = validateTitle(rn.input.value);
        if (!v.ok) { rn.fail(v.message); return; }
        rn.busy(true);
        try {
          rn.dialog.finish(await api.renameNote(current, v.title));
        } catch (e) {
          rn.busy(false);
          rn.fail(e && e.status === 404 ? RENAME_GONE : titleErrorMessage(e, RENAME_FAILED));
        }
      };
      rn.form.addEventListener('submit', onSubmit);
      const p = session(rn.dialog, null);
      focusEl(rn.input);
      if (rn.input.select) rn.input.select();
      const result = await p;
      rn.form.removeEventListener('submit', onSubmit);
      if (!result) focusEl(opener);
      return result;
    },

    async remove({ opener, title } = {}) {
      delHeading.textContent = `Delete "${title}"?`;
      delText.textContent = `This permanently deletes ${title}.md from your vault. Notes that link to it will show a create link.`;
      delError.textContent = '';
      delConfirm.removeAttribute('disabled');
      const onSubmit = async (ev) => {
        stop(ev);
        delConfirm.setAttribute('disabled', '');
        try {
          await api.deleteNote(title);
          del.finish(true);
        } catch (e) {
          if (e && e.status === 404) {
            del.finish('gone'); // already deleted somewhere else: same outcome as a delete
            return;
          }
          delConfirm.removeAttribute('disabled');
          delError.textContent = DELETE_FAILED;
        }
      };
      const onCancel = () => del.finish(false);
      del.querySelector('form').addEventListener('submit', onSubmit);
      delCancel.addEventListener('click', onCancel);
      const p = session(del, false);
      focusEl(delCancel);
      const ok = await p;
      del.querySelector('form').removeEventListener('submit', onSubmit);
      delCancel.removeEventListener('click', onCancel);
      if (!ok) focusEl(opener);
      return ok;
    },

    // Resolves true when the person chose to discard; false means keep editing (focus goes to returnTo).
    async leave({ title, returnTo } = {}) {
      leaveText.textContent = `You have unsaved changes in "${title}". They will be lost.`;
      const onStay = () => leave.finish(false);
      const onDiscard = () => leave.finish(true);
      stay.addEventListener('click', onStay);
      discard.addEventListener('click', onDiscard);
      const p = session(leave, false);
      focusEl(stay);
      const ok = await p;
      stay.removeEventListener('click', onStay);
      discard.removeEventListener('click', onDiscard);
      if (!ok) focusEl(returnTo);
      return ok;
    },
  };
  return dialogs;
}
