#!/usr/bin/env node
// skill-router — prompt intelligence engine (UserPromptSubmit hook).
// Fires on EVERY user prompt.
//
// This file owns IO + policy: stdin, session, sentinel / confirmation detection,
// directive composition, output. The SCORING (frontmatter parsing, skill +
// memory ranking) lives in ./lib/skill-scoring.mjs so it can be exercised by the
// prompt battery (bin/eval.mjs) without spinning up the hook. Everything
// project-specific is read from skill-router.config.json via ./lib/config.mjs.
//
// What it does: scans the project's skills (and optional memory corpus), scores
// each against the prompt, and injects a WIDE candidate menu as context. The
// recall/precision split is deliberate — the matcher surfaces candidates
// (recall); the agent invokes the 2-3 most on-target (precision). Keyword
// scoring is strong at surfacing and weak at the final pick, so the pick is left
// to the model.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import { loadConfig, matchesProject, skillsDirFor } from './lib/config.mjs'
import {
  scanSkills, scanMemories, extractIntents, extractNegatives, normalizeText,
  rankSkills, scoreMemory, INTENT_VERBS,
} from './lib/skill-scoring.mjs'

// Session state (warm + seen skills, pending-confirmation flag) lives under the
// user's home, namespaced to skill-router — project-agnostic, never in the repo.
const SESSION_DIR_BASE = resolve(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude/skill-router/.sessions'
)

// ═══ CONFIRMATION DETECTOR ═══════════════════════════════════════════════════
// Fires when the user confirms a previously engineered prompt. On confirmation
// the headline directive shifts from "engineer the prompt" to "invoke the listed
// skills before any tool calls". Cap at 60 chars: anything longer is too
// substantive to be a pure confirmation.
const CONFIRMATION_TOKENS = [
  'go', 'yes', 'yep', 'yeah', 'sure', 'ok', 'okay',
  'proceed', 'approved', 'approve', 'confirm', 'confirmed',
  'do it', 'fix it', 'solve it', 'ship it', 'execute',
  'now', 'go ahead', 'lets go', "let's go",
  'lets move', "let's move", 'lets ship', "let's ship",
  'continue', 'run it', 'send it',
]

function isConfirmation(text) {
  const norm = text.toLowerCase()
    .replace(/[.,!?;:'"`*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (norm.length === 0 || norm.length > 60) return false
  for (const token of CONFIRMATION_TOKENS) {
    if (norm === token) return true
    if (norm.startsWith(token + ' ')) return true
  }
  return false
}

// Engineer-prompt sentinel — end a prompt with `\\`, `>>>`, `!!engineer`, or
// `!!plan` to INVOKE the engineered-prompt rewrite protocol. Default is direct
// execution; the sentinel is the opt-in for the heavyweight rewrite.
const ENGINEER_PROMPT_SENTINELS = [/>>>\s*$/, /\\\\\s*$/, /!!\s*engineer\s*$/i, /!!\s*plan\s*$/i]
function isEngineerRequest(text) {
  return ENGINEER_PROMPT_SENTINELS.some(re => re.test(text))
}

// ═══ FILE CONTEXT (uncommitted files) ════════════════════════════════════════
function getRecentlyEditedFiles(cwd) {
  try {
    const out = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 500 })
    return out.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => l.replace(/^[MADRCU?! ]+/, '').trim())
      .filter(Boolean)
  } catch { return [] }
}

// ═══ SESSION TRACKING (warm skills + seen skills) ════════════════════════════
function loadSession(sessionId) {
  const f = join(SESSION_DIR_BASE, `${sessionId}.json`)
  try {
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf-8'))
  } catch { /* ignore */ }
  return {}
}

function saveSession(sessionId, data) {
  const f = join(SESSION_DIR_BASE, `${sessionId}.json`)
  try {
    mkdirSync(SESSION_DIR_BASE, { recursive: true })
    writeFileSync(f, JSON.stringify({ ...data, lastUpdated: new Date().toISOString() }, null, 2))
  } catch { /* ignore */ }
}

// ═══ STDIN ═══════════════════════════════════════════════════════════════════
let stdin = ''
for await (const chunk of process.stdin) stdin += chunk

const trimmed = stdin.trim()
if (!trimmed) { process.stdout.write('{}'); process.exit(0) }

let input
try { input = JSON.parse(trimmed) }
catch { process.stdout.write('{}'); process.exit(0) }

const rawPrompt = (input.prompt || input.message || '').trim()
const sessionId = input.session_id || input.conversation_id || process.env.SESSION_ID || 'default'
const cwd = input.cwd || process.env.CLAUDE_PROJECT_ROOT || process.cwd()

// Load config + project gate. Off → pass through silently.
const config = loadConfig(cwd.replace(/\\/g, '/'))
if (!matchesProject(config, cwd)) { process.stdout.write('{}'); process.exit(0) }

const sc = config.scoring
const MIN_PROMPT_LENGTH = sc.minPromptLength

// Load session early — confirmation detection depends on whether an engineered
// rewrite is genuinely PENDING (recorded last turn when the sentinel fired).
const session = loadSession(sessionId)

const isConfirmationPhrase = isConfirmation(rawPrompt)
const isPhase2 = isConfirmationPhrase && session.awaitingConfirmation === true
const isEngineer = !isPhase2 && isEngineerRequest(rawPrompt)
// Strip the sentinel so the trailing token doesn't leak into keyword matches.
const prompt = isEngineer
  ? rawPrompt.replace(/(?:>>>|\\\\|!!\s*engineer|!!\s*plan)\s*$/i, '').trim()
  : rawPrompt
// Confirmations (with a pending rewrite) bypass the length floor.
if (!isPhase2 && prompt.length < MIN_PROMPT_LENGTH) { process.stdout.write('{}'); process.exit(0) }

// ═══ MAIN ════════════════════════════════════════════════════════════════════
const normalizedPrompt = normalizeText(prompt)

// Build scoring context.
const intentVerbs = { ...INTENT_VERBS, ...(config.intentVerbs || {}) }
const intents = extractIntents(prompt, intentVerbs)
const negatives = extractNegatives(prompt)
const recentFiles = getRecentlyEditedFiles(cwd)
const warmSkills = new Set(session.lastInjectedSkills || [])
const seenSkills = new Set(session.seenSkills || [])

const scoringCtx = {
  normalizedPrompt, intents, negatives, recentFiles, warmSkills, seenSkills,
  intentAffinity: config.intentAffinity || {},
}

// Scan skills + memories.
const skills = scanSkills(skillsDirFor(config, cwd), sc.minScore)
const memories = scanMemories(config.memory?.dir || null)

// Score skills (gating + ranking live in the scoring core).
const skillScores = rankSkills(skills, scoringCtx, sc.menuSize)

// Score memories.
const now = Date.now()
const memThreshold = config.memory?.threshold ?? 3
const memMax = config.memory?.max ?? 4
const memoryScores = memories
  .map(memory => {
    const { score, matched } = scoreMemory(memory, normalizedPrompt, now)
    return { ...memory, score, matched, passed: score >= memThreshold }
  })
  .filter(m => m.passed)
  .sort((a, b) => b.score - a.score)
  .slice(0, memMax)

// Build output. Three modes: confirmation execute / engineer-sentinel rewrite /
// default direct-execution.
const picks = sc.picks
const lines = []
if (isPhase2) {
  lines.push('[skill-router] EXECUTE confirmed. REQUIRED before any Read / Edit / Write / Bash this turn: (1) For each skill listed under "Skills to Invoke" in your previous engineered prompt, call the Skill tool ONCE — UNLESS it is tagged [seen] below AND its launch message is still visible in your context, in which case state "Skill /<name> reused from earlier this session" and skip the call. Silent skips are a failure. (2) Read any project rule/convention files relevant to the edit path. (3) Execute the work outlined in the engineered prompt\'s Approach.')
} else if (isEngineer) {
  lines.push('[skill-router] ENGINEER-PROMPT sentinel detected (\\\\, >>>, !!engineer, or !!plan at end of prompt). REWRITE the request before any Read / Edit / Write / Bash this turn: state Intent / Scope / Context / Constraints / Success Criteria / Approach / Skills to Invoke, end with "Awaiting your confirmation.", then STOP. Execute only after the user replies with go / proceed / yes / approved / ship it / etc. Use this when the cost of misunderstanding intent would exceed the cost of the rewrite.')
} else {
  const skillClause = skillScores.length > 0
    ? `(1) ${skillScores.length} CANDIDATE skill(s) below — a wide recall menu, not a checklist. BEFORE your first Read / Edit / Write / Bash, pick the ${picks} MOST on-target for THIS task and invoke them via the Skill tool, at the START of the turn. You supply the precision: ignore any candidate that is off-target, and invoke a better-fit skill yourself if the menu missed it. A candidate tagged [seen] was surfaced earlier this session: if you already invoked it, reuse it from context instead of re-invoking.`
    : `(1) No skills auto-matched this prompt. If the task touches a specialized surface with a matching skill, pick the ${picks} most specific yourself and invoke them via the Skill tool at the START, before editing.`
  lines.push(`[skill-router] ${skillClause} (2) Read the project rule/convention file matching the edit path before editing. (3) Execute. (4) Self-audit on completion: name which component/path you changed, no unverified claims, no padding. End the turn in one or two sentences: what changed, what's next. To invoke the engineered-prompt rewrite protocol explicitly, end the next prompt with \`\\\\\` / \`>>>\` / \`!!engineer\` / \`!!plan\`.`)
}
lines.push(`[skill-router] context: intent=${[...intents].join(',') || 'generic'}${negatives.size ? ` | neg=${[...negatives].join(',')}` : ''}${recentFiles.length ? ` | ${recentFiles.length} edited` : ''}${isPhase2 ? ' | confirmed=true' : ''}`)

if (skillScores.length > 0) {
  for (const s of skillScores) {
    const seenTag = s.wasSeen ? ' [seen]' : ''
    const why = s.reasons.slice(0, 3).join(', ')
    lines.push(`- /${s.name}${seenTag}${why ? ` (${why}, score ${s.score.toFixed(1)})` : ''}`)
  }
}

if (memoryScores.length > 0) {
  for (const m of memoryScores) {
    const typeTag = m.type === 'feedback' ? ' [feedback]' : m.type === 'project' ? ' [project]' : ''
    lines.push(`- memory: ${m.file}${typeTag}`)
  }
}

// Persist session state (warm skills + seen skills).
const primaryNames = skillScores.map(s => s.name)
const allSeen = new Set(session.seenSkills || [])
for (const n of primaryNames) allSeen.add(n)
saveSession(sessionId, {
  ...session,
  seenSkills: [...allSeen],
  lastInjectedSkills: primaryNames.slice(0, 5), // top candidates carry a small warm boost next turn
  awaitingConfirmation: isEngineer,
})

const additionalContext = lines.join('\n')
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext,
  },
}))
