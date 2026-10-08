#!/usr/bin/env node
// Cross-post scan: the patterns a reader sees only by reading posts in a row.
// Usage: node series-scan.mjs [posts-dir] [--post NN]
// With --post, only findings that involve post NN are printed. Exit 1 if any.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const only = args.includes('--post') ? args[args.indexOf('--post') + 1] : null;
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--post') ?? 'docs/linkedin/posts';

const MORAL_SHARE = 0.5;
const QUESTION_SHARE = 0.7;
const BULLET_SHARE = 0.6;
const PILLAR_CAP = { 1: 0.4 };
const NGRAM = 5;

const posts = readdirSync(dir)
  .filter((f) => /^\d+-.*\.md$/.test(f))
  .sort()
  .map((file) => {
    const raw = readFileSync(join(dir, file), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    const field = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim();
    const text = raw.replace(/^---\n[\s\S]*?\n---\n/, '').split(/^## /m)[0];
    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const body = paras.filter((p) => !/^#\w/.test(p));
    const last = body.at(-1) ?? '';
    const question = last.endsWith('?');
    const beforeClose = question ? body.at(-2) ?? '' : last;
    const moral =
      !beforeClose.includes('\n') &&
      beforeClose.split(/\s+/).length <= 20 &&
      !/\d/.test(beforeClose) &&
      !/\b(I|my|me|I'm|I've)\b/.test(beforeClose);
    const words = body
      .join(' ')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const grams = new Set();
    for (let i = 0; i + NGRAM <= words.length; i++) grams.add(words.slice(i, i + NGRAM).join(' '));
    return {
      n: file.slice(0, 2),
      pillar: field('pillar') ?? '?',
      status: field('status') ?? '?',
      question,
      bullets: /^[•*-] /m.test(text),
      moral,
      moralLine: moral ? beforeClose : '',
      grams,
      tags: (text.match(/(^|\s)#\w+/g) ?? []).map((t) => t.trim()).sort().join(' '),
    };
  });

const findings = [];
const add = (involves, rule, detail) => {
  if (!only || involves.includes(only)) findings.push(`${rule}\t${detail}`);
};
const share = (pred) => posts.filter(pred).length / (posts.length || 1);
const list = (pred) => posts.filter(pred).map((p) => p.n);

if (share((p) => p.moral) > MORAL_SHARE)
  add(list((p) => p.moral), 'moral-closer', `${list((p) => p.moral).length}/${posts.length} posts end on a lesson line: ${list((p) => p.moral).join(', ')}`);
if (share((p) => p.question) > QUESTION_SHARE)
  add(list((p) => p.question), 'question-closer', `${list((p) => p.question).length}/${posts.length} posts close on a question; vary the close`);
if (share((p) => p.bullets) > BULLET_SHARE)
  add(list((p) => p.bullets), 'bullets', `${list((p) => p.bullets).length}/${posts.length} posts carry a bullet list`);

for (const [pillar, cap] of Object.entries(PILLAR_CAP)) {
  const ns = list((p) => p.pillar === pillar);
  if (ns.length / posts.length > cap)
    add(ns, 'pillar-cap', `pillar ${pillar} is ${ns.length}/${posts.length} posts, cap ${cap * 100}%`);
}
posts.forEach((p, i) => {
  const prev = posts[i - 1];
  if (!prev) return;
  if (prev.pillar === p.pillar) add([prev.n, p.n], 'pillar-repeat', `${prev.n} and ${p.n} are both pillar ${p.pillar}`);
  if (prev.tags && prev.tags === p.tags) add([prev.n, p.n], 'hashtags-repeat', `${prev.n} and ${p.n}: ${p.tags}`);
});

for (let i = 0; i < posts.length; i++)
  for (let j = i + 1; j < posts.length; j++) {
    const shared = [...posts[i].grams].filter((g) => posts[j].grams.has(g));
    if (shared.length)
      add([posts[i].n, posts[j].n], 'shared-phrase', `${posts[i].n}~${posts[j].n}: "${shared.slice(0, 3).join('" | "')}"`);
  }

console.log('#  pillar status     close     bullets moral');
for (const p of posts)
  console.log(`${p.n} ${p.pillar.padEnd(6)} ${p.status.padEnd(10)} ${(p.question ? 'question' : 'statement').padEnd(9)} ${String(p.bullets).padEnd(7)} ${p.moralLine.slice(0, 60)}`);
for (const f of findings) console.log(f);
console.log(findings.length ? `${findings.length} finding(s)` : 'clean');
process.exit(findings.length ? 1 : 0);
