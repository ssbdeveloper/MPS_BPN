#!/usr/bin/env node
/**
 * One command for every T0 check: node scripts/gate.mjs
 *
 *   --fast            skip the production build (what the pre-commit hook uses; CI runs the build)
 *   --track-a         also run the Track A guard (UI work must not touch backend or network code)
 *   --range <rev>     check a commit range instead of the staged diff, e.g. origin/main...HEAD
 *
 * The diff-scoped steps read the **staged** index by default. Running this with nothing staged
 * checks nothing and prints "gate passed", which is true and useless - stage your work first.
 *
 * Steps that only concern the frontend (eslint ratchet, tests, build) are skipped when the diff
 * does not touch apps/web, so a backend or docs commit is not held up by a 24-second test run.
 *
 * Exits non-zero on the first failure and prints which step failed and how to reproduce it.
 */

import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const rangeIdx = argv.indexOf('--range');
const RANGE = rangeIdx !== -1 ? argv[rangeIdx + 1] : null;
const rangeFlag = RANGE ? ` --range ${RANGE}` : '';

function changedFiles() {
  const spec = RANGE ? RANGE : '--cached';
  try {
    return execSync(`git diff ${spec} --name-only --diff-filter=ACMR`, {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    }).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const files = changedFiles();
const webTouched = files.some((f) => f.startsWith('apps/web/'));

if (files.length === 0) {
  console.log('gate: the diff is empty. Stage your work (git add) before running the gate.');
}

const steps = [
  ['context mirror', 'node scripts/mirror.mjs'],
  ['design contract', `node scripts/deslop.mjs --staged${rangeFlag}`],
  ...(argv.includes('--track-a') ? [['track A guard', `node scripts/deslop.mjs --track-a${rangeFlag}`]] : []),
  ...(webTouched ? [
    ['eslint ratchet', `node scripts/lint-gate.mjs${rangeFlag}`],
    ['tests', `${npm} --prefix apps/web run test`],
  ] : []),
  ...(webTouched && !argv.includes('--fast') ? [['build', `${npm} --prefix apps/web run build`]] : []),
];

if (!webTouched && files.length > 0) {
  console.log('gate: no apps/web changes - skipping eslint, tests and build.');
}

for (const [name, cmd] of steps) {
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\ngate failed at: ${name}`);
    console.error(`reproduce with: ${cmd}`);
    process.exit(1);
  }
}

console.log(`\ngate passed (${steps.length} step(s), ${files.length} changed file(s)).`);
