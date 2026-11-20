'use strict';
// TypeScript support for the strong verify gate. The gate targets Node's native type stripping
// (`node --test "tests/*.test.ts"`), which erases types by overwriting them with spaces, so character
// offsets and line numbers of the stripped text equal those of the original. We use that to find out
// which characters are runtime code (they survive stripping) and which are type syntax (they do not).
// .tsx/.jsx are deliberately not supported: Node's type stripping does not handle JSX.
const nodeModule = require('node:module');

const TS_FILE = /\.[cm]?ts$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

const canStripTypes = () => typeof nodeModule.stripTypeScriptTypes === 'function';

// Returns the type-erased text, same length as `source`. Throws if the text does not parse as strip-only
// TypeScript (syntax error, or syntax that needs a transform such as enums) or this Node cannot strip.
function stripTypes(source) {
  if (!canStripTypes()) throw new Error('this Node has no module.stripTypeScriptTypes (needs Node 22.13+ or 23.2+)');
  const emit = process.emitWarning;
  process.emitWarning = () => {}; // the API prints an ExperimentalWarning on every first use
  let out;
  try { out = nodeModule.stripTypeScriptTypes(source, { mode: 'strip' }); } finally { process.emitWarning = emit; }
  if (out.length !== source.length) throw new Error('type stripping changed the text length, so offsets cannot be mapped');
  return out;
}

const strips = (source) => { try { stripTypes(source); return true; } catch { return false; } };

module.exports = { TS_FILE, DECLARATION_FILE, canStripTypes, stripTypes, strips };
