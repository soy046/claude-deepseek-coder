#!/usr/bin/env node
// Prints a coder run's JSON log (claude -p --output-format json) as the summary the planner reads.
// Usage: node print-result.js <log.json> <model>
// Also prints the run's token usage and appends it to usage.jsonl next to the log (read by usage.js).
// Exits 1 when the run failed or the log is not valid JSON.

'use strict';
const fs = require('fs');
const path = require('path');
const { fromResult, format, cost, formatCost, readPricing } = require('./usage');

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
const usage = fromResult(r);
const pricing = readPricing();
process.stdout.write(
  [
    r.result ? String(r.result) : '(no result text returned)',
    '',
    `SESSION_ID: ${r.session_id ?? 'unknown'}`,
    `MODEL: ${model}`,
    `TURNS: ${r.num_turns ?? '?'}   STATUS: ${r.subtype ?? 'unknown'}   ERROR: ${failed}`,
    format(usage),
    ...(pricing ? [`EST. DEEPSEEK COST: ${formatCost(cost(usage, pricing), pricing.currency)}`] : []),
    `LOG: ${logPath}`,
    '',
  ].join('\n')
);

try {
  const entry = {
    at: new Date().toISOString(),
    spec: path.basename(logPath).replace(/\.json$/, '.md'),
    sessionId: r.session_id ?? null,
    turns: typeof r.num_turns === 'number' ? r.num_turns : 0,
    status: r.subtype ?? 'unknown',
    error: failed,
    input: usage.input,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    output: usage.output,
  };
  fs.appendFileSync(path.join(path.dirname(logPath), 'usage.jsonl'), JSON.stringify(entry) + '\n');
} catch {}

process.exit(failed ? 1 : 0);
