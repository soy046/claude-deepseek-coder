#!/usr/bin/env node
// PreToolUse hook for Edit|Write|NotebookEdit.
// While a delegation run is active, the planner may only edit the spec folder and the config file;
// source edits are DeepSeek's job. The coder process (DEEPSEEK_CODER_ACTIVE=1) is never blocked.
// It also records the planner's transcript path in the run folder's run.json (used by usage.js claude).

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.env.DEEPSEEK_CODER_ACTIVE === '1') process.exit(0);

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, ''));
} catch {
  process.exit(0);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const plansDir = path.join(projectDir, '.deepseek-coder', 'plans');
const markerPath = path.join(plansDir, '.run-active');
if (!fs.existsSync(markerPath)) process.exit(0);

let marker = {};
try {
  marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
} catch {
  marker.updatedAt = fs.statSync(markerPath).mtime.toISOString();
}

let expiry = 30;
try {
  const out = execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'resolve-config.js'), '--project', projectDir, '--get', 'markerExpiryMinutes'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  expiry = Number(out) || 30;
} catch {
  // Invalid config: keep the default expiry
}
const idleMin = (Date.now() - Date.parse(marker.updatedAt || marker.startedAt)) / 60000;
if (!(idleMin <= expiry)) process.exit(0); // stale marker is ignored

const ti = input.tool_input || {};
const target = ti.file_path || ti.notebook_path;
if (!target) process.exit(0);

const norm = (p) => {
  const r = path.resolve(projectDir, p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
const t = norm(target);

function recordTranscript() {
  try {
    if (typeof marker.runDir !== 'string' || !marker.runDir) return;
    if (typeof input.transcript_path !== 'string' || !input.transcript_path) return;
    const runJson = path.join(path.resolve(projectDir, marker.runDir), 'run.json');
    if (!fs.existsSync(runJson)) return;
    const info = JSON.parse(fs.readFileSync(runJson, 'utf8'));
    if (info === null || typeof info !== 'object' || Array.isArray(info)) return;
    if (typeof info.transcriptPath === 'string' && info.transcriptPath) return;
    fs.writeFileSync(runJson, JSON.stringify({ ...info, transcriptPath: input.transcript_path }, null, 2));
  } catch {
    // Recording the transcript is best-effort
  }
}

if (typeof marker.runDir === 'string' && marker.runDir && t.startsWith(norm(marker.runDir) + path.sep)) {
  recordTranscript();
}

const plans = norm(plansDir) + path.sep;
const config = norm(path.join(projectDir, '.deepseek-coder', 'config.json'));
if (t.startsWith(plans) || t === config) process.exit(0);

process.stderr.write(
  `deepseek-coder: a delegation run is active (${marker.runDir || 'unknown run'}), so the planner may not edit ${target}. ` +
    'Write a fix spec in the run folder and delegate it to DeepSeek, or stop and ask the user. ' +
    'If the user tells you to edit it yourself, end the run first with run-marker.js stop. ' +
    'If no run is active, the user can clear the marker with /deepseek-coder:reset.\n'
);
process.exit(2);
