#!/usr/bin/env node
// Prints a coder run's JSON log (claude -p --output-format json) as the summary the planner reads.
// Usage: node print-result.js <log.json> <model>
// Exits 1 when the run failed or the log is not valid JSON.

'use strict';
const fs = require('fs');

const [logPath, model] = process.argv.slice(2);
const raw = fs.readFileSync(logPath, 'utf8');

let r;
try {
  r = JSON.parse(raw);
} catch {
  process.stdout.write(`Coder output was not valid JSON. Raw output saved to ${logPath}:\n\n${raw.slice(0, 2000)}\n`);
  process.exit(1);
}

const failed = r.is_error === true || (r.subtype && r.subtype !== 'success');
process.stdout.write(
  [
    r.result ? String(r.result) : '(no result text returned)',
    '',
    `SESSION_ID: ${r.session_id ?? 'unknown'}`,
    `MODEL: ${model}`,
    `TURNS: ${r.num_turns ?? '?'}   STATUS: ${r.subtype ?? 'unknown'}   ERROR: ${failed}`,
    `LOG: ${logPath}`,
    '',
  ].join('\n')
);
process.exit(failed ? 1 : 0);
