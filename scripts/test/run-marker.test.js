'use strict';
// Tests for run-marker.js start: the marker itself and the run folder's run.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'run-marker.js');
const RUN_DIR = '.deepseek-coder/plans/r1';

// A temp project with `.deepseek-coder/config.json`.
function makeProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-marker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.deepseek-coder'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.deepseek-coder', 'config.json'), '{}');
  return dir;
}

function runStart(dir) {
  return spawnSync(process.execPath, [SCRIPT, 'start', RUN_DIR], { encoding: 'utf8', cwd: dir });
}

function runMarker(dir, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: dir });
}

function markerPathOf(dir) {
  return path.join(dir, '.deepseek-coder', 'plans', '.run-active');
}

function readMarker(dir) {
  return JSON.parse(fs.readFileSync(markerPathOf(dir), 'utf8'));
}

function markerStartedAt(dir) {
  return readMarker(dir).startedAt;
}

function runJsonPath(dir) {
  return path.join(dir, '.deepseek-coder', 'plans', 'r1', 'run.json');
}

test('start writes run.json with only startedAt when it is missing', (t) => {
  const dir = makeProject(t);
  fs.mkdirSync(path.join(dir, RUN_DIR), { recursive: true });

  const r = runStart(dir);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.startsWith('Run marker created:'));

  const info = JSON.parse(fs.readFileSync(runJsonPath(dir), 'utf8'));
  assert.deepEqual(Object.keys(info), ['startedAt']);
  assert.equal(info.startedAt, markerStartedAt(dir));
});

test('start leaves an existing run.json byte-for-byte unchanged', (t) => {
  const dir = makeProject(t);
  fs.mkdirSync(path.join(dir, RUN_DIR), { recursive: true });
  const original = '{"startedAt":"2020-01-01T00:00:00.000Z","transcriptPath":"x"}';
  fs.writeFileSync(runJsonPath(dir), original);

  const r = runStart(dir);
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(runJsonPath(dir), 'utf8'), original);
});

test('start replaces an unparsable run.json', (t) => {
  const dir = makeProject(t);
  fs.mkdirSync(path.join(dir, RUN_DIR), { recursive: true });
  fs.writeFileSync(runJsonPath(dir), 'not json');

  const r = runStart(dir);
  assert.equal(r.status, 0);
  const info = JSON.parse(fs.readFileSync(runJsonPath(dir), 'utf8'));
  assert.equal(info.startedAt, markerStartedAt(dir));
});

test('start creates the run folder and run.json when the folder is missing', (t) => {
  const dir = makeProject(t);

  const r = runStart(dir);
  assert.equal(r.status, 0);
  const info = JSON.parse(fs.readFileSync(runJsonPath(dir), 'utf8'));
  assert.equal(info.startedAt, markerStartedAt(dir));
});

test('allow stores project-relative forward-slash paths and keeps other fields', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);
  const before = readMarker(dir);

  const r = runMarker(dir, ['allow', 'src/a.js', './sub/b.js']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'Allowed for the planner: src/a.js, sub/b.js\n');

  const marker = readMarker(dir);
  assert.deepEqual(marker.allowed, ['src/a.js', 'sub/b.js']);
  assert.equal(marker.startedAt, before.startedAt);
  assert.equal(marker.runDir, before.runDir);
});

test('allow ignores duplicates', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);

  assert.equal(runMarker(dir, ['allow', 'src/a.js']).status, 0);
  assert.equal(runMarker(dir, ['allow', 'src/a.js']).status, 0);
  assert.deepEqual(readMarker(dir).allowed, ['src/a.js']);
});

test('allow without paths prints usage and exits 1', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);

  const r = runMarker(dir, ['allow']);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'usage: run-marker.js allow <path> [<path> ...]\n');
});

test('allow without an active marker exits 1 and writes nothing', (t) => {
  const dir = makeProject(t);

  const r = runMarker(dir, ['allow', 'src/a.js']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no active run; start one before allowing paths/);
  assert.equal(fs.existsSync(markerPathOf(dir)), false);
});

test('allow rejects a path outside the project and stores nothing', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);

  const r = runMarker(dir, ['allow', 'src/a.js', '../x.js']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.\.\/x\.js is outside the project/);
  assert.equal('allowed' in readMarker(dir), false);
});

test('allow rejects a path inside .deepseek-coder', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);

  const r = runMarker(dir, ['allow', '.deepseek-coder/config.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is inside \.deepseek-coder\/; the run folder and config are already writable/);
});

test('allow rejects an existing directory', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  const r = runMarker(dir, ['allow', 'src']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run-marker: src is a directory; allow files only/);
});

test('touch keeps the allowed list', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);
  assert.equal(runMarker(dir, ['allow', 'src/a.js']).status, 0);

  assert.equal(runMarker(dir, ['touch']).status, 0);
  assert.deepEqual(readMarker(dir).allowed, ['src/a.js']);
});

test('start creates a marker without an allowed list', (t) => {
  const dir = makeProject(t);
  assert.equal(runStart(dir).status, 0);
  assert.equal(runMarker(dir, ['allow', 'src/a.js']).status, 0);

  assert.equal(runStart(dir).status, 0);
  assert.equal('allowed' in readMarker(dir), false);
});
