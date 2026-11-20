'use strict';
const { DomainError, MAX_NAME, MAX_ITEM } = require('./lists');

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function codePointLength(s) {
  return [...s].length;
}

// Order: type -> trim -> empty -> length -> control characters.
function validateText(raw, spec) {
  if (typeof raw !== 'string') throw new DomainError('invalid_body', 400, 'Request body is not valid.');
  const s = raw.trim();
  if (s.length === 0) throw new DomainError(spec.empty.code, 400, spec.empty.message);
  const n = codePointLength(s);
  if (n > spec.max) throw new DomainError(spec.long, 400, `${spec.label} is too long (${n} characters). The limit is ${spec.max}.`);
  if (CONTROL_RE.test(s)) throw new DomainError(spec.invalid.code, 400, spec.invalid.message);
  return s;
}

const NAME_SPEC = {
  max: MAX_NAME,
  label: 'Trip name',
  long: 'name_too_long',
  empty: { code: 'name_empty', message: 'Enter a trip name.' },
  invalid: { code: 'name_invalid', message: 'Trip name contains characters that are not allowed.' },
};
const ITEM_SPEC = {
  max: MAX_ITEM,
  label: 'Item',
  long: 'item_too_long',
  empty: { code: 'item_empty', message: 'Enter an item to add.' },
  invalid: { code: 'item_invalid', message: 'Item contains characters that are not allowed.' },
};

const validateName = (raw) => validateText(raw, NAME_SPEC);
const validateItemText = (raw) => validateText(raw, ITEM_SPEC);

module.exports = { codePointLength, validateName, validateItemText, CONTROL_RE };
