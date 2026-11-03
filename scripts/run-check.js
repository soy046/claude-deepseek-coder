#!/usr/bin/env node
// Runs one planner verify command, prints PASS or a short FAIL report, and appends the full output to a log.
// Usage: node run-check.js --log <file> "<cmd>"
// Exits with the command's exit code; 1 when the command was killed by a signal or could not start.
// Exits 2 on a usage error.

'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TAIL_LINES = 60;
// ANSI escape sequences, copied from the ansi-regex package.
const ANSI =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const argv = process.argv.slice(2);
const [flag, logArg, cmd] = argv;
if (argv.length !== 3 || flag !== '--log' || !logArg || !cmd) {
  process.stderr.write('usage: run-check.js --log <file> "<cmd>"\n');
  process.exit(2);
}

const logPath = path.resolve(logArg);
const start = Date.now();
const chunks = [];
let settled = false;

function done(code, signal, output) {
  if (settled) return;
  settled = true;
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  const stripped = output.replace(ANSI, '');
  const result = code === null ? `signal ${signal}` : `exit ${code}`;
  const exitCode = code === null ? 1 : code;

  const startedAt = new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z');
  let entry = `=== ${cmd} | ${startedAt} | ${result}, ${secs}s ===\n`;
  if (stripped) entry += stripped.endsWith('\n') ? stripped : `${stripped}\n`;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, entry);

  if (exitCode === 0) {
    process.stdout.write(`PASS ${cmd} (exit 0, ${secs}s)\n`);
  } else {
    const lines = stripped.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const tail = lines.slice(-TAIL_LINES);
    process.stdout.write([`FAIL ${cmd} (${result}, ${secs}s)`, ...tail, `Log: ${logPath}`].join('\n') + '\n');
  }
  process.exitCode = exitCode;
}

const child = spawn(cmd, {
  shell: true,
  env: { ...process.env, NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => chunks.push(chunk));
child.stderr.on('data', (chunk) => chunks.push(chunk));
child.on('error', (err) => done(1, null, err.message));
child.on('close', (code, signal) => done(code, signal, Buffer.concat(chunks).toString('utf8')));
