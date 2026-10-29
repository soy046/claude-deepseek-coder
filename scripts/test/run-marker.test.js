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

function markerStartedAt(dir) {
  const markerPath = path.join(dir, '.deepseek-coder', 'plans', '.run-active');
  return JSON.parse(fs.readFileSync(markerPath, 'utf8')).startedAt;
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
