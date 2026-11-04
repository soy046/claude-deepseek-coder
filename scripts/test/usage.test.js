'use strict';
// Tests for usage.js: reading a coder log's usage block, pricing it, and the run-folder table.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'usage.js');
const FIXTURES = path.join(__dirname, '..', '__fixtures__');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(dir, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: dir });
}

// Writes a run folder's usage.jsonl from the fixtures, the way print-result.js records it.
function makeRun(dir) {
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const lines = [
    { at: '2026-10-27T00:59:00Z', spec: 'step-01.md', sessionId: '8933c48e-3848-4887-94d1-698f355c9083', turns: 23, replies: 12, toolCalls: 22, status: 'success', error: null, input: 29924, cacheRead: 408960, cacheWrite: 0, output: 17010 },
    { at: '2026-10-27T00:59:00Z', spec: 'step-01-fix1.md', sessionId: '8933c48e-3848-4887-94d1-698f355c9083', turns: 5, replies: 3, toolCalls: 4, status: 'success', error: null, input: 1164, cacheRead: 137856, cacheWrite: 0, output: 791 },
    { at: '2026-10-27T01:01:00Z', spec: 'step-02.md', sessionId: '5dc82cb6-5a43-4f89-8a29-f38a9fc8b6d5', turns: 4, replies: 2, toolCalls: 3, status: 'success', error: null, input: 14055, cacheRead: 40704, cacheWrite: 0, output: 488 },
  ];
  fs.writeFileSync(path.join(runDir, 'usage.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return runDir;
}

function makeProject(config) {
  const dir = tmpDir('dsc-usage-');
  fs.mkdirSync(path.join(dir, '.deepseek-coder'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.deepseek-coder', 'config.json'), JSON.stringify(config));
  return dir;
}

function table(runDir, cost) {
  return [
    `DeepSeek usage in ${runDir}:`,
    '  spec             replies  tool calls   input  cache read  cache write  output  status',
    '  step-01.md            12          22  29,924     408,960            0  17,010  success',
    '  step-01-fix1.md        3           4   1,164     137,856            0     791  success',
    '  step-02.md             2           3  14,055      40,704            0     488  success',
    '  total                 17          29  45,143     587,520            0  18,289',
    ...(cost ? [cost] : []),
    '',
  ].join('\n');
}

test('fromResult reads the single-run usage block', () => {
  assert.deepEqual(usage().fromResult(fixture('coder-step-01.json')), {
    input: 29924,
    cacheRead: 408960,
    cacheWrite: 0,
    output: 17010,
  });
});

test('fromResult ignores the cumulative modelUsage totals', () => {
  assert.deepEqual(usage().fromResult(fixture('coder-step-01-fix1.json')), {
    input: 1164,
    cacheRead: 137856,
    cacheWrite: 0,
    output: 791,
  });
});

test('fromResult treats missing or non-numeric usage as zero', () => {
  const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  assert.deepEqual(usage().fromResult(fixture('coder-no-usage.json')), zero);
  assert.deepEqual(usage().fromResult({}), zero);
  assert.deepEqual(usage().fromResult({ usage: { input_tokens: 'x', output_tokens: null } }), zero);
});

test('format renders numbers with en-US grouping', () => {
  const u = usage().fromResult(fixture('coder-step-01.json'));
  assert.equal(usage().format(u), 'USAGE: input 29,924 (cache read 408,960, cache write 0)  output 17,010');
});

test('cost and formatCost price a usage total', () => {
  const { cost, formatCost, fromResult } = usage();
  const u = fromResult(fixture('coder-step-01.json'));
  const p = { input: 0.27, cacheHit: 0.07, output: 1.1 };
  assert.ok(Math.abs(cost(u, p) - 0.05541768) <= 1e-12);
  assert.equal(formatCost(0.05541768, 'USD'), '0.0554 USD');
  assert.equal(cost({ input: 0, cacheRead: 0, cacheWrite: 1000000, output: 0 }, { input: 2, cacheHit: 1, output: 1 }), 2);
});

test('readUsageLog counts entries and skips unreadable lines', (t) => {
  const dir = tmpDir('dsc-usage-log-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'usage.jsonl'),
    ['{"spec":"a","turns":1}', 'not json', '', '{"spec":"b","turns":2}', '{"spec":"c","turns":3}', ''].join('\n')
  );
  const { entries, skipped } = usage().readUsageLog(dir);
  assert.equal(entries.length, 3);
  assert.equal(skipped, 1);

  const empty = tmpDir('dsc-usage-empty-');
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.deepEqual(usage().readUsageLog(empty), { entries: [], skipped: 0 });
});

test('CLI prints the table and no cost when pricing is unset', (t) => {
  const dir = makeProject({ deepseekPricing: null });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runDir = makeRun(dir);
  const r = run(dir, [runDir]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, table(runDir, null));
});

test('CLI adds the estimated cost when pricing is set', (t) => {
  const dir = makeProject({ deepseekPricing: { input: 0.27, cacheHit: 0.07, output: 1.1, currency: 'USD' } });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runDir = makeRun(dir);
  const r = run(dir, [runDir]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, table(runDir, '  est. cost 0.0734 USD'));
});

test('CLI reports an empty run folder', (t) => {
  const dir = makeProject({});
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runDir = path.join(dir, 'empty-run');
  fs.mkdirSync(runDir, { recursive: true });
  const r = run(dir, [runDir]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `no usage recorded in ${runDir}\n`);
});

test('CLI exits 1 without a run folder argument', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: usage\.js <run folder>/);
});

// Loads usage.js as a module; its CLI block runs only when it is the main script.
function usage() {
  return require(SCRIPT);
}

test('CLI shows ? for records without reply counts and marks the total', (t) => {
  const dir = tmpDir('dsc-usage-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const lines = [
    { spec: 'step-01.md', turns: 23, status: 'success', input: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
    { spec: 'step-02.md', turns: 4, replies: 2, toolCalls: 3, status: 'success', input: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
  ];
  fs.writeFileSync(path.join(runDir, 'usage.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = run(dir, [runDir]);
  assert.equal(r.status, 0);
  const rows = r.stdout.split('\n').map((l) => l.trim().split(/ +/));
  assert.deepEqual(rows.find((c) => c[0] === 'step-01.md').slice(1, 3), ['?', '?']);
  assert.deepEqual(rows.find((c) => c[0] === 'total').slice(1, 3), ['2+?', '3+?']);
});

test('CLI shows ? totals when no record has reply counts', (t) => {
  const dir = tmpDir('dsc-usage-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'usage.jsonl'), JSON.stringify({ spec: 'step-01.md', turns: 3, status: 'success' }) + '\n');
  const r = run(dir, [runDir]);
  const total = r.stdout.split('\n').map((l) => l.trim().split(/ +/)).find((c) => c[0] === 'total');
  assert.deepEqual(total.slice(1, 3), ['?', '?']);
});

test('coderReplies counts distinct replies and tool calls, filtered by since', (t) => {
  const { coderReplies } = require('../usage');
  const dir = tmpDir('dsc-replies-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = path.join(dir, 'projects', 'P');
  fs.mkdirSync(folder, { recursive: true });
  const msg = (id, ts, tools) => ({
    type: 'assistant',
    timestamp: ts,
    message: { id, content: tools.map((x) => ({ type: 'tool_use', id: x, name: 'Grep', input: {} })) },
  });
  const lines = [
    msg('a', '2026-11-04T09:00:00Z', ['t1']),
    msg('b', '2026-11-04T10:00:01Z', ['t2', 't3']),
    msg('b', '2026-11-04T10:00:02Z', ['t4']),
    { type: 'user', timestamp: '2026-11-04T10:00:03Z', message: { content: [{ type: 'tool_result' }] } },
    msg('c', '2026-11-04T10:00:04Z', []),
  ];
  fs.writeFileSync(path.join(folder, 'abc-123.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n');

  assert.deepEqual(coderReplies('abc-123', '2026-11-04T10:00:00Z', dir), { replies: 2, toolCalls: 3 });
  assert.deepEqual(coderReplies('abc-123', null, dir), { replies: 3, toolCalls: 4 });
  assert.deepEqual(coderReplies('abc-123', 'not a time', dir), { replies: 3, toolCalls: 4 });
  assert.equal(coderReplies('missing', null, dir), null);
  assert.equal(coderReplies('../x', null, dir), null);
  assert.equal(coderReplies(null, null, dir), null);
  assert.equal(coderReplies('abc-123', null, path.join(dir, 'nope')), null);
});
