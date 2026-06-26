#!/usr/bin/env node
// Single-prompt probe for the skill matcher. Prints, as one JSON line, what the
// live hook would inject for a given prompt (top-3 passing skills) plus the next
// few near-misses for context. Lets anyone check routing for an arbitrary prompt
// without the stdin hook.
//
//   node bin/probe.mjs "the canvas goes black after a blur node"
//   node bin/probe.mjs --skills ./.claude/skills "reduce the bundle size"
//   → {"prompt":"...","injected":[{"name":"...","score":14}],"runnerUp":[...]}

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSkills, extractIntents, extractNegatives, normalizeText, rankSkills } from '../hooks/lib/skill-scoring.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SKILLS = resolve(here, '..', 'examples', 'skills')

const argv = process.argv.slice(2)
let skillsDir = process.env.SKILL_ROUTER_SKILLS || DEFAULT_SKILLS
const rest = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--skills') { skillsDir = resolve(argv[++i] || ''); continue }
  rest.push(argv[i])
}
const prompt = rest.join(' ').trim()
if (!prompt) {
  console.error('usage: node bin/probe.mjs [--skills <dir>] "<prompt text>"')
  process.exit(1)
}

const skills = scanSkills(resolve(skillsDir))
const ctx = {
  normalizedPrompt: normalizeText(prompt),
  intents: extractIntents(prompt),
  negatives: extractNegatives(prompt),
  recentFiles: [],
  warmSkills: new Set(),
  seenSkills: new Set(),
  intentAffinity: {},
}

const ranked = rankSkills(skills, ctx, 6)
console.log(JSON.stringify({
  prompt,
  skillsDir: resolve(skillsDir),
  scanned: skills.length,
  intent: [...ctx.intents].join(',') || 'generic',
  injected: ranked.slice(0, 3).map(s => ({ name: s.name, score: Number(s.score.toFixed(1)) })),
  runnerUp: ranked.slice(3).map(s => ({ name: s.name, score: Number(s.score.toFixed(1)) })),
}))
