'use strict';
const { isLanguage, isTone, CATALOGUE } = require('./greetings');

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Trimmed NFC form of a name (caller must have checked it is a string).
const normalizeName = (name) => name.normalize('NFC').trim();

// True when the parsed body is an object with an own `name` key (personalised greeting).
const isPersonalised = (body) => isPlain(body) && own(body, 'name');

// Returns an error string or null for a name value (string, 1..40 code points after trim, no control/format characters).
function validateName(v) {
  if (v === undefined) return 'name is required';
  if (typeof v !== 'string') return 'name must be a string';
  const name = normalizeName(v);
  if (name.length === 0) return 'name is required';
  if ([...name].length > 40) return 'name too long (max 40)';
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return 'name has invalid characters';
  return null;
}

// Returns an error string or null for a personalised hello body.
function validateHelloBody(body) {
  if (!isPlain(body) || !own(body, 'name')) return 'name is required';
  const nameError = validateName(body.name);
  if (nameError) return nameError;
  if (own(body, 'language') && body.language !== undefined && !isLanguage(body.language)) return 'unknown language';
  if (own(body, 'tone') && body.tone !== undefined && !isTone(body.tone)) return 'unknown tone';
  return null;
}

function validateVerifyBody(body) {
  if (!isPlain(body) || !own(body, 'text') || typeof body.text !== 'string') return 'text is required';
  if (body.text.length > 10000) return 'too long';
  return null;
}

function validateVote(body) {
  if (!isPlain(body) || !own(body, 'choice') || typeof body.choice !== 'string') return 'choice is required';
  if (!CATALOGUE.has(body.choice)) return 'unknown choice';
  return null;
}

module.exports = { validateName, validateHelloBody, validateVerifyBody, validateVote, normalizeName, isPersonalised };
