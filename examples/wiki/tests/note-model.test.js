import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoteModel, saveErrorMessage, STATUS_TEXT } from '../public/js/note-model.js';

test('a fresh note is clean and cannot be saved', () => {
  const m = createNoteModel('hi', 'r1');
  assert.equal(m.state, 'clean');
  assert.equal(m.statusText(), 'Saved');
  assert.equal(m.canSave(), false);
  assert.equal(m.isDirty(), false);
});

test('editing makes it dirty, editing back makes it clean again', () => {
  const m = createNoteModel('hi', 'r1');
  m.edit('hi!');
  assert.equal(m.state, 'dirty');
  assert.equal(m.statusText(), 'Unsaved changes');
  assert.ok(m.canSave() && m.isDirty());
  m.edit('hi');
  assert.equal(m.state, 'clean');
});

test('a successful save returns to clean and remembers the new revision', () => {
  const m = createNoteModel('a', 'r1');
  m.edit('b');
  assert.deepEqual(m.startSave(), { content: 'b', revision: 'r1' });
  assert.equal(m.state, 'saving');
  assert.equal(m.statusText(), 'Saving...');
  assert.equal(m.canSave(), false);
  m.saveOk('r2');
  assert.equal(m.state, 'clean');
  assert.equal(m.revision, 'r2');
  assert.equal(m.isDirty(), false);
});

test('edits made while saving keep the note dirty afterwards', () => {
  const m = createNoteModel('a', 'r1');
  m.edit('b');
  m.startSave();
  m.edit('bc');
  assert.equal(m.state, 'saving');
  m.saveOk('r2');
  assert.equal(m.state, 'dirty');
  assert.equal(m.text, 'bc');
  assert.deepEqual(m.startSave(), { content: 'bc', revision: 'r2' });
});

test('conflict blocks saving, shows Not saved and survives more edits', () => {
  const m = createNoteModel('a', 'r1');
  m.edit('b');
  m.startSave();
  m.saveConflict();
  assert.equal(m.state, 'conflict');
  assert.equal(m.statusText(), 'Not saved');
  assert.equal(m.canSave(), false);
  m.edit('bb');
  assert.equal(m.state, 'conflict');
  assert.equal(m.isDirty(), true);
});

test('reload replaces text and revision and clears the conflict', () => {
  const m = createNoteModel('a', 'r1');
  m.edit('b');
  m.startSave();
  m.saveConflict();
  m.reloaded('newer', 'r9');
  assert.equal(m.state, 'clean');
  assert.equal(m.text, 'newer');
  assert.equal(m.revision, 'r9');
  assert.equal(m.isDirty(), false);
});

test('a failed save keeps Save enabled, a vanished note disables it', () => {
  const m = createNoteModel('a', 'r1');
  m.edit('b');
  m.startSave();
  m.saveFailed();
  assert.equal(m.state, 'error');
  assert.equal(m.canSave(), true);
  assert.equal(m.statusText(), 'Not saved');
  m.startSave();
  m.saveGone();
  assert.equal(m.state, 'gone');
  assert.equal(m.canSave(), false);
});

test('save error copy matches ux.md', () => {
  assert.equal(saveErrorMessage('error'), 'Could not save. Your text is still here. Check that the server is running, then try again.');
  assert.equal(saveErrorMessage('gone'), 'This note no longer exists. Copy your text before you leave.');
  assert.equal(saveErrorMessage('clean'), '');
  assert.deepEqual(Object.keys(STATUS_TEXT).sort(), ['clean', 'conflict', 'dirty', 'error', 'gone', 'saving']);
});
