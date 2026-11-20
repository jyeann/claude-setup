// Title rules shared by the browser and the server. No DOM and no Node built-ins here.

export const MAX_TITLE_LENGTH = 200;
export const MAX_TITLE_BYTES = 240;

export const TITLE_MESSAGES = Object.freeze({
  title_empty: 'Give the note a title.',
  title_too_long: 'Keep the title to 200 characters or fewer. It is {n} now.',
  title_too_long_bytes: 'This title is too long for a file name. Shorten it.',
  title_control: 'A title cannot contain control characters.',
  title_separator: 'A title cannot contain / or \\.',
  title_dotdot: 'A title cannot contain "..".',
  title_leading_dot: 'A title cannot start with a dot.',
  title_char: 'A title cannot contain : * ? " < > | [ ] or #.',
  title_trailing_dot: 'A title cannot end with a dot.',
  title_reserved: '"{name}" is a reserved name. Choose another title.',
  title_exists: 'A note called "{existing}" already exists. Choose another title.',
});

const encoder = new TextEncoder();
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const SEPARATOR = /[/\\]/;
const BAD_CHAR = /[:*?"<>|[\]#]/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function normalizeTitle(raw) {
  return String(raw).normalize('NFC').trim();
}

export function titleKey(title) {
  return normalizeTitle(title).toLowerCase();
}

const fail = (code, params = {}) => ({
  ok: false,
  code,
  message: TITLE_MESSAGES[code].replace(/\{(\w+)\}/g, (_, k) => String(params[k])),
});

export function validateTitle(raw) {
  const title = typeof raw === 'string' ? normalizeTitle(raw) : '';
  if (title === '') return fail('title_empty');
  const length = [...title].length;
  if (length > MAX_TITLE_LENGTH) return fail('title_too_long', { n: length });
  if (encoder.encode(title).length > MAX_TITLE_BYTES) return fail('title_too_long_bytes');
  if (CONTROL.test(title) || LONE_SURROGATE.test(title)) return fail('title_control');
  if (SEPARATOR.test(title)) return fail('title_separator');
  if (title.includes('..')) return fail('title_dotdot');
  if (title.startsWith('.')) return fail('title_leading_dot');
  if (BAD_CHAR.test(title)) return fail('title_char');
  if (title.endsWith('.')) return fail('title_trailing_dot');
  const name = title.split('.')[0];
  if (RESERVED.test(name)) return fail('title_reserved', { name });
  return { ok: true, title };
}
