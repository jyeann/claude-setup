'use strict';

class DomainError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

const COLUMNS = ['went-well', 'to-improve', 'actions'];
const MAX_TITLE = 100;
const MAX_TEXT = 500;
// C0 (except tab, LF, CR), DEL and C1 controls.
const BAD_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const cpLength = (s) => Array.from(s).length;

function normalizeTitle(raw) {
  if (typeof raw !== 'string') throw new DomainError('title_empty', 400, 'Enter a title.');
  const t = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!t) throw new DomainError('title_empty', 400, 'Enter a title.');
  if (BAD_CONTROL.test(t)) throw new DomainError('title_invalid', 400, 'The title has characters that are not allowed.');
  if (cpLength(t) > MAX_TITLE) throw new DomainError('title_too_long', 400, `The title can have at most ${MAX_TITLE} characters.`);
  return t;
}

function normalizeText(raw) {
  if (typeof raw !== 'string') throw new DomainError('text_empty', 400, 'Write something first.');
  const t = raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (!t) throw new DomainError('text_empty', 400, 'Write something first.');
  if (BAD_CONTROL.test(t)) throw new DomainError('text_invalid', 400, 'The card has characters that are not allowed.');
  if (cpLength(t) > MAX_TEXT) throw new DomainError('text_too_long', 400, `A card can have at most ${MAX_TEXT} characters.`);
  return t;
}

function checkColumn(column) {
  if (typeof column !== 'string' || !COLUMNS.includes(column)) {
    throw new DomainError('bad_column', 400, 'Choose one of the three columns.');
  }
  return column;
}

module.exports = { DomainError, COLUMNS, MAX_TITLE, MAX_TEXT, normalizeTitle, normalizeText, checkColumn };
