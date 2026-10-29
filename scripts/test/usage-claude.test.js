'use strict';
// Tests for `usage.js claude`: the planner's tokens read from a Claude session transcript.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'usage.js');
const TRANSCRIPT = path.join(__dirname, '..', '__fixtures__', 'transcript', 'session-1.jsonl');

function usage() {
  return require(SCRIPT);
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A temp run folder with a run.json; omit `info` to leave run.json out.
function makeRun(t, info) {
  const dir = tmpDir('dsc-claude-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (info !== undefined) fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(info));
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

const TABLE_HEADER = '    model              messages  input  cache read  cache write  output';

function sinceTable(startedAt) {
  return [
    `  since run start (${startedAt}):`,
    TABLE_HEADER,
    '    claude-haiku-5-5          1      3         300            0      10',
    '    claude-opus-5-5           2     21       2,100            0      85',
    '    claude-sonnet-5-5         1      5         500           50      30',
    '    total                     4     29       2,900           50     125',
  ];
}

function report(runDir, sections) {
  return [`Claude usage in ${runDir} (best-effort, from the session transcript):`, ...sections, ''].join('\n');
}

test('claudeUsage dedupes messages and reads the subagents folder', () => {
  const entries = usage().claudeUsage(TRANSCRIPT);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries[0], {
    model: 'claude-opus-5-5',
    timestamp: '2026-10-29T10:00:05.000Z',
    input: 10,
    cacheRead: 1000,
    cacheWrite: 200,
    output: 50,
  });
  const msgB = entries.find((e) => e.timestamp === '2026-10-29T10:10:00.000Z');
  assert.equal(msgB.output, 80);
  assert.equal(entries.filter((e) => e.timestamp === '2026-10-29T10:30:00.000Z').length, 1);
  const sub = entries.filter((e) => e.model === 'claude-haiku-5-5');
  assert.equal(sub.length, 1);
  assert.deepEqual(sub[0], {
    model: 'claude-haiku-5-5',
    timestamp: '2026-10-29T10:15:00.000Z',
    input: 3,
    cacheRead: 300,
    cacheWrite: 0,
    output: 10,
  });
  assert.equal(entries.filter((e) => e.model === 'claude-opus-5-5').length, 3);
  assert.equal(entries.filter((e) => e.model === 'claude-sonnet-5-5').length, 1);
});

test('CLI prints both tables for the fixture transcript', (t) => {
  const startedAt = '2026-10-29T10:05:00.000Z';
  const runDir = makeRun(t, { startedAt, transcriptPath: TRANSCRIPT });
  const r = run(['claude', runDir]);
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout,
    report(runDir, [
      ...sinceTable(startedAt),
      '  whole session:',
      TABLE_HEADER,
      '    claude-haiku-5-5          1      3         300            0      10',
      '    claude-opus-5-5           3     31       3,100          200     135',
      '    claude-sonnet-5-5         1      5         500           50      30',
      '    total                     5     39       3,900          250     175',
    ])
  );
});

test('CLI prints no messages since a later run start', (t) => {
  const startedAt = '2026-10-29T11:00:00.000Z';
  const runDir = makeRun(t, { startedAt, transcriptPath: TRANSCRIPT });
  const r = run(['claude', runDir]);
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout,
    report(runDir, [
      `  since run start (${startedAt}):`,
      '    no messages',
      '  whole session:',
      TABLE_HEADER,
      '    claude-haiku-5-5          1      3         300            0      10',
      '    claude-opus-5-5           3     31       3,100          200     135',
      '    claude-sonnet-5-5         1      5         500           50      30',
      '    total                     5     39       3,900          250     175',
    ])
  );
});

test('CLI reports an unknown run start when startedAt is missing', (t) => {
  const runDir = makeRun(t, { transcriptPath: TRANSCRIPT });
  const r = run(['claude', runDir]);
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout,
    report(runDir, [
      '  since run start: unknown (no valid startedAt in run.json)',
      '  whole session:',
      TABLE_HEADER,
      '    claude-haiku-5-5          1      3         300            0      10',
      '    claude-opus-5-5           3     31       3,100          200     135',
      '    claude-sonnet-5-5         1      5         500           50      30',
      '    total                     5     39       3,900          250     175',
    ])
  );
});

test('CLI reports missing data without failing', (t) => {
  const empty = makeRun(t);
  let r = run(['claude', empty]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `no run.json in ${empty}\n`);

  const noTranscript = makeRun(t, { startedAt: '2026-10-29T10:05:00.000Z' });
  r = run(['claude', noTranscript]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `no transcript path recorded in ${path.join(noTranscript, 'run.json')}\n`);

  const missingPath = path.join(noTranscript, 'absent.jsonl');
  fs.writeFileSync(path.join(noTranscript, 'run.json'), JSON.stringify({ transcriptPath: missingPath }));
  r = run(['claude', noTranscript]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `transcript not found: ${missingPath}\n`);
});

test('CLI works without a subagents folder', (t) => {
  const startedAt = '2026-10-29T10:05:00.000Z';
  const runDir = makeRun(t, { startedAt });
  const copy = path.join(runDir, 'session-1.jsonl');
  fs.copyFileSync(TRANSCRIPT, copy);
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ startedAt, transcriptPath: copy }));
  const r = run(['claude', runDir]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.startsWith(`Claude usage in ${runDir} (best-effort, from the session transcript):\n`));
  assert.ok(r.stdout.includes(`  since run start (${startedAt}):\n`));

  const lines = r.stdout.trimEnd().split('\n');
  const whole = lines.slice(lines.indexOf('  whole session:'));
  const totalLine = whole.find((line) => line.trim().startsWith('total '));
  assert.deepEqual(totalLine.trim().split(/\s+/), ['total', '4', '36', '3,600', '250', '165']);
});

test('CLI usage errors exit 1', () => {
  let r = run(['claude']);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'usage: usage.js claude <run folder>\n');

  r = run([]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'usage: usage.js <run folder> | usage.js claude <run folder>\n');
});
