// Pure save-state machine for one open note. No DOM, so every transition is unit-testable.
export const STATUS_TEXT = Object.freeze({
  clean: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving...',
  conflict: 'Not saved',
  error: 'Not saved',
  gone: 'Not saved',
});

export function createNoteModel(content, revision) {
  const m = {
    saved: content, // what the server has
    text: content, // what the editor holds
    revision,
    state: 'clean', // clean | dirty | saving | conflict | error | gone
    sentText: null,
  };

  const settle = () => (m.text === m.saved ? 'clean' : 'dirty');

  return {
    get state() { return m.state; },
    get text() { return m.text; },
    get revision() { return m.revision; },
    statusText: () => STATUS_TEXT[m.state],
    // Text on screen differs from the file: this is what the leave guard protects.
    isDirty: () => m.text !== m.saved,
    canSave: () => m.state === 'dirty' || m.state === 'error',
    edit(text) {
      m.text = text;
      if (m.state === 'clean' || m.state === 'dirty') m.state = settle();
      return m.state;
    },
    startSave() {
      m.state = 'saving';
      m.sentText = m.text;
      return { content: m.text, revision: m.revision };
    },
    // Edits made while the request was in flight keep the note dirty.
    saveOk(revision) {
      m.saved = m.sentText;
      m.revision = revision;
      m.state = settle();
    },
    saveConflict() { m.state = 'conflict'; },
    saveGone() { m.state = 'gone'; },
    saveFailed() { m.state = 'error'; },
    reloaded(content, revision) {
      m.saved = content;
      m.text = content;
      m.revision = revision;
      m.state = 'clean';
    },
  };
}

export function saveErrorMessage(state) {
  if (state === 'gone') return 'This note no longer exists. Copy your text before you leave.';
  if (state === 'error') return 'Could not save. Your text is still here. Check that the server is running, then try again.';
  return '';
}

export const CONFLICT_MESSAGE = 'This note changed since you opened it. Your edit was not saved and the newer version is untouched. Copy your text if you want to keep it, then reload.';
