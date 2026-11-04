#!/usr/bin/env node
// Manages the "delegation run active" marker that the edit guard hook reads.
// The marker lives at <project>/.deepseek-coder/plans/.run-active.
//
// Usage (run from the project root):
//   node run-marker.js start <runDir>   create the marker for a run, and <runDir>/run.json if missing
//   node run-marker.js allow <path>...  let the planner write these project-relative files during the run
//   node run-marker.js touch            refresh the marker's activity time (no-op without a marker)
//   node run-marker.js stop             remove the marker
//   node run-marker.js status           print active / expired / none
//
// Expiry counts from the last activity (updatedAt), so long multi-step runs stay guarded.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDir = process.cwd();
const markerPath = path.join(projectDir, '.deepseek-coder', 'plans', '.run-active');

function expiryMinutes() {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'resolve-config.js'), '--project', projectDir, '--get', 'markerExpiryMinutes'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return Number(out) || 30;
  } catch {
    return 30;
  }
}

function readMarker() {
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    const t = fs.statSync(markerPath).mtime.toISOString();
    return { startedAt: t, updatedAt: t, runDir: '(unreadable marker)' };
  }
}

function writeMarker(m) {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(m, null, 2));
}

const argv = process.argv.slice(2);
const cmd = argv[0];
switch (cmd) {
  case 'start': {
    const runDir = argv[1];
    if (!runDir) {
      process.stderr.write('usage: run-marker.js start <runDir>\n');
      process.exit(1);
    }
    const now = new Date().toISOString();
    writeMarker({ startedAt: now, updatedAt: now, runDir });
    process.stdout.write(`Run marker created: ${markerPath}\n`);
    try {
      const runJson = path.join(path.resolve(projectDir, runDir), 'run.json');
      let keep = false;
      if (fs.existsSync(runJson)) {
        try {
          const info = JSON.parse(fs.readFileSync(runJson, 'utf8'));
          keep = info !== null && typeof info === 'object' && !Array.isArray(info);
        } catch {
          keep = false;
        }
      }
      if (!keep) {
        fs.mkdirSync(path.dirname(runJson), { recursive: true });
        fs.writeFileSync(runJson, JSON.stringify({ startedAt: now }, null, 2));
      }
    } catch {
      // Recording run.json is best-effort; it must not change start's output or exit code
    }
    break;
  }
  case 'allow': {
    const given = argv.slice(1);
    if (given.length === 0) {
      process.stderr.write('usage: run-marker.js allow <path> [<path> ...]\n');
      process.exit(1);
    }
    const noRun = () => {
      process.stderr.write('run-marker: no active run; start one before allowing paths\n');
      process.exit(1);
    };
    if (!fs.existsSync(markerPath)) noRun();
    let m;
    try {
      m = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch {
      noRun();
    }
    if (m === null || typeof m !== 'object' || Array.isArray(m)) noRun();
    const idleMin = (Date.now() - Date.parse(m.updatedAt || m.startedAt)) / 60000;
    if (!(idleMin <= expiryMinutes())) noRun();

    const win = process.platform === 'win32';
    const rels = [];
    for (const p of given) {
      const abs = path.resolve(projectDir, p);
      const rel = path.relative(projectDir, abs);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        process.stderr.write(`run-marker: ${p} is outside the project\n`);
        process.exit(1);
      }
      const first = rel.split(path.sep)[0];
      const hidden = win ? first.toLowerCase() === '.deepseek-coder' : first === '.deepseek-coder';
      if (hidden) {
        process.stderr.write(
          `run-marker: ${p} is inside .deepseek-coder/; the run folder and config are already writable\n`
        );
        process.exit(1);
      }
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        process.stderr.write(`run-marker: ${p} is a directory; allow files only\n`);
        process.exit(1);
      }
      rels.push(rel.split(path.sep).join('/'));
    }

    const key = (s) => (win ? s.toLowerCase() : s);
    const allowed = Array.isArray(m.allowed) ? m.allowed.slice() : [];
    const seen = new Set(allowed.filter((a) => typeof a === 'string').map(key));
    for (const rel of rels) {
      if (!seen.has(key(rel))) {
        allowed.push(rel);
        seen.add(key(rel));
      }
    }
    writeMarker({ ...m, allowed });
    process.stdout.write(`Allowed for the planner: ${rels.join(', ')}\n`);
    break;
  }
  case 'touch': {
    const m = readMarker();
    if (m) writeMarker({ ...m, updatedAt: new Date().toISOString() });
    break;
  }
  case 'stop': {
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
      process.stdout.write('Run marker removed.\n');
    } else {
      process.stdout.write('No run marker present.\n');
    }
    break;
  }
  case 'status': {
    const m = readMarker();
    if (!m) {
      process.stdout.write('none\n');
      break;
    }
    const idleMin = (Date.now() - Date.parse(m.updatedAt || m.startedAt)) / 60000;
    const state = idleMin > expiryMinutes() ? 'expired' : 'active';
    process.stdout.write(`${state} (run: ${m.runDir}, started ${m.startedAt}, last activity ${Math.round(idleMin)} min ago)\n`);
    break;
  }
  default:
    process.stderr.write('usage: run-marker.js <start <runDir> | allow <path>... | touch | stop | status>\n');
    process.exit(1);
}
