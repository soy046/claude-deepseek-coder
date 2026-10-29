#!/usr/bin/env node
// Manages the "delegation run active" marker that the edit guard hook reads.
// The marker lives at <project>/.deepseek-coder/plans/.run-active.
//
// Usage (run from the project root):
//   node run-marker.js start <runDir>   create the marker for a run, and <runDir>/run.json if missing
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

const [cmd, runDir] = process.argv.slice(2);
switch (cmd) {
  case 'start': {
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
    process.stderr.write('usage: run-marker.js <start <runDir> | touch | stop | status>\n');
    process.exit(1);
}
