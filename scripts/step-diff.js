#!/usr/bin/env node
// Working-tree snapshots for a delegation run, so each step and each fix round can be diffed on its own.
// A snapshot is a git tree written through a private index (GIT_INDEX_FILE), so the real index, HEAD and refs
// never change. Tree hashes are kept in <run folder>/.snap-<name>; the trees are unreferenced and git gc
// removes them eventually. .deepseek-coder/ is never included. Gitignored files are not captured.
//
// Usage (run from the project root):
//   node step-diff.js snap <run folder> <name>   take snapshot <name> (silent; skipped without a repo or if it exists)
//   node step-diff.js diff <run folder> <name>   full diff from snapshot <name> to the working tree
//   node step-diff.js stat <run folder> <NN>     the files step NN changed
//   node step-diff.js run <run folder>           the files the whole run changed, with the steps that touched them

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const STEP_RE = /^\d{2,}$/;
const STEP_SNAPSHOT_RE = /^\.snap-step-(\d{2,})$/;
const PATHSPEC = ['--', '.', ':(exclude).deepseek-coder'];
const USAGE =
  'usage: step-diff.js snap <run folder> <name> | diff <run folder> <name> | stat <run folder> <NN> | run <run folder>';

function git(args, env) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env || process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isRepo() {
  try {
    return git(['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

// Writes the working tree as a tree object through a throwaway index, then removes that index.
function writeTree(indexFile) {
  const index = path.resolve(indexFile);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    let hasHead = true;
    try {
      git(['rev-parse', '--verify', '-q', 'HEAD'], env);
    } catch {
      hasHead = false;
    }
    git(hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], env);
    // An exclude pathspec that names a gitignored path makes git add exit 1, so add the plugin folder, then drop it.
    // -f is needed because git add also stages the private index file inside the run folder.
    git(['add', '-A', '--', '.'], env);
    git(['rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', '--', '.deepseek-coder'], env);
    return git(['write-tree'], env).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

function readSnap(runFolder, name) {
  try {
    return fs.readFileSync(path.join(runFolder, '.snap-' + name), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function parseNumstat(out) {
  const counts = new Map();
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const parts = field.split('\t');
    if (parts.length >= 3) {
      counts.set(parts.slice(2).join('\t'), { added: parts[0], removed: parts[1] });
    } else if (parts.length === 2 && i + 1 < fields.length) {
      // Older git separates the counts and the path with NUL instead of a tab.
      counts.set(fields[++i], { added: parts[0], removed: parts[1] });
    }
  }
  for (const c of counts.values()) c.binary = c.added === '-' || c.removed === '-';
  return counts;
}

// Every path that differs between two trees, with its status letter and line counts.
function changes(a, b) {
  const statusOut = git(['diff', '--no-renames', '--relative', '--name-status', '-z', a, b, ...PATHSPEC]);
  const numstatOut = git(['diff', '--no-renames', '--relative', '--numstat', '-z', a, b, ...PATHSPEC]);
  const counts = parseNumstat(numstatOut);
  const list = [];
  const fields = statusOut.split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i];
    const file = fields[i + 1];
    if (!status || !file) break;
    const c = counts.get(file);
    const binary = !c || c.binary;
    list.push({
      status,
      path: file,
      added: binary ? null : Number(c.added),
      removed: binary ? null : Number(c.removed),
      binary,
    });
  }
  return list;
}

function countsText(f) {
  return f.binary ? 'binary' : `+${f.added} -${f.removed}`;
}

function fileLines(list) {
  const width = Math.max(...list.map((f) => f.path.length));
  return list.map((f) => `  ${f.status} ${f.path.padEnd(width)}   ${countsText(f)}`);
}

function runLines(list, stepsByPath) {
  const pathWidth = Math.max(...list.map((f) => f.path.length));
  const cells = list.map(countsText);
  const countsWidth = Math.max(...cells.map((c) => c.length));
  return list.map((f, i) => {
    const steps = stepsByPath.get(f.path) || [];
    const label = steps.length === 1 ? `(step ${steps[0]})` : `(steps ${steps.join(', ')})`;
    return `  ${f.status} ${f.path.padEnd(pathWidth)}   ${cells[i].padEnd(countsWidth)}  ${label}`;
  });
}

function workTree() {
  return writeTree(path.join(os.tmpdir(), 'dsc-snap-' + process.pid + '.idx'));
}

function nextStep(nn) {
  return String(Number(nn) + 1).padStart(nn.length, '0');
}

function stepSnapshots(runFolder) {
  let entries;
  try {
    entries = fs.readdirSync(runFolder);
  } catch {
    return [];
  }
  const steps = [];
  for (const entry of entries) {
    const m = STEP_SNAPSHOT_RE.exec(entry);
    if (m) steps.push(m[1]);
  }
  return steps.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function out(text) {
  process.stdout.write(text);
}

function takeSnapshot(runFolder, name) {
  if (!isRepo()) return;
  const snapFile = path.join(runFolder, '.snap-' + name);
  if (fs.existsSync(snapFile)) return;
  try {
    fs.mkdirSync(runFolder, { recursive: true });
    const tree = writeTree(path.join(runFolder, '.snap-index'));
    fs.writeFileSync(snapFile, tree + '\n');
  } catch (err) {
    // A snapshot must never fail the delegation run.
    const msg = String(err && err.message ? err.message : err).split(/\r?\n/)[0];
    process.stderr.write(`step-diff: snapshot ${name} failed: ${msg}\n`);
  }
}

function cmdDiff(runFolder, name) {
  if (!isRepo()) return out('not a git repository; no snapshots\n');
  const snap = readSnap(runFolder, name);
  if (!snap) return out(`no snapshot ${name} in ${runFolder}\n`);
  const diff = git(['diff', '--no-renames', '--relative', snap, workTree(), ...PATHSPEC]);
  out(diff === '' ? `no changes since snapshot ${name}\n` : diff);
}

function cmdStat(runFolder, nn) {
  if (!isRepo()) return out('not a git repository; no snapshots\n');
  const snap = readSnap(runFolder, 'step-' + nn);
  if (!snap) return out(`no snapshot for step ${nn} in ${runFolder}\n`);
  const next = readSnap(runFolder, 'step-' + nextStep(nn));
  const list = changes(snap, next || workTree());
  if (list.length === 0) return out(`Step ${nn} changed no files.\n`);
  const noun = list.length === 1 ? 'file' : 'files';
  out([`Step ${nn} changed ${list.length} ${noun}:`, ...fileLines(list)].join('\n') + '\n');
}

function cmdRun(runFolder) {
  if (!isRepo()) return out('not a git repository; no snapshots\n');
  const steps = stepSnapshots(runFolder);
  if (steps.length === 0) return out(`no step snapshots in ${runFolder}\n`);
  const tree = workTree();
  const first = readSnap(runFolder, 'step-' + steps[0]);
  const list = first ? changes(first, tree) : [];
  if (list.length === 0) return out('No files changed in this run.\n');
  // A file belongs to every step whose stat range (step NN to the next step, or the working tree) touched it.
  const stepsByPath = new Map();
  for (const nn of steps) {
    const from = readSnap(runFolder, 'step-' + nn);
    if (!from) continue;
    const to = readSnap(runFolder, 'step-' + nextStep(nn)) || tree;
    for (const f of changes(from, to)) {
      if (!stepsByPath.has(f.path)) stepsByPath.set(f.path, []);
      stepsByPath.get(f.path).push(nn);
    }
  }
  out(['Files changed in this run:', ...runLines(list, stepsByPath)].join('\n') + '\n');
}

function usage() {
  process.stderr.write(USAGE + '\n');
  process.exit(1);
}

function main(argv) {
  const [cmd, runFolder, name] = argv;
  switch (cmd) {
    case 'snap':
      if (!runFolder || !name || !NAME_RE.test(name)) usage();
      takeSnapshot(runFolder, name);
      break;
    case 'diff':
      if (!runFolder || !name) usage();
      cmdDiff(runFolder, name);
      break;
    case 'stat':
      if (!runFolder || !name || !STEP_RE.test(name)) usage();
      cmdStat(runFolder, name);
      break;
    case 'run':
      if (!runFolder) usage();
      cmdRun(runFolder);
      break;
    default:
      usage();
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { writeTree, readSnap, changes };
