'use strict';
// Tests for run-check.js: PASS/FAIL output, the tail report, the log file, and the exit codes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'run-check.js');

function makeTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(dir, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: dir });
}

function stdoutLines(r) {
  return r.stdout.replace(/\n$/, '').split('\n');
}

test('a passing command prints one PASS line and logs the output', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');
  const cmd = `node -e "console.log('hi')"`;

  const r = run(dir, ['--log', log, cmd]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^PASS node -e "console\.log\('hi'\)" \(exit 0, \d+\.\ds\)\n$/);

  const text = fs.readFileSync(log, 'utf8');
  assert.match(text, /^=== node -e .* \| \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \| exit 0, \d+\.\ds ===$/m);
  assert.match(text, /^=== node -e .* \| .* ===\nhi\n$/m);
});

test('a failing command with a long output prints the last 60 lines', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');
  const cmd = `node -e "for(let i=1;i<=100;i++)console.log('line '+i);process.exit(1)"`;

  const r = run(dir, ['--log', log, cmd]);
  assert.equal(r.status, 1);
  const lines = stdoutLines(r);
  assert.ok(lines[0].startsWith('FAIL '), lines[0]);
  assert.ok(lines[0].includes('(exit 1, '), lines[0]);
  const expected = Array.from({ length: 60 }, (_, i) => `line ${i + 41}`);
  assert.deepEqual(lines.slice(1, 61), expected);
  assert.equal(lines[61], `Log: ${path.resolve(log)}`);
  assert.equal(lines.length, 62);

  const text = fs.readFileSync(log, 'utf8');
  for (const n of [1, 41, 100]) assert.match(text, new RegExp(`^line ${n}$`, 'm'));
});

test('a short failing output exits with the command exit code', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');
  const cmd = `node -e "console.log('l1');console.log('l2');console.log('l3');process.exit(2)"`;

  const r = run(dir, ['--log', log, cmd]);
  assert.equal(r.status, 2);
  const lines = stdoutLines(r);
  assert.ok(lines[0].startsWith('FAIL '), lines[0]);
  assert.ok(lines[0].includes('(exit 2, '), lines[0]);
  assert.deepEqual(lines.slice(1, 4), ['l1', 'l2', 'l3']);
  assert.equal(lines[4], `Log: ${path.resolve(log)}`);
});

test('two runs append two entries to the same log', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');
  const passCmd = `node -e "console.log('first-run')"`;
  const failCmd = `node -e "console.log('second-run');process.exit(3)"`;

  const first = run(dir, ['--log', log, passCmd]);
  assert.equal(first.status, 0);
  const second = run(dir, ['--log', log, failCmd]);
  assert.equal(second.status, 3);

  const text = fs.readFileSync(log, 'utf8');
  const headers = text.match(/^=== .*$/gm);
  assert.equal(headers.length, 2);
  assert.match(headers[0], /\| exit 0, \d+\.\ds ===$/);
  assert.match(headers[1], /\| exit 3, \d+\.\ds ===$/);
  assert.ok(text.indexOf('first-run') !== -1);
  assert.ok(text.indexOf('first-run') < text.indexOf('second-run'));
});

test('creates a missing log folder', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'a', 'b', 'x.log');

  const r = run(dir, ['--log', log, `node -e "console.log('hi')"`]);
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(log));
});

test('strips ANSI escapes from stdout and the log', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');
  const cmd = `node -e "console.log('\\x1b[31mred\\x1b[0m');process.exit(1)"`;

  const r = run(dir, ['--log', log, cmd]);
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes('\x1b'), 'stdout has no escape');
  assert.ok(r.stdout.includes('red'));
  const text = fs.readFileSync(log, 'utf8');
  assert.ok(!text.includes('\x1b'), 'log has no escape');
  assert.ok(text.includes('red'));
});

test('sets NO_COLOR for the child', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');

  const r = run(dir, ['--log', log, `node -e "console.log('NC=' + process.env.NO_COLOR)"`]);
  assert.equal(r.status, 0);
  assert.ok(fs.readFileSync(log, 'utf8').includes('NC=1'));
});

test('merges stderr into the output', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');

  const r = run(dir, ['--log', log, `node -e "console.error('to-stderr');process.exit(1)"`]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('to-stderr'));
  assert.ok(fs.readFileSync(log, 'utf8').includes('to-stderr'));
});

test('passes quoted arguments through the shell', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');

  const r = run(dir, ['--log', log, `node -e "console.log(process.argv[1])" "a b"`]);
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(log, 'utf8'), /^a b$/m);
});

test('runs && commands through the shell', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');
  const cmd = `node -e "console.log('first')" && node -e "console.log('second')"`;

  const r = run(dir, ['--log', log, cmd]);
  assert.equal(r.status, 0);
  const text = fs.readFileSync(log, 'utf8');
  assert.ok(text.includes('first'));
  assert.ok(text.includes('second'));
});

test('usage errors exit 2 and write no log', (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');
  const USAGE = 'usage: run-check.js --log <file> "<cmd>"\n';

  const cases = [[], ['--log', log], [`node -e "console.log('hi')"`]];
  for (const args of cases) {
    const r = run(dir, args);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, USAGE);
    assert.equal(fs.existsSync(log), false);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
});

test('a signal is reported as signal <NAME>', { skip: process.platform === 'win32' }, (t) => {
  const dir = makeTmp(t);
  const log = path.join(dir, 'run.log');

  const r = run(dir, ['--log', log, `node -e "process.kill(process.pid, 'SIGTERM')"`]);
  assert.equal(r.status, 1);
  assert.ok(stdoutLines(r)[0].includes('(signal SIGTERM, '), r.stdout);
});
