#!/usr/bin/env node
/**
 * MPS design-contract gate. Rules C1-C16 are documented in docs/standards/design-system.md
 * and docs/standards/anti-slop.md. No dependencies; run from the repo root.
 *
 *   node scripts/deslop.mjs --staged             staged diff (used by the pre-commit hook)
 *   node scripts/deslop.mjs --range <rev>        a commit range, e.g. origin/main...HEAD (CI)
 *   node scripts/deslop.mjs --all                whole-codebase debt report, never blocks
 *   node scripts/deslop.mjs --track-a            fail if a UI change touches backend or network code
 *   node scripts/deslop.mjs --files a.jsx b.jsx  full-file audit of named files, blocking
 *
 * SCOPE — read this before assuming a clean file.
 * In --staged and --range mode the checks apply to **lines the diff added or changed**, not to
 * the whole file. The repo carries ~1.7k pre-existing findings across ~65% of the files under
 * apps/web/src; a whole-file gate would block any edit to two thirds of the codebase and would
 * be uninstalled within a week. This gate is a ratchet: new lines must be clean, old lines are
 * debt that `--all` reports and that gets paid down deliberately, not opportunistically.
 * A file added by the diff is checked in full — it has no legacy.
 *
 * File-level rules (C13 file length, C14 duplicated className) cannot be attributed to a single
 * added line. On an existing file they are warnings; on a new file they are errors.
 *
 * Suppressing one line: write "deslop-allow C4: reason" on that line or the line above.
 * The reason is required; a bare marker is ignored.
 */

import { execSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, sep } from 'node:path';

const SCAN_ROOT = join('apps', 'web', 'src');
const SCAN_ROOT_GIT = 'apps/web/src';
const EXT = new Set(['.js', '.jsx', '.css', '.html']);

const TOKEN_HEX = new Set([
  '03045e', '023e8a', '0077b6', '0096c7', '00b4d8', '48cae4', '90e0ef', 'ade8f4', 'caf0f8',
  'eef2f6', 'b45309', '047857',
  '7c3aed', '0d9488', 'be185d', '4d7c0f', '94a3b8',
  'e2e8f0', 'fffbeb', 'f0fdf4', 'eef2ff',
  'fff', 'ffffff', '000', '000000',
]);

const URL_ALLOW = [/localhost/, /127\.0\.0\.1/, /www\.w3\.org/, /schema\.org/, /json-schema\.org/];
const PICTOGRAPH_ALLOW = new Set(['©', '®', '™']);

const BANNED_COPY = [
  'elevate your', 'seamless', 'unleash', 'empower', 'revolutionary', 'game-?changer',
  'supercharge', 'dive in', 'unlock the power', 'effortless', 'cutting-?edge', 'next-?level',
];

const GRADIENT_ALLOW = [/GroupHeader/i, /EmployeeHeader/i, /Badge/i];
const BLUR_ALLOW = [/Modal/i, /Overlay/i, /Dialog/i, /Sheet/i];

const NETWORK_PATTERN = /fetch\s*\(|axios|new WebSocket|new EventSource|setInterval\s*\(|['"`]\/api\//;
const TRACK_A_DIRS = ['apps/web/', 'docs/'];

const argv = process.argv.slice(2);
const rangeIdx = argv.indexOf('--range');
const RANGE = rangeIdx !== -1 ? argv[rangeIdx + 1] : null;
const DIFF_ARGS = RANGE ? RANGE : '--cached';

const findings = [];
const add = (sev, rule, file, line, msg) => findings.push({ sev, rule, file, line, msg });
const git = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const toGit = (p) => p.split(sep).join('/');

/** Line numbers added or changed by the diff, per file. */
function changedLines(file) {
  const out = new Set();
  let diff = '';
  try {
    diff = git(`git diff ${DIFF_ARGS} -U0 -- "${file}"`);
  } catch {
    return out;
  }
  for (const line of diff.split('\n')) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) out.add(start + i);
  }
  return out;
}

function diffFiles(filter) {
  return git(`git diff ${DIFF_ARGS} --name-only --diff-filter=${filter}`)
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (EXT.has(extname(entry.name))) out.push(toGit(p));
  }
  return out;
}

/** @returns {{file: string, scope: Set<number>|null, isNew: boolean}[]} */
function targets() {
  if (argv.includes('--all')) {
    return walk(SCAN_ROOT).map((file) => ({ file, scope: null, isNew: false }));
  }
  const i = argv.indexOf('--files');
  if (i !== -1) {
    return argv.slice(i + 1)
      .filter((f) => !f.startsWith('--') && EXT.has(extname(f)))
      .map((f) => ({ file: toGit(f), scope: null, isNew: false }));
  }
  const added = new Set(diffFiles('A'));
  return diffFiles('ACM')
    .filter((f) => f.startsWith(SCAN_ROOT_GIT) && EXT.has(extname(f)))
    .map((file) => ({
      file,
      scope: added.has(file) ? null : changedLines(file),
      isNew: added.has(file),
    }));
}

function suppressed(lines, idx, rule) {
  const re = new RegExp(`deslop-allow\\s+${rule}\\s*:\\s*\\S+`);
  return re.test(lines[idx]) || (idx > 0 && re.test(lines[idx - 1]));
}

function hasEmoji(line) {
  for (const ch of line) {
    if (PICTOGRAPH_ALLOW.has(ch)) continue;
    if (/\p{Extended_Pictographic}/u.test(ch)) return true;
  }
  return false;
}

function checkLine(file, lines, idx, inScope) {
  const line = lines[idx];
  const trimmed = line.trim();
  const isComment = ['//', '*', '/*', '{/*'].some((p) => trimmed.startsWith(p));
  const at = (rule, sev, msg) => {
    if (!inScope(idx + 1)) return;
    if (!suppressed(lines, idx, rule)) add(sev, rule, file, idx + 1, msg);
  };

  for (const m of line.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const hex = m[1].toLowerCase();
    if (!TOKEN_HEX.has(hex)) at('C1', 'error', `hex outside the token set: #${hex}`);
  }
  if (/(bg|text)-\[#0096c7\]/i.test(line)) at('C2', 'error', '#0096c7 is 3.4:1 and fails AA as a button background or small text - use #0077b6');
  if (/\bdark:/.test(line)) at('C3', 'error', 'light theme only');
  if (/bg-gradient-|linear-gradient\(/.test(line) && !GRADIENT_ALLOW.some((r) => r.test(file))) {
    at('C4', 'error', 'gradients are allowed only on group headers and small badges');
  }
  if (/backdrop-blur/.test(line) && !BLUR_ALLOW.some((r) => r.test(file))) {
    at('C5', 'error', 'backdrop-blur is allowed only on a modal overlay');
  }
  if (/\bz-\[/.test(line)) at('C6', 'error', 'use the z-index scale (z-30 / z-40 / z-50)');
  if (/text-\[(?:[0-9]|10)px\]/.test(line)) at('C7', 'error', 'minimum text size is 12px; text-[11px] is badges and eyebrows only');
  if (/<(div|span|li|td|tr)\b[^>]*\sonClick=/.test(line) && !/role=["']button["']/.test(line)) {
    at('C9', 'error', 'clickable elements must be <button> (or role="button" plus keyboard handlers)');
  }
  if (!isComment) {
    for (const m of line.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      if (!URL_ALLOW.some((r) => r.test(m[0]))) at('C11', 'error', `external asset or URL breaks offline-first: ${m[0]}`);
    }
  }
  if (hasEmoji(line)) at('C12', 'error', 'no emoji in the UI - use a lucide-react icon');
  if (/\bconsole\.(log|debug)\s*\(/.test(line)) at('C15', 'error', 'stray console.log');
  if (/^\s*\/\/\s*(const|let|var|function|return|if|import|<|\{)/.test(line)) at('C15', 'error', 'commented-out code - delete it, git keeps the history');
  if (/TODO/.test(line) && !/TODO\s*\((?:#|docs\/)/.test(line)) at('C15', 'error', 'TODO must reference an issue or doc: TODO(docs/planning/x.md)');
  for (const w of BANNED_COPY) {
    if (new RegExp(w, 'i').test(line)) at('C16', 'error', `marketing tone is banned: "${w}"`);
  }
  if (/<t[dh]\b[^>]*text-right/.test(line) && !/tabular-nums/.test(line)) {
    at('C10', 'warn', 'numeric column should use tabular-nums');
  }
}

function checkFile({ file, scope, isNew }, text) {
  const lines = text.split(/\r?\n/);
  const inScope = (n) => scope === null || scope.has(n);
  lines.forEach((_, i) => checkLine(file, lines, i, inScope));

  // File-level rules: an added line cannot be blamed for the length of a file it did not write.
  const fileLevelSev = isNew || scope === null ? 'error' : 'warn';
  const touched = scope === null || scope.size > 0;

  if (extname(file) !== '.css' && touched) {
    const limit = file.includes('src/components') ? 200 : 400;
    if (lines.length > limit) {
      const suffix = fileLevelSev === 'warn' ? ' (pre-existing - see docs/planning/UI-DEBT.md)' : '';
      add(fileLevelSev, 'C13', file, lines.length, `${lines.length} lines exceeds the ${limit}-line limit - extract components${suffix}`);
    }
  }

  for (const m of text.matchAll(/<button\b[^>]*className=["']([^"']{10,})["'][^>]*>/g)) {
    const cls = m[1];
    const line = text.slice(0, m.index).split('\n').length;
    if (!inScope(line)) continue;
    if (!/min-h-\[44px\]|min-h-11|min-h-12/.test(cls)) add('error', 'C8', file, line, 'button needs min-h-[44px]');
    if (!/focus-visible:/.test(cls)) add('error', 'C8', file, line, 'button needs focus-visible:ring-2');
  }

  const seen = new Map();
  for (const m of text.matchAll(/className=["']([^"']{40,})["']/g)) {
    const key = m[1].replace(/\s+/g, ' ').trim();
    const line = text.slice(0, m.index).split('\n').length;
    const entry = seen.get(key) || { count: 0, lines: [] };
    entry.count += 1;
    entry.lines.push(line);
    seen.set(key, entry);
  }
  for (const [cls, { count, lines: at }] of seen) {
    if (count < 2) continue;
    const hit = at.find(inScope);
    if (hit === undefined) continue;
    const sev = fileLevelSev === 'warn' ? 'warn' : (count >= 3 ? 'error' : 'warn');
    add(sev, 'C14', file, hit, `identical className used ${count}x - extract a component: "${cls.slice(0, 60)}..."`);
  }
}

function trackAGuard() {
  for (const f of diffFiles('ACMRD')) {
    if (!TRACK_A_DIRS.some((d) => f.startsWith(d))) {
      add('error', 'TRACK-A', f, 0, `Track A may only touch ${TRACK_A_DIRS.join(' and ')} - this belongs to Track B`);
    }
  }

  const diff = git(`git diff ${DIFF_ARGS} -U0 -- apps/web`).split('\n');
  let current = '';
  for (const line of diff) {
    if (line.startsWith('+++ b/')) current = line.slice(6);
    if (!/^[+-][^+-]/.test(line)) continue;
    if (NETWORK_PATTERN.test(line)) {
      add('error', 'TRACK-A', current, 0, `network behaviour changed: ${line.trim().slice(0, 90)}`);
    }
  }
}

const reportOnly = argv.includes('--all');

if (argv.includes('--track-a')) {
  trackAGuard();
} else {
  const files = targets();
  for (const t of files) {
    try {
      if (!statSync(t.file).isFile()) continue;
      checkFile(t, readFileSync(t.file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      console.error(`deslop: cannot read ${t.file}: ${err.message}`);
      process.exit(2);
    }
  }
  const scoped = reportOnly || argv.includes('--files') ? 'whole file' : 'changed lines only';
  console.log(`deslop: ${files.length} file(s) checked (${scoped}).`);
}

for (const f of findings) {
  console.log(`${f.sev === 'error' ? 'ERROR' : 'WARN '} ${f.rule} ${f.file}:${f.line} ${f.msg}`);
}

const errors = findings.filter((f) => f.sev === 'error');
const warns = findings.filter((f) => f.sev === 'warn');
console.log(`\ndeslop: ${errors.length} error(s), ${warns.length} warning(s).`);

if (reportOnly) {
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  console.log('By rule:', byRule);
  process.exit(0);
}

if (errors.length) {
  console.log('Rules: docs/standards/design-system.md and docs/standards/anti-slop.md.');
  console.log('Fix them, or write "deslop-allow C<n>: reason" on the line if the exception is real.');
  process.exit(1);
}
