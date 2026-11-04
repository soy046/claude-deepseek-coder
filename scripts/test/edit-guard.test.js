'use strict';
// Tests for edit-guard.js: blocking source edits and recording the planner's transcript path.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', 'hooks', 'edit-guard.js');
const RUN_DIR = '.deepseek-coder/plans/r1';
const STARTED_AT = '2026-10-29T10:00:00.000Z';

// A temp project with `.deepseek-coder/config.json`, the run folder, and an active marker.
function makeProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, RUN_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, '.deepseek-coder', 'config.json'), '{}');
  writeMarker(dir);
  return dir;
}

function writeMarker(dir) {
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(dir, '.deepseek-coder', 'plans', '.run-active'),
    JSON.stringify({ startedAt: now, updatedAt: now, runDir: RUN_DIR }, null, 2)
  );
}

function runJsonPath(dir) {
  return path.join(dir, RUN_DIR, 'run.json');
}

function writeRunJson(dir, content) {
  fs.writeFileSync(runJsonPath(dir), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

function defaultRunJson(dir) {
  writeRunJson(dir, `{"startedAt":"${STARTED_AT}"}`);
}

// Runs the guard with a Write of `filePath`, optionally carrying `transcriptPath`.
function runGuard(dir, filePath, transcriptPath) {
  const hookInput = { tool_name: 'Write', tool_input: { file_path: filePath } };
  if (transcriptPath !== undefined) hookInput.transcript_path = transcriptPath;
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  delete env.DEEPSEEK_CODER_ACTIVE;
  return spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', input: JSON.stringify(hookInput), env });
}

test('records the transcript path on a write into the run folder', (t) => {
  const dir = makeProject(t);
  defaultRunJson(dir);

  const r = runGuard(dir, path.join(dir, RUN_DIR, 'step-01.md'), 'C:/t/a.jsonl');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(runJsonPath(dir), 'utf8')), {
    startedAt: STARTED_AT,
    transcriptPath: 'C:/t/a.jsonl',
  });
});

test('keeps the first transcript path on a second write', (t) => {
  const dir = makeProject(t);
  defaultRunJson(dir);

  assert.equal(runGuard(dir, path.join(dir, RUN_DIR, 'step-01.md'), 'C:/t/a.jsonl').status, 0);
  const r = runGuard(dir, path.join(dir, RUN_DIR, 'step-02.md'), 'C:/t/b.jsonl');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(runJsonPath(dir), 'utf8')).transcriptPath, 'C:/t/a.jsonl');
});

test('blocks a source write and leaves run.json unchanged', (t) => {
  const dir = makeProject(t);
  defaultRunJson(dir);
  const before = fs.readFileSync(runJsonPath(dir), 'utf8');

  const r = runGuard(dir, path.join(dir, 'src', 'x.js'), 'C:/t/a.jsonl');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /a delegation run is active/);
  assert.equal(fs.readFileSync(runJsonPath(dir), 'utf8'), before);
});

test('allows a write into another plans folder without touching run.json', (t) => {
  const dir = makeProject(t);
  defaultRunJson(dir);
  const before = fs.readFileSync(runJsonPath(dir), 'utf8');

  const r = runGuard(dir, path.join(dir, '.deepseek-coder', 'plans', 'other', 'x.md'), 'C:/t/a.jsonl');
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(runJsonPath(dir), 'utf8'), before);
});

test('a write without transcript_path leaves run.json unchanged', (t) => {
  const dir = makeProject(t);
  defaultRunJson(dir);
  const before = fs.readFileSync(runJsonPath(dir), 'utf8');

  const r = runGuard(dir, path.join(dir, RUN_DIR, 'step-01.md'));
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(runJsonPath(dir), 'utf8'), before);
});

test('does not create run.json when it is missing', (t) => {
  const dir = makeProject(t);

  const r = runGuard(dir, path.join(dir, RUN_DIR, 'step-01.md'), 'C:/t/a.jsonl');
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(runJsonPath(dir)), false);
});

test('leaves an unparsable run.json as it is', (t) => {
  const dir = makeProject(t);
  writeRunJson(dir, 'not json');

  const r = runGuard(dir, path.join(dir, RUN_DIR, 'step-01.md'), 'C:/t/a.jsonl');
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(runJsonPath(dir), 'utf8'), 'not json');
});

test('without a marker nothing is recorded', (t) => {
  const dir = makeProject(t);
  defaultRunJson(dir);
  const before = fs.readFileSync(runJsonPath(dir), 'utf8');
  fs.unlinkSync(path.join(dir, '.deepseek-coder', 'plans', '.run-active'));

  const r = runGuard(dir, path.join(dir, RUN_DIR, 'step-01.md'), 'C:/t/a.jsonl');
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(runJsonPath(dir), 'utf8'), before);
});
