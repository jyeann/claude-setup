'use strict';
const fs = require('node:fs');
const path = require('node:path');

const STATE_DIR = '.harness';
const STATE_FILE = 'state.json';
const DEFAULTS = Object.freeze({ maxIterations: 20, stallLimit: 3 });

const statePath = (projectDir) => path.join(projectDir, STATE_DIR, STATE_FILE);

function readState(projectDir) {
  const file = statePath(projectDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Corrupt ${STATE_DIR}/${STATE_FILE}: ${err.message}`);
  }
}

function writeState(projectDir, state) {
  const file = statePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function normaliseProtected(entries, projectDir) {
  return entries.map((entry) => {
    let p = entry.replace(/^\.\//, '');
    if (path.isAbsolute(p)) {
      if (!projectDir || !p.startsWith(`${projectDir}/`)) throw new Error(`Protected path must be inside the project: ${entry}`);
      p = p.slice(projectDir.length + 1);
    }
    return p;
  });
}

function buildState({ verifyCommand, task = '', maxIterations, stallLimit, protectedPaths = [], commitGate = true, projectDir }) {
  if (!verifyCommand || !verifyCommand.trim()) {
    throw new Error('A non-empty verify command is required: it is the objective definition of done.');
  }
  return {
    active: true,
    status: 'running',
    task,
    verifyCommand: verifyCommand.trim(),
    maxIterations: maxIterations ?? DEFAULTS.maxIterations,
    stallLimit: stallLimit ?? DEFAULTS.stallLimit,
    protectedPaths: normaliseProtected(protectedPaths, projectDir),
    commitGate,
    iteration: 0,
    lastSignature: null,
    stallCount: 0,
    history: [],
  };
}

module.exports = { readState, writeState, buildState, statePath, STATE_DIR };
