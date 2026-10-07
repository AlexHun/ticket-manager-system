#!/usr/bin/env node
// Word-level AI-slop and LinkedIn-format scan. Usage: node slop-scan.mjs <file>
// (or pipe text on stdin). Prints findings with line numbers; exit 1 if any.
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.argv[2] ?? 0, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
// Skip a leading frontmatter block and any trailing `## ` section (prepared
// replies, notes) so post files scan only the post text.
const text = raw.replace(/^---\n[\s\S]*?\n---\n/, '').split(/^## /m)[0];
const lines = text.split('\n');

const PHRASES = [
  // announcement / hype register
  'thrilled to', 'excited to share', 'excited to announce', 'humbled',
  'game-changer', 'game changer', 'game-changing', 'cutting-edge',
  'revolutionary', 'revolutionize', 'next-level', 'supercharge',
  // classic model vocabulary
  'delve', 'tapestry', 'testament to', 'realm', 'embark', 'navigate the',
  'ever-evolving', 'fast-paced', 'landscape', 'paradigm', 'synergy',
  'leverage', 'leveraging', 'unlock', 'unleash', 'elevate', 'empower',
  'seamless', 'seamlessly', 'robust', 'streamline', 'harness the',
  'in today\'s', 'at the end of the day', 'it\'s worth noting',
  'furthermore', 'moreover', 'additionally',
  // LinkedIn hook / closer cliches
  'here\'s the thing', 'let that sink in', 'read that again',
  'here\'s what i learned', 'here\'s why', 'the result?', 'the best part?',
  'plot twist', 'unpopular opinion', 'agree?', 'thoughts?',
  'what do you think?', 'i\'d love to hear',
  'here\'s how', 'the catch:', 'turns out', 'journey', 'honestly',
  'the kicker', 'was a revelation', 'completely transformed',
];
const CONTRAST = /\b(it'?s|this is|that'?s)\s+not\s+(just\s+)?(about\s+)?[^.!?\n]{1,60}[.,;—–-]\s*(it'?s|this is|that'?s)\b|\bnot just\b[^.!?\n]{1,60}\bbut\b/i;
const TRIAD = /\b\w+(?:\s\w+){0,2},\s\w+(?:\s\w+){0,2},\s(?:and|or)\s\w+(?:\s\w+){0,2}/gi;
const EMOJI = /\p{Extended_Pictographic}/u;

const findings = [];
const add = (line, rule, detail) => findings.push({ line, rule, detail });

lines.forEach((l, i) => {
  const n = i + 1;
  const low = l.toLowerCase();
  for (const p of PHRASES) {
    const re = new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (re.test(low)) add(n, 'phrase', `"${p}"`);
  }
  const contrast = l.match(CONTRAST);
  if (contrast) add(n, 'reflexive-contrast', contrast[0]);
  const triads = l.match(TRIAD);
  if (triads) add(n, 'rule-of-three', triads.join(' | '));
  if (EMOJI.test(l.trim().slice(0, 2))) add(n, 'emoji-bullet', l.trim().slice(0, 40));
});

// Whole-post metrics.
const words = text.split(/\s+/).filter(Boolean).length;
const chars = text.trim().length;
const dashes = (text.match(/—|–| - /g) ?? []).length;
const emojis = [...text].filter((c) => EMOJI.test(c)).length;
const hashtags = (text.match(/(^|\s)#\w+/g) ?? []).length;
const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const oneLiners = paras.filter((p) => !p.includes('\n') && (p.match(/[.!?](\s|$)/g) ?? []).length <= 1).length;
const hook = paras[0] ?? '';

if (chars > 3000) add('-', 'length', `${chars} chars; LinkedIn cap is 3000`);
if (words > 300) add('-', 'length', `${words} words; working range is 120-250`);
if (hook.length > 210) add(1, 'hook', `first paragraph is ${hook.length} chars; ~210 show before "see more"`);
if (words && dashes / words > 1 / 100) add('-', 'dash-density', `${dashes} dashes in ${words} words`);
if (emojis > 2) add('-', 'emoji', `${emojis} emoji`);
if (hashtags > 3) add('-', 'hashtags', `${hashtags} hashtags; keep 0-3`);
if (paras.length >= 5 && oneLiners / paras.length > 0.6)
  add('-', 'broetry', `${oneLiners} of ${paras.length} paragraphs are single sentences`);

// Uniform rhythm: real writing mixes short and long sentences.
const sentences = paras
  .filter((p) => !p.startsWith('#') && !p.startsWith('•'))
  .flatMap((p) => p.split(/(?<=[.!?])\s+/))
  .map((s) => s.split(/\s+/).filter(Boolean).length)
  .filter((n) => n > 0);
const mean = sentences.reduce((a, b) => a + b, 0) / (sentences.length || 1);
const sd = Math.sqrt(sentences.reduce((a, n) => a + (n - mean) ** 2, 0) / (sentences.length || 1));
if (sentences.length >= 6 && sd < 4) add('-', 'uniform-rhythm', `sentence length sd ${sd.toFixed(1)} words; vary it`);

// Moral-line closer: a short, general one-sentence paragraph right before the
// question or hashtags, with no number and no "I". Advisory: check by eye.
const body = paras.filter((p) => !/^#\w/.test(p));
const last = body.at(-1) ?? '';
const beforeClose = last.trim().endsWith('?') ? body.at(-2) ?? '' : last;
if (
  !beforeClose.includes('\n') &&
  (beforeClose.match(/[.!](\s|$)/g) ?? []).length <= 2 &&
  beforeClose.split(/\s+/).length <= 20 &&
  !/\d/.test(beforeClose) &&
  !/\b(I|my|me|I'm|I've)\b/.test(beforeClose)
)
  add('-', 'moral-closer', `"${beforeClose.slice(0, 80)}" reads as a lesson line; one per few posts, not every post`);

console.log(`words=${words} chars=${chars} paragraphs=${paras.length} dashes=${dashes} emoji=${emojis} hashtags=${hashtags} sentence-sd=${sd.toFixed(1)}`);
for (const f of findings) console.log(`L${f.line}\t${f.rule}\t${f.detail}`);
console.log(findings.length ? `${findings.length} finding(s)` : 'clean');
process.exit(findings.length ? 1 : 0);
