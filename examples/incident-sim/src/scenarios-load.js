// Boot-time scenario loader: name rule, lstat, size, UTF-8, safe-json, validate. Never throws for a bad file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_BYTES = 65536;
export const NAME_RE = /^[a-z0-9-]{1,40}\.json$/;
const JS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');

export const formatScenarioError = (e) => `scenarios/${e.file}: field "${e.field}": ${e.message}`;

async function defaultDeps() {
  const [{ parseSafe }, { validate }] = await Promise.all([
    import(path.join(JS_DIR, 'core', 'safe-json.js')),
    import(path.join(JS_DIR, 'engine', 'validate.js')),
  ]);
  return { parseSafe, validate };
}

// deps = {parseSafe, validate} may be injected; the real modules load only when a candidate file needs them.
export async function loadScenarios(dir, deps) {
  const scenarios = [];
  const errors = [];
  const fail = (file, message) => errors.push({ file, field: '(file)', message });
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let d = deps;
  for (const name of names) {
    if (!NAME_RE.test(name)) { fail(name, 'is not a valid scenario file name. Expected: a name matching ^[a-z0-9-]{1,40}\\.json$.'); continue; }
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { fail(name, 'cannot be read. Expected: a readable regular file.'); continue; }
    if (st.isSymbolicLink() || !st.isFile()) { fail(name, 'is not a regular file. Expected: a regular file, not a symbolic link or folder.'); continue; }
    if (st.size > MAX_FILE_BYTES) { fail(name, `is ${st.size} bytes. Expected: at most ${MAX_FILE_BYTES} bytes.`); continue; }
    let bytes;
    try { bytes = fs.readFileSync(full); } catch { fail(name, 'cannot be read. Expected: a readable regular file.'); continue; }
    if (bytes.length > MAX_FILE_BYTES) { fail(name, `is ${bytes.length} bytes. Expected: at most ${MAX_FILE_BYTES} bytes.`); continue; }
    let text;
    try { text = utf8.decode(bytes); } catch { fail(name, 'is not valid UTF-8. Expected: UTF-8 text.'); continue; }
    d ??= await defaultDeps();
    const parsed = d.parseSafe(text, { maxBytes: MAX_FILE_BYTES, maxDepth: 12 });
    if (!parsed.ok) { fail(name, parsed.reason); continue; }
    const v = parsed.value;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) { fail(name, 'is not a JSON object. Expected: an object with the scenario fields.'); continue; }
    const res = d.validate(v, name);
    if (!res.ok) { errors.push(...res.errors.map(({ file, field, message }) => ({ file, field, message }))); continue; }
    scenarios.push({ id: name.slice(0, -5), bytes, scenario: res.scenario });
  }
  return { scenarios, errors, index: { valid: scenarios.map((s) => s.id).sort(), errors } };
}
