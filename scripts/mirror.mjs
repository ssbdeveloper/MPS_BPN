#!/usr/bin/env node
/**
 * Keeps the duplicated gates in AGENTS.md byte-identical to CLAUDE.md. Run from the repo root.
 *
 *   node scripts/mirror.mjs        verify (used by gate.mjs and the pre-commit hook)
 *   node scripts/mirror.mjs --fix  overwrite the AGENTS.md blocks from CLAUDE.md
 *
 * WHY THIS EXISTS
 * AGENTS.md used to be a full copy of CLAUDE.md and drifted for months - it described a React
 * version and a page component that did not exist. The replacement policy was "duplicate only
 * the four gates, and mirror them by hand". That policy is a rule enforced by hope, and by the
 * time it was audited AGENTS.md had already lost two of the seven STOP-list items.
 *
 * CLAUDE.md is the source. A block is:
 *
 *     <!-- MIRROR:stop-list -->
 *     ...content...
 *     <!-- /MIRROR:stop-list -->
 *
 * Every block in CLAUDE.md must appear in AGENTS.md with identical content, and AGENTS.md may
 * not invent blocks of its own. Comparison ignores trailing whitespace and surrounding blank
 * lines; nothing else.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'CLAUDE.md';
const COPY = 'AGENTS.md';
const FIX = process.argv.includes('--fix');

const open = (id) => `<!-- MIRROR:${id} -->`;
const close = (id) => `<!-- /MIRROR:${id} -->`;

function blocks(text, file) {
  const found = new Map();
  const re = /<!-- MIRROR:([a-z0-9-]+) -->\r?\n([\s\S]*?)<!-- \/MIRROR:\1 -->/g;
  for (const m of text.matchAll(re)) {
    if (found.has(m[1])) {
      console.error(`ERROR mirror ${file}: block "${m[1]}" is defined twice.`);
      process.exit(1);
    }
    found.set(m[1], m[2]);
  }
  const opens = (text.match(/<!-- MIRROR:[a-z0-9-]+ -->/g) || []).length;
  if (opens !== found.size) {
    console.error(`ERROR mirror ${file}: ${opens} opening marker(s) but ${found.size} well-formed block(s) - check for a missing or misspelled closing marker.`);
    process.exit(1);
  }
  return found;
}

const normalise = (s) => s
  .split(/\r?\n/)
  .map((l) => l.replace(/\s+$/, ''))
  .join('\n')
  .replace(/^\n+/, '')
  .replace(/\n+$/, '');

const sourceText = readFileSync(SOURCE, 'utf8');
let copyText = readFileSync(COPY, 'utf8');
const src = blocks(sourceText, SOURCE);
const cpy = blocks(copyText, COPY);

if (src.size === 0) {
  console.error(`ERROR mirror ${SOURCE}: no MIRROR blocks found - the gates that AGENTS.md duplicates must be marked.`);
  process.exit(1);
}

const problems = [];

for (const id of cpy.keys()) {
  if (!src.has(id)) problems.push(`${COPY} has block "${id}" that ${SOURCE} does not define - ${SOURCE} is the source.`);
}

for (const [id, body] of src) {
  if (!cpy.has(id)) {
    if (FIX) continue;
    problems.push(`${COPY} is missing block "${id}".`);
    continue;
  }
  const a = normalise(body);
  const b = normalise(cpy.get(id));
  if (a === b) continue;

  if (FIX) {
    const re = new RegExp(`${open(id)}\\r?\\n[\\s\\S]*?${close(id)}`);
    copyText = copyText.replace(re, `${open(id)}\n${a}\n${close(id)}`);
    continue;
  }

  const al = a.split('\n');
  const bl = b.split('\n');
  const i = al.findIndex((l, n) => l !== bl[n]);
  problems.push([
    `block "${id}" differs at line ${i + 1}:`,
    `  ${SOURCE}: ${al[i] ?? '(end of block)'}`,
    `  ${COPY}:   ${bl[i] ?? '(end of block)'}`,
  ].join('\n'));
}

if (FIX) {
  writeFileSync(COPY, copyText);
  console.log(`mirror: ${COPY} rewritten from ${SOURCE} (${src.size} block(s)).`);
  process.exit(0);
}

if (problems.length) {
  for (const p of problems) console.error(`ERROR mirror ${p}`);
  console.error(`\nmirror: ${problems.length} problem(s). Edit ${SOURCE}, then run: node scripts/mirror.mjs --fix`);
  process.exit(1);
}

console.log(`mirror: ${src.size} block(s) identical in ${SOURCE} and ${COPY}.`);
