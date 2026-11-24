'use strict';
// Temp dirs are removed on normal exit and, via cleanupTempDirs(), when the process is signalled.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDirs = new Set();
function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}
function removeTemp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.delete(dir);
}
function cleanupTempDirs() { for (const dir of [...tempDirs]) removeTemp(dir); }

module.exports = { makeTemp, removeTemp, cleanupTempDirs };
