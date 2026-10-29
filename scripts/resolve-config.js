#!/usr/bin/env node
// Resolves the deepseek-coder settings for a project.
// Precedence for model / maxTurns: config file > env var > built-in default.
// Other keys: config file > built-in default.
//
// Usage:
//   node resolve-config.js [--project <dir>]              full resolved config as JSON
//   node resolve-config.js [--project <dir>] --get <key>  one value; arrays print one item per line, objects and null as JSON
// Extra computed keys for --get: allowedTools, smallModel

'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  allowedCommands: [],
  model: 'deepseek-flash[1m]',
  maxTurns: 20,
  extraInstructions: '',
  approvalMode: 'step',
  gitMode: 'commit',
  maxFixRounds: 3,
  markerExpiryMinutes: 30,
  deepseekPricing: null,
};
const APPROVAL_MODES = ['plan', 'step', 'auto'];
const GIT_MODES = ['commit', 'stage', 'none'];
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];

function fail(msg) {
  process.stderr.write(`deepseek-coder config error: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { project: process.cwd(), get: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') args.project = argv[++i];
    else if (argv[i] === '--get') args.get = argv[++i];
    else fail(`unknown argument "${argv[i]}"`);
  }
  return args;
}

function positiveInt(value, name) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(n) || n < 1) fail(`${name} must be a positive integer, got ${JSON.stringify(value)}`);
  return n;
}

function pricing(value) {
  if (value === null) return null;
  const PRICE_KEYS = ['input', 'cacheHit', 'output'];
  const keys = PRICE_KEYS.concat('currency');
  const valid =
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.prototype.hasOwnProperty.call(value, k)) &&
    PRICE_KEYS.every((k) => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0) &&
    typeof value.currency === 'string' &&
    /^[A-Z]{3}$/.test(value.currency);
  if (!valid) {
    fail('deepseekPricing must be null or {"input", "cacheHit", "output", "currency"}: prices are numbers >= 0 per 1M tokens and currency is 3 uppercase letters, e.g. "USD"');
  }
  return value;
}

function resolve(projectDir) {
  const configPath = path.join(projectDir, '.deepseek-coder', 'config.json');
  let file = {};
  const configFound = fs.existsSync(configPath);
  if (configFound) {
    try {
      file = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      fail(`${configPath} is not valid JSON (${e.message})`);
    }
    if (typeof file !== 'object' || file === null || Array.isArray(file)) fail(`${configPath} must contain a JSON object`);
    const unknown = Object.keys(file).filter((k) => !(k in DEFAULTS));
    if (unknown.length) fail(`unknown key(s) in ${configPath}: ${unknown.join(', ')}`);
  }

  const env = process.env;
  const cfg = {
    allowedCommands: file.allowedCommands ?? DEFAULTS.allowedCommands,
    model: file.model ?? env.DEEPSEEK_MODEL ?? DEFAULTS.model,
    maxTurns: positiveInt(file.maxTurns ?? env.DEEPSEEK_MAX_TURNS ?? DEFAULTS.maxTurns, 'maxTurns'),
    extraInstructions: file.extraInstructions ?? DEFAULTS.extraInstructions,
    approvalMode: file.approvalMode ?? DEFAULTS.approvalMode,
    gitMode: file.gitMode ?? DEFAULTS.gitMode,
    maxFixRounds: positiveInt(file.maxFixRounds ?? DEFAULTS.maxFixRounds, 'maxFixRounds'),
    markerExpiryMinutes: positiveInt(file.markerExpiryMinutes ?? DEFAULTS.markerExpiryMinutes, 'markerExpiryMinutes'),
    deepseekPricing: pricing(file.deepseekPricing ?? DEFAULTS.deepseekPricing),
  };

  if (!Array.isArray(cfg.allowedCommands) || cfg.allowedCommands.some((c) => typeof c !== 'string' || !c.trim())) {
    fail('allowedCommands must be an array of non-empty strings');
  }
  if (typeof cfg.model !== 'string' || !cfg.model.trim()) fail('model must be a non-empty string');
  if (typeof cfg.extraInstructions !== 'string') fail('extraInstructions must be a string');
  if (!APPROVAL_MODES.includes(cfg.approvalMode)) fail(`approvalMode must be one of ${APPROVAL_MODES.join(' | ')}`);
  if (!GIT_MODES.includes(cfg.gitMode)) fail(`gitMode must be one of ${GIT_MODES.join(' | ')}`);

  // Prefix match: "npm test" allows "npm test" and "npm test -- --foo"
  cfg.allowedTools = FILE_TOOLS.concat(cfg.allowedCommands.map((c) => `Bash(${c.trim()}:*)`));
  // Background/helper model calls must not carry the [1m] context suffix
  cfg.smallModel = cfg.model.replace(/\[1m\]$/i, '');
  cfg.configFound = configFound;
  cfg.configPath = configPath;
  return cfg;
}

const args = parseArgs(process.argv.slice(2));
const cfg = resolve(path.resolve(args.project));
if (args.get) {
  if (!(args.get in cfg)) fail(`unknown key "${args.get}"`);
  const v = cfg[args.get];
  process.stdout.write(Array.isArray(v) ? v.join('\n') : typeof v === 'object' ? JSON.stringify(v) : String(v));
} else {
  process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
}
