'use strict';
// Tests for resolve-config.js: the deepseekPricing key and the --get output formats.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'resolve-config.js');

// Writes config.json into a fresh temp project and returns its directory.
// `config` may be an object (stringified here) or raw JSON text.
function makeProject(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-cfg-'));
  fs.mkdirSync(path.join(dir, '.deepseek-coder'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.deepseek-coder', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return dir;
}

function run(dir, args, env) {
  return spawnSync(process.execPath, [SCRIPT, '--project', dir, ...args], { encoding: 'utf8', env: env ?? process.env });
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.DEEPSEEK_MAX_TURNS;
  return env;
}

test('missing deepseekPricing resolves to null', (t) => {
  const dir = makeProject({});
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, ['--get', 'deepseekPricing']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'null');
});

test('explicit deepseekPricing null resolves to null', (t) => {
  const dir = makeProject({ deepseekPricing: null });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, ['--get', 'deepseekPricing']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'null');
});

test('valid deepseekPricing resolves unchanged and prints as JSON', (t) => {
  const price = { input: 0.27, cacheHit: 0.07, output: 1.1, currency: 'USD' };
  const dir = makeProject({ deepseekPricing: price });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const one = run(dir, ['--get', 'deepseekPricing']);
  assert.equal(one.status, 0);
  assert.deepEqual(JSON.parse(one.stdout), price);

  const full = run(dir, []);
  assert.equal(full.status, 0);
  assert.deepEqual(JSON.parse(full.stdout).deepseekPricing, price);
});

test('zero prices are valid', (t) => {
  const price = { input: 0, cacheHit: 0, output: 0, currency: 'CNY' };
  const dir = makeProject({ deepseekPricing: price });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, ['--get', 'deepseekPricing']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), price);
});

test('invalid deepseekPricing is rejected', (t) => {
  const base = { input: 0.27, cacheHit: 0.07, output: 1.1, currency: 'USD' };
  const cases = [
    ['missing currency', { deepseekPricing: { input: 0.27, cacheHit: 0.07, output: 1.1 } }],
    ['lowercase currency', { deepseekPricing: { ...base, currency: 'usd' } }],
    ['two-letter currency', { deepseekPricing: { ...base, currency: 'US' } }],
    ['four-letter currency', { deepseekPricing: { ...base, currency: 'USDT' } }],
    ['extra key', { deepseekPricing: { ...base, cacheWrite: 1 } }],
    ['negative price', { deepseekPricing: { ...base, input: -1 } }],
    ['string price', { deepseekPricing: { ...base, input: '0.27' } }],
    ['infinite price', '{"deepseekPricing":{"input":0.27,"cacheHit":0.07,"output":1e999,"currency":"USD"}}'],
    ['array', { deepseekPricing: [0.27, 0.07, 1.1, 'USD'] }],
    ['number', { deepseekPricing: 5 }],
  ];
  for (const [name, config] of cases) {
    const dir = makeProject(config);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const r = run(dir, ['--get', 'deepseekPricing']);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, /deepseekPricing must be null or/, name);
  }
});

test('existing keys keep their --get output', (t) => {
  const dir = makeProject({ allowedCommands: ['npm test', 'npm run lint'] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = cleanEnv();

  const cmds = run(dir, ['--get', 'allowedCommands'], env);
  assert.equal(cmds.status, 0);
  assert.equal(cmds.stdout, 'npm test\nnpm run lint');

  const turns = run(dir, ['--get', 'maxTurns'], env);
  assert.equal(turns.status, 0);
  assert.equal(turns.stdout, '20');

  const mode = run(dir, ['--get', 'approvalMode'], env);
  assert.equal(mode.status, 0);
  assert.equal(mode.stdout, 'step');
});
