#!/usr/bin/env node
// skill-router config loader — pure, zero-dependency.
//
// Everything project-specific lives in a single JSON file the consumer owns;
// the engine and hooks stay generic. This module finds that file, deep-merges it
// over built-in defaults, and answers the project-activation gate. No side
// effects on import.
//
// Resolution order (first hit wins):
//   1. $SKILL_ROUTER_CONFIG                       (absolute path, escape hatch)
//   2. <cwd>/skill-router.config.json
//   3. <cwd>/.claude/skill-router.config.json
//   4. built-in DEFAULTS only (no file → still works, generic behaviour)

import { readFileSync, existsSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'

export const DEFAULTS = {
  // Which projects the router activates in. Case-insensitive substring match
  // against the working directory. ['*'] (or []) = any project that has a
  // skills directory. Set to e.g. ['my-app'] to scope the router to one repo.
  project: { match: ['*'] },

  // Skills live here by convention (Claude Code's own layout). Relative to cwd.
  skillsDir: '.claude/skills',

  // Optional per-project memory injection. `dir` is an absolute path to a folder
  // of `*.md` files with `name:`/`description:`/`type:` frontmatter, or null to
  // disable. Off by default — most projects have no memory corpus.
  memory: { dir: null, threshold: 3, max: 4 },

  scoring: {
    menuSize: 12,        // how many candidate skills the hook surfaces as a menu
    picks: '2-3',        // how many the agent is told to invoke from that menu
    minScore: 6,         // default bar a skill must clear (per-skill override wins)
    minPromptLength: 12, // below this, the prompt is treated as trivial → no-op
    warmBoost: 1.5,      // a skill injected last turn carries a small carry-over
    fileBoost: 3,        // pathPatterns match an uncommitted file → +3 (strong)
    intentBoost: 2,      // per intent-class match, gated on a strong signal → +2
    negativeSuppression: 5, // "don't use X" in the prompt → -5 on skill X
  },

  // skillName -> [INTENT classes] affinity. Sharpens a real match; can never
  // solo-clear the bar (gated on a strong phrase/path signal in the engine).
  // Intent classes: BUILD DEBUG REVIEW PLAN REFACTOR TEST DEPLOY.
  intentAffinity: {},

  // Extra intent verbs, merged into the built-in sets. e.g. { DEPLOY: ['rollout'] }.
  intentVerbs: {},

  // PreToolUse path -> skills + topical-rule advisory (the file-dispatch hook).
  // Each entry: { pattern: "<regex source>", skills: ["/x"], rules: ["y.md"] }.
  fileSkillMap: [],
  // Folder under the project that topical rule files live in (advisory text only).
  rulesDir: '.claude/rules',

  // AGENTS.md learned-preferences bridge. Reads the named markdown sections from
  // the first existing path and injects them every prompt. Set paths: [] to skip.
  agentsMd: {
    paths: ['AGENTS.md'],
    sections: ['Learned User Preferences', 'Learned Workspace Facts'],
  },

  // Operating-discipline safety gate (the tool-use + tool-result hooks).
  // The generic rules below default ON but are individually opt-out-able. The
  // glob arrays add project-specific edits on top:
  //   denyEditGlobs   — regex sources; editing a matching path is denied
  //   adviseEditGlobs — regex sources; editing a matching path injects `advice`
  safety: {
    blockNoVerify: true,            // deny `git commit --no-verify`
    blockForceAddAgentDirs: true,   // deny `git add -f` into .agents/.claude/.cursor/.gemini
    blockAttributionCommits: true,  // deny commits with Co-Authored-By / Generated-with trailers
    confirmDestructiveGit: true,    // ask before reset --hard / checkout . / clean -f / stash / force-push
    denyEditGlobs: [],              // [{ pattern, reason }]
    adviseEditGlobs: [],            // [{ pattern, advice }]
  },
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

// Deep-merge `override` onto a copy of `base`. Arrays replace wholesale (a
// consumer's fileSkillMap is theirs, not appended to ours); objects merge by key.
export function deepMerge(base, override) {
  if (!isPlainObject(override)) return override === undefined ? base : override
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out
}

export function findConfigPath(cwd) {
  const env = process.env.SKILL_ROUTER_CONFIG
  if (env && existsSync(env)) return env
  const candidates = [
    resolve(cwd, 'skill-router.config.json'),
    resolve(cwd, '.claude', 'skill-router.config.json'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

export function loadConfig(cwd) {
  const path = findConfigPath(cwd)
  if (!path) return { ...DEFAULTS, _source: null }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return { ...deepMerge(DEFAULTS, raw), _source: path }
  } catch {
    // Malformed config must never brick the hook — fall back to defaults.
    return { ...DEFAULTS, _source: null }
  }
}

// Project-activation gate. ['*'] / [] matches anything; otherwise any listed
// token must appear (case-insensitive) in the normalized cwd.
export function matchesProject(config, cwd) {
  const match = config?.project?.match
  if (!Array.isArray(match) || match.length === 0 || match.includes('*')) return true
  const norm = String(cwd).replace(/\\/g, '/').toLowerCase()
  return match.some(tok => norm.includes(String(tok).toLowerCase()))
}

// Resolve the skills directory for a project (absolute).
export function skillsDirFor(config, cwd) {
  const d = config?.skillsDir || DEFAULTS.skillsDir
  return isAbsolute(d) ? d : resolve(cwd.replace(/\\/g, '/'), d)
}
