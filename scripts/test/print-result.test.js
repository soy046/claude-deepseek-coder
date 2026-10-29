'use strict';
// Tests for print-result.js: the summary lines, the usage line, and the usage.jsonl record.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'print-result.js');
const USAGE = path.join(__dirname, '..', 'usage.js');
const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const MODEL = 'deepseek-flash[1m]';

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

// A temp project with `.deepseek-coder/config.json` and a run folder.
function makeProject(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-print-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.deepseek-coder'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.deepseek-coder', 'config.json'), JSON.stringify(config));
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  return { dir, runDir };
}

function copyLog(runDir, fixtureName, name) {
  const dest = path.join(runDir, name);
  fs.copyFileSync(path.join(FIXTURES, fixtureName), dest);
  return dest;
}

function run(dir, logPath) {
  return spawnSync(process.execPath, [SCRIPT, logPath, MODEL], { encoding: 'utf8', cwd: dir });
}

function usageLines(runDir) {
  const text = fs.readFileSync(path.join(runDir, 'usage.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function summary(logPath, costLine) {
  return [
    'Done.',
    '',
    'SESSION_ID: 8933c48e-3848-4887-94d1-698f355c9083',
    `MODEL: ${MODEL}`,
    'TURNS: 23   STATUS: success   ERROR: false',
    'USAGE: input 29,924 (cache read 408,960, cache write 0)  output 17,010',
    ...(costLine ? [costLine] : []),
    `LOG: ${logPath}`,
    '',
  ].join('\n');
}

test('prints the summary and usage, with no cost when pricing is unset', (t) => {
  const { dir, runDir } = makeProject(t, { deepseekPricing: null });
  const log = copyLog(runDir, 'coder-step-01.json', 'step-01.json');
  const r = run(dir, log);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, summary(log, null));
});

test('adds the estimated cost when pricing is set', (t) => {
  const { dir, runDir } = makeProject(t, {
    deepseekPricing: { input: 0.27, cacheHit: 0.07, output: 1.1, currency: 'USD' },
  });
  const log = copyLog(runDir, 'coder-step-01.json', 'step-01.json');
  const r = run(dir, log);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, summary(log, 'EST. DEEPSEEK COST: 0.0554 USD'));
});

test('appends one usage.jsonl line with the expected keys and values', (t) => {
  const { dir, runDir } = makeProject(t, { deepseekPricing: null });
  const log = copyLog(runDir, 'coder-step-01.json', 'step-01.json');
  run(dir, log);

  const lines = usageLines(runDir);
  assert.equal(lines.length, 1);
  const entry = lines[0];
  assert.deepEqual(Object.keys(entry), [
    'at',
    'spec',
    'sessionId',
    'turns',
    'status',
    'error',
    'input',
    'cacheRead',
    'cacheWrite',
    'output',
  ]);
  assert.equal(entry.spec, 'step-01.md');
  assert.equal(entry.sessionId, '8933c48e-3848-4887-94d1-698f355c9083');
  assert.equal(entry.turns, 23);
  assert.equal(entry.status, 'success');
  assert.equal(entry.error, false);
  assert.equal(entry.input, 29924);
  assert.equal(entry.cacheRead, 408960);
  assert.equal(entry.cacheWrite, 0);
  assert.equal(entry.output, 17010);
  assert.ok(!Number.isNaN(Date.parse(entry.at)));
});

test('two runs append two lines and usage.js totals them', (t) => {
  const { dir, runDir } = makeProject(t, {});
  run(dir, copyLog(runDir, 'coder-step-01.json', 'step-01.json'));
  run(dir, copyLog(runDir, 'coder-step-01-fix1.json', 'step-01-fix1.json'));

  const lines = usageLines(runDir);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].spec, 'step-01-fix1.md');
  assert.equal(lines[1].input, 1164);

  const table = spawnSync(process.execPath, [USAGE, runDir], { encoding: 'utf8', cwd: dir });
  assert.equal(table.status, 0);
  const totalRow = table.stdout.split('\n').find((line) => line.trim().startsWith('total'));
  assert.ok(totalRow, 'total row is present');
  assert.ok(totalRow.includes('31,088'), totalRow);
});

test('a failed run still prints usage and records it', (t) => {
  const { dir, runDir } = makeProject(t, { deepseekPricing: null });
  const failedLog = fixture('coder-step-01.json');
  failedLog.subtype = 'error_max_turns';
  failedLog.is_error = true;
  const log = path.join(runDir, 'step-02.json');
  fs.writeFileSync(log, JSON.stringify(failedLog));

  const r = run(dir, log);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^TURNS: 23   STATUS: error_max_turns   ERROR: true$/m);
  assert.match(r.stdout, /^USAGE: input 29,924 \(cache read 408,960, cache write 0\)  output 17,010$/m);

  const [entry] = usageLines(runDir);
  assert.equal(entry.status, 'error_max_turns');
  assert.equal(entry.error, true);
});

test('an invalid JSON log records nothing', (t) => {
  const { dir, runDir } = makeProject(t, { deepseekPricing: null });
  const log = path.join(runDir, 'step-03.json');
  fs.writeFileSync(log, 'not json');

  const r = run(dir, log);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.startsWith('Coder output was not valid JSON.'));
  assert.doesNotMatch(r.stdout, /USAGE/);
  assert.equal(fs.existsSync(path.join(runDir, 'usage.jsonl')), false);
});

test('an unwritable usage.jsonl does not change the output or exit code', (t) => {
  const { dir, runDir } = makeProject(t, { deepseekPricing: null });
  const log = copyLog(runDir, 'coder-step-01.json', 'step-01.json');
  fs.mkdirSync(path.join(runDir, 'usage.jsonl'));

  const r = run(dir, log);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^USAGE: input 29,924/m);
});

test('invalid pricing prints no cost line', (t) => {
  const { dir, runDir } = makeProject(t, { deepseekPricing: { input: 1 } });
  const log = copyLog(runDir, 'coder-step-01.json', 'step-01.json');

  const r = run(dir, log);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^USAGE: input 29,924/m);
  assert.doesNotMatch(r.stdout, /EST\. DEEPSEEK COST/);
});
