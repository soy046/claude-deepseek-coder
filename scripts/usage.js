#!/usr/bin/env node
// DeepSeek token usage for coder runs.
// `usage` in a coder log (claude -p --output-format json) covers that one coder run, all its turns.
// `modelUsage` and `total_cost_usd` add up across --resume and use Claude prices, so they are not used.
//
// Usage (run from the project root):
//   node usage.js <run folder>   table of every coder run recorded in <run folder>/usage.jsonl

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// A missing or non-finite number counts as 0.
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Reads one coder log's `usage` block (a single run, all its turns).
function fromResult(r) {
  const u = r && typeof r === 'object' && r.usage && typeof r.usage === 'object' ? r.usage : {};
  return {
    input: num(u.input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    output: num(u.output_tokens),
  };
}

function format(u) {
  const n = (v) => num(v).toLocaleString('en-US');
  return `USAGE: input ${n(u.input)} (cache read ${n(u.cacheRead)}, cache write ${n(u.cacheWrite)})  output ${n(u.output)}`;
}

// Prices are per 1M tokens; cache writes are billed at the plain input price.
function cost(u, p) {
  return ((u.input + u.cacheWrite) * p.input + u.cacheRead * p.cacheHit + u.output * p.output) / 1e6;
}

function formatCost(amount, currency) {
  return amount.toFixed(4) + ' ' + currency;
}

// Reads <runDir>/usage.jsonl (written by print-result.js) into entries plus a count of unreadable lines.
function readUsageLog(runDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(runDir, 'usage.jsonl'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { entries: [], skipped: 0 };
    throw e;
  }

  const entries = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      skipped++;
      continue;
    }
    entries.push({
      at: v.at,
      spec: v.spec,
      sessionId: v.sessionId,
      turns: num(v.turns),
      status: v.status,
      error: v.error,
      input: num(v.input),
      cacheRead: num(v.cacheRead),
      cacheWrite: num(v.cacheWrite),
      output: num(v.output),
    });
  }
  return { entries, skipped };
}

const COLUMNS = [
  { key: 'spec', header: 'spec', right: false },
  { key: 'turns', header: 'turns', right: true },
  { key: 'input', header: 'input', right: true },
  { key: 'cacheRead', header: 'cache read', right: true },
  { key: 'cacheWrite', header: 'cache write', right: true },
  { key: 'output', header: 'output', right: true },
  { key: 'status', header: 'status', right: false },
];

function cell(value) {
  return typeof value === 'number' ? value.toLocaleString('en-US') : String(value ?? '');
}

function buildLine(values, widths) {
  const line = COLUMNS.map((col, i) => {
    const text = cell(values[i]);
    return col.right ? text.padStart(widths[i]) : text.padEnd(widths[i]);
  }).join('  ');
  return ('  ' + line).replace(/ +$/, '');
}

// The pricing object from resolve-config.js, or null when it is unset or invalid.
function readPricing() {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, 'resolve-config.js'), '--get', 'deepseekPricing'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const pricing = JSON.parse(out);
    return pricing && typeof pricing === 'object' ? pricing : null;
  } catch {
    return null;
  }
}

function report(runDir) {
  const { entries, skipped } = readUsageLog(runDir);
  if (!entries.length) return `no usage recorded in ${runDir}\n`;

  const totals = { turns: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const rows = entries.map((e) => {
    totals.turns += e.turns;
    totals.input += e.input;
    totals.cacheRead += e.cacheRead;
    totals.cacheWrite += e.cacheWrite;
    totals.output += e.output;
    return [
      e.spec ? String(e.spec) : '?',
      e.turns,
      e.input,
      e.cacheRead,
      e.cacheWrite,
      e.output,
      e.status ? String(e.status) : '?',
    ];
  });
  const totalRow = ['total', totals.turns, totals.input, totals.cacheRead, totals.cacheWrite, totals.output, ''];

  const widths = COLUMNS.map((col, i) =>
    Math.max(col.header.length, ...rows.map((r) => cell(r[i]).length), cell(totalRow[i]).length)
  );

  const lines = [`DeepSeek usage in ${runDir}:`, buildLine(COLUMNS.map((c) => c.header), widths)];
  for (const row of rows) lines.push(buildLine(row, widths));
  lines.push(buildLine(totalRow, widths));
  if (skipped > 0) lines.push(`  (${skipped} unreadable line(s) in usage.jsonl skipped)`);

  const pricing = readPricing();
  if (pricing) lines.push(`  est. cost ${formatCost(cost(totals, pricing), pricing.currency)}`);

  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const runDir = process.argv[2];
  if (!runDir) {
    process.stderr.write('usage: usage.js <run folder>\n');
    process.exit(1);
  }
  process.stdout.write(report(runDir));
}

module.exports = { fromResult, format, cost, formatCost, readUsageLog, readPricing };
