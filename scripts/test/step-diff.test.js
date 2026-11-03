'use strict';
// Tests for step-diff.js: private-index snapshots, per-step stat, fix-round diffs and the run list.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'step-diff.js');
const R = '.deepseek-coder/plans/r';
const USAGE_LINE =
  'usage: step-diff.js snap <run folder> <name> | diff <run folder> <name> | stat <run folder> <NN> | run <run folder>\n';

function git(dir, args) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd: dir });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function runStepDiff(dir, ...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: dir });
}

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-diff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeRepo(t) {
  const dir = makeTempDir(t);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

function commitAll(dir) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

function put(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function snapFile(dir, name) {
  return path.join(dir, R, '.snap-' + name);
}

function repoState(dir) {
  return [
    git(dir, ['ls-files', '--stage']),
    git(dir, ['diff', '--cached']),
    git(dir, ['rev-parse', 'HEAD']),
    git(dir, ['for-each-ref']),
  ];
}

test('snap leaves the real index, HEAD and refs untouched', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  commitAll(dir);
  put(dir, 's.txt', 'staged\n');
  git(dir, ['add', 's.txt']);

  const before = repoState(dir);
  const r = runStepDiff(dir, 'snap', R, 'step-01');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');

  assert.match(fs.readFileSync(snapFile(dir, 'step-01'), 'utf8'), /^[0-9a-f]{40}\n$/);
  assert.equal(fs.existsSync(path.join(dir, R, '.snap-index')), false);
  assert.deepEqual(repoState(dir), before);
});

test('snap keeps the first snapshot for a name', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  commitAll(dir);
  assert.equal(runStepDiff(dir, 'snap', R, 'step-01').status, 0);
  const first = fs.readFileSync(snapFile(dir, 'step-01'), 'utf8');

  put(dir, 'a.txt', '1\n2\n');
  const again = runStepDiff(dir, 'snap', R, 'step-01');
  assert.equal(again.status, 0);
  assert.equal(again.stdout, '');
  assert.equal(fs.readFileSync(snapFile(dir, 'step-01'), 'utf8'), first);
});

test('stat lists every kind of change and skips .deepseek-coder', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  put(dir, 'c.txt', 'z\n');
  commitAll(dir);
  runStepDiff(dir, 'snap', R, 'step-01');

  put(dir, 'a.txt', '1\n2\n');
  put(dir, 'b.txt', 'x\ny\n');
  fs.rmSync(path.join(dir, 'c.txt'));
  put(dir, 'ü x.txt', 'q\n');
  put(dir, '.deepseek-coder/plans/r/note.md', 'note\n');

  const r = runStepDiff(dir, 'stat', R, '01');
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout,
    [
      'Step 01 changed 4 files:',
      '  M a.txt     +1 -0',
      '  A b.txt     +2 -0',
      '  D c.txt     +0 -1',
      '  A ü x.txt   +1 -0',
      '',
    ].join('\n')
  );
});

test('a fix-round diff shows only the fix and stat still spans the whole step', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  put(dir, 'c.txt', 'z\n');
  commitAll(dir);
  runStepDiff(dir, 'snap', R, 'step-01');

  put(dir, 'a.txt', '1\n2\n');
  put(dir, 'b.txt', 'x\ny\n');
  fs.rmSync(path.join(dir, 'c.txt'));
  put(dir, 'ü x.txt', 'q\n');
  runStepDiff(dir, 'snap', R, 'step-01-fix1');
  fs.appendFileSync(path.join(dir, 'a.txt'), '3\n');

  const diff = runStepDiff(dir, 'diff', R, 'step-01-fix1');
  assert.equal(diff.status, 0);
  assert.match(diff.stdout, /a\.txt/);
  assert.match(diff.stdout, /\+3/);
  assert.doesNotMatch(diff.stdout, /b\.txt/);

  const stat = runStepDiff(dir, 'stat', R, '01');
  assert.equal(
    stat.stdout,
    [
      'Step 01 changed 4 files:',
      '  M a.txt     +2 -0',
      '  A b.txt     +2 -0',
      '  D c.txt     +0 -1',
      '  A ü x.txt   +1 -0',
      '',
    ].join('\n')
  );
});

test('two steps: stat per step and the run list with step numbers', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  commitAll(dir);
  runStepDiff(dir, 'snap', R, 'step-01');
  put(dir, 'a.txt', '1\n2\n');
  put(dir, 'b.txt', 'x\ny\n');
  runStepDiff(dir, 'snap', R, 'step-02');
  fs.appendFileSync(path.join(dir, 'b.txt'), 'z\n');
  fs.writeFileSync(path.join(dir, 'd.bin'), Buffer.from([0, 1, 2, 0, 255]));

  const stat01 = runStepDiff(dir, 'stat', R, '01');
  assert.equal(stat01.status, 0);
  assert.equal(stat01.stdout, ['Step 01 changed 2 files:', '  M a.txt   +1 -0', '  A b.txt   +2 -0', ''].join('\n'));

  const stat02 = runStepDiff(dir, 'stat', R, '02');
  assert.equal(stat02.status, 0);
  assert.equal(stat02.stdout, ['Step 02 changed 2 files:', '  M b.txt   +1 -0', '  A d.bin   binary', ''].join('\n'));

  const run = runStepDiff(dir, 'run', R);
  assert.equal(run.status, 0);
  assert.equal(
    run.stdout,
    [
      'Files changed in this run:',
      '  M a.txt   +1 -0   (step 01)',
      '  A b.txt   +3 -0   (steps 01, 02)',
      '  A d.bin   binary  (step 02)',
      '',
    ].join('\n')
  );
});

test('works in a repo with no commits', (t) => {
  const dir = makeRepo(t);
  const snap = runStepDiff(dir, 'snap', R, 'step-01');
  assert.equal(snap.status, 0);
  assert.match(fs.readFileSync(snapFile(dir, 'step-01'), 'utf8'), /^[0-9a-f]{40}\n$/);

  put(dir, 'n.txt', 'n\n');
  const r = runStepDiff(dir, 'stat', R, '01');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'Step 01 changed 1 file:\n  A n.txt   +1 -0\n');
});

test('an empty step and an empty run', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  commitAll(dir);
  runStepDiff(dir, 'snap', R, 'step-01');

  const stat = runStepDiff(dir, 'stat', R, '01');
  assert.equal(stat.status, 0);
  assert.equal(stat.stdout, 'Step 01 changed no files.\n');

  const run = runStepDiff(dir, 'run', R);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, 'No files changed in this run.\n');

  const diff = runStepDiff(dir, 'diff', R, 'step-01');
  assert.equal(diff.status, 0);
  assert.equal(diff.stdout, 'no changes since snapshot step-01\n');
});

test('missing snapshots print one line and exit 0', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  commitAll(dir);

  const stat = runStepDiff(dir, 'stat', 'r', '05');
  assert.equal(stat.status, 0);
  assert.equal(stat.stdout, 'no snapshot for step 05 in r\n');

  const diff = runStepDiff(dir, 'diff', 'r', 'step-09');
  assert.equal(diff.status, 0);
  assert.equal(diff.stdout, 'no snapshot step-09 in r\n');

  const run = runStepDiff(dir, 'run', 'r');
  assert.equal(run.status, 0);
  assert.equal(run.stdout, 'no step snapshots in r\n');
});

test('outside a git repository every command says so and exits 0', (t) => {
  const dir = makeTempDir(t);

  const snap = runStepDiff(dir, 'snap', R, 'step-01');
  assert.equal(snap.status, 0);
  assert.equal(snap.stdout, '');
  assert.equal(fs.existsSync(path.join(dir, '.deepseek-coder')), false);

  for (const args of [
    ['stat', R, '01'],
    ['diff', R, 'step-01'],
    ['run', R],
  ]) {
    const r = runStepDiff(dir, ...args);
    assert.equal(r.status, 0, args.join(' '));
    assert.equal(r.stdout, 'not a git repository; no snapshots\n');
  }
});

test('usage errors exit 1', (t) => {
  const dir = makeTempDir(t);
  for (const args of [[], ['snap', 'r'], ['snap', 'r', 'a/b'], ['stat', 'r', '1']]) {
    const r = runStepDiff(dir, ...args);
    assert.equal(r.status, 1, `args: ${args.join(' ')}`);
    assert.equal(r.stderr, USAGE_LINE);
  }
});

test('works when .deepseek-coder is gitignored', (t) => {
  const dir = makeRepo(t);
  put(dir, '.gitignore', '.deepseek-coder/\n');
  put(dir, 'a.txt', '1\n');
  commitAll(dir);

  const snap = runStepDiff(dir, 'snap', R, 'step-01');
  assert.equal(snap.status, 0);
  assert.equal(snap.stderr, '');
  assert.equal(fs.existsSync(snapFile(dir, 'step-01')), true);

  put(dir, 'a.txt', '1\n2\n');
  put(dir, 'b.txt', 'x\n');
  put(dir, '.deepseek-coder/plans/r/note.md', 'note\n');

  const stat = runStepDiff(dir, 'stat', R, '01');
  assert.equal(stat.status, 0);
  assert.equal(stat.stdout, ['Step 01 changed 2 files:', '  M a.txt   +1 -0', '  A b.txt   +1 -0', ''].join('\n'));

  const diff = runStepDiff(dir, 'diff', R, 'step-01');
  assert.equal(diff.status, 0);
  assert.match(diff.stdout, /b\.txt/);
  assert.doesNotMatch(diff.stdout, /note\.md/);
});

test('a failed snapshot warns on stderr and exits 0', (t) => {
  const dir = makeRepo(t);
  put(dir, 'a.txt', '1\n');
  commitAll(dir);
  put(dir, R, 'not a folder\n');

  const snap = runStepDiff(dir, 'snap', R, 'step-01');
  assert.equal(snap.status, 0);
  assert.equal(snap.stdout, '');
  assert.match(snap.stderr, /^step-diff: snapshot step-01 failed: .+\n$/);
});
