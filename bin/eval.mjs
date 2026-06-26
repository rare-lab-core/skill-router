#!/usr/bin/env node
// Prompt battery for the skill matcher. Runs the REAL scoring module against a
// set of prompts and reports recall + precision, so any change to the scorer is
// measured, not asserted.
//
//   expect : at least one of these skills must appear in the top-N (recall)
//   forbid : none of these may appear in the top-N (precision trap)
//
// Defaults to the shipped example skills + battery so it runs out of the box.
// Point it at your own with --skills and --battery.
//
//   node bin/eval.mjs
//   node bin/eval.mjs --skills ./.claude/skills --battery ./my-battery.json
//   node bin/eval.mjs --verbose

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSkills, extractIntents, extractNegatives, normalizeText, rankSkills } from '../hooks/lib/skill-scoring.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SKILLS = resolve(here, '..', 'examples', 'skills')
const DEFAULT_BATTERY = resolve(here, '..', 'examples', 'battery.json')

const argv = process.argv.slice(2)
let skillsDir = process.env.SKILL_ROUTER_SKILLS || DEFAULT_SKILLS
let batteryFile = DEFAULT_BATTERY
const VERBOSE = argv.includes('--verbose')
const TOP_N = 3
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--skills') skillsDir = resolve(argv[++i] || '')
  else if (argv[i] === '--battery') batteryFile = resolve(argv[++i] || '')
}

let BATTERY
try { BATTERY = JSON.parse(readFileSync(batteryFile, 'utf-8')) }
catch (e) { console.error(`could not read battery ${batteryFile}: ${e.message}`); process.exit(1) }

const skills = scanSkills(resolve(skillsDir))
if (skills.length === 0) { console.error(`no skills with frontmatter found in ${resolve(skillsDir)}`); process.exit(1) }

let recallHits = 0, top1Hits = 0, precisionViolations = 0, expectCases = 0, forbidCases = 0
const failures = []

for (const tc of BATTERY) {
  const ctx = {
    normalizedPrompt: normalizeText(tc.p),
    intents: extractIntents(tc.p),
    negatives: extractNegatives(tc.p),
    recentFiles: [],
    warmSkills: new Set(),
    seenSkills: new Set(),
    intentAffinity: {},
  }
  const ranked = rankSkills(skills, ctx, TOP_N)
  const names = ranked.map(s => s.name)

  const expect = tc.expect || []
  const forbid = tc.forbid || []

  let recallOk = true, precisionOk = true
  if (expect.length) {
    expectCases++
    recallOk = expect.some(e => names.includes(e))
    if (recallOk) recallHits++
    if (names[0] && expect.includes(names[0])) top1Hits++
  }
  if (forbid.length) {
    forbidCases++
    const bad = forbid.filter(f => names.includes(f))
    if (bad.length) { precisionViolations++; precisionOk = false }
  }

  const status = (recallOk && precisionOk) ? 'PASS' : 'FAIL'
  if (status === 'FAIL') failures.push({ p: tc.p, expect, forbid, got: ranked.map(s => `${s.name}:${s.score.toFixed(1)}`) })
  if (VERBOSE) {
    console.log(`[${status}] ${tc.p}`)
    console.log(`   expect=${JSON.stringify(expect)}${forbid.length ? ` forbid=${JSON.stringify(forbid)}` : ''}`)
    console.log(`   top${TOP_N}=${ranked.map(s => `${s.name}:${s.score.toFixed(1)}`).join(', ') || '(none)'}`)
  }
}

console.log('\n══════════ SKILL MATCHER BATTERY ══════════')
console.log(`skills scanned: ${skills.length}  |  cases: ${BATTERY.length}  |  expect: ${expectCases}  |  forbid: ${forbidCases}`)
if (expectCases) {
  console.log(`RECALL@${TOP_N}   : ${recallHits}/${expectCases}  (${(100 * recallHits / expectCases).toFixed(0)}%)  — expected skill in top-${TOP_N}`)
  console.log(`TOP-1 hit   : ${top1Hits}/${expectCases}  (${(100 * top1Hits / expectCases).toFixed(0)}%)  — expected skill ranked #1`)
}
if (forbidCases) {
  console.log(`PRECISION   : ${forbidCases - precisionViolations}/${forbidCases} clean  — ${precisionViolations} forbidden-skill violation(s)`)
}

if (failures.length) {
  console.log(`\n──── ${failures.length} FAILURE(S) ────`)
  for (const f of failures) {
    console.log(`x "${f.p}"`)
    console.log(`    want: ${JSON.stringify(f.expect)}${f.forbid.length ? `  not: ${JSON.stringify(f.forbid)}` : ''}`)
    console.log(`    got : ${f.got.join(', ') || '(none)'}`)
  }
}
console.log('')
process.exit(failures.length ? 1 : 0)
