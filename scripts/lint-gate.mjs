#!/usr/bin/env node
/**
 * ESLint ratchet for apps/web. Run from the repo root.
 *
 *   node scripts/lint-gate.mjs                    staged diff
 *   node scripts/lint-gate.mjs --range <rev>      a commit range, e.g. origin/main...HEAD (CI)
 *   node scripts/lint-gate.mjs --all              report the whole app, never blocks
 *   node scripts/lint-gate.mjs --update-baseline  re-record the debt after paying some of it down
 *
 * WHY A RATCHET AND NOT `eslint .`
 * `eslint .` currently reports ~105 errors in code that predates this gate. A gate that fails on
 * day one is a gate that gets bypassed, so this compares the changed files against
 * scripts/lint-baseline.json and fails only when a file gains errors it did not have before.
 * The count per (file, rule) is the unit, so the check survives line shifts.
 *
 * Paying debt down: fix the errors, run --update-baseline, commit the smaller baseline. The
 * baseline may shrink in any commit. It may only grow through an explicit, explained
 * --update-baseline in a commit whose message says why.
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, sep, resolve } from 'node:path';

const WEB = join('apps', 'web');
const WEB_GIT = 'apps/web';
// Absolute: eslint runs with cwd=apps/web so it picks up that workspace's flat config.
const ESLINT = resolve(WEB, 'node_modules', 'eslint', 'bin', 'eslint.js');
const BASELINE = join('scripts', 'lint-baseline.json');
const LINTABLE = /\.(js|jsx)$/;

const argv = process.argv.slice(2);
const rangeIdx = argv.indexOf('--range');
const RANGE = rangeIdx !== -1 ? argv[rangeIdx + 1] : null;
const DIFF_ARGS = RANGE ? RANGE : '--cached';
const UPDATE = argv.includes('--update-baseline');
const ALL = argv.includes('--all') || UPDATE;

const git = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const toGit = (p) => p.split(sep).join('/');

function changedFiles() {
  return git(`git diff ${DIFF_ARGS} --name-only --diff-filter=ACM`)
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((f) => f.startsWith(`${WEB_GIT}/`) && LINTABLE.test(f))
    .filter((f) => !f.startsWith(`${WEB_GIT}/node_modules/`));
}

/** @returns {Record<string, Record<string, number>>} keyed by path relative to apps/web */
function runEslint(targets) {
  const args = [ESLINT, '--format', 'json', ...targets];
  const res = spawnSync(process.execPath, args, {
    cwd: WEB,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!res.stdout || !res.stdout.trim().startsWith('[')) {
    console.error('lint-gate: eslint produced no JSON report.');
    console.error(res.stderr || res.stdout || '(no output)');
    process.exit(2);
  }
  const counts = {};
  for (const file of JSON.parse(res.stdout)) {
    const rel = toGit(file.filePath).split(`${WEB_GIT}/`).pop();
    for (const m of file.messages) {
      if (m.severity !== 2) continue;
      const rule = m.ruleId || 'parse-error';
      counts[rel] = counts[rel] || {};
      counts[rel][rule] = (counts[rel][rule] || 0) + 1;
    }
  }
  return counts;
}

const total = (counts) => Object.values(counts)
  .reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);

if (ALL) {
  const counts = runEslint(['.']);
  if (UPDATE) {
    const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [
      k, Object.fromEntries(Object.keys(counts[k]).sort().map((r) => [r, counts[k][r]])),
    ]));
    writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`lint-gate: baseline written - ${Object.keys(sorted).length} file(s), ${total(counts)} error(s).`);
  } else {
    console.log(`lint-gate: ${Object.keys(counts).length} file(s) with ${total(counts)} error(s).`);
  }
  process.exit(0);
}

const files = changedFiles();
if (files.length === 0) {
  console.log('lint-gate: no changed apps/web JS files.');
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const counts = runEslint(files.map((f) => f.slice(`${WEB_GIT}/`.length)));

const regressions = [];
for (const [file, rules] of Object.entries(counts)) {
  for (const [rule, count] of Object.entries(rules)) {
    const allowed = baseline[file]?.[rule] ?? 0;
    if (count > allowed) regressions.push({ file, rule, count, allowed });
  }
}

console.log(`lint-gate: ${files.length} changed file(s), ${total(counts)} error(s), baseline allows ${
  files.reduce((sum, f) => {
    const rules = baseline[f.slice(`${WEB_GIT}/`.length)] || {};
    return sum + Object.values(rules).reduce((a, b) => a + b, 0);
  }, 0)}.`);

if (regressions.length === 0) {
  console.log('lint-gate: no new errors.');
  process.exit(0);
}

for (const r of regressions) {
  console.log(`ERROR ${r.rule} ${WEB_GIT}/${r.file} - ${r.count} error(s), baseline allows ${r.allowed}`);
}
console.log(`\nlint-gate: ${regressions.length} rule/file pair(s) got worse.`);
console.log(`Reproduce: node ${ESLINT} --fix <file>   (run from ${WEB})`);
console.log('If the increase is deliberate and justified, run --update-baseline and say why in the commit message.');
process.exit(1);
