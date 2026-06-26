#!/usr/bin/env node
// Clone-and-go installer for skill-router.
//
// Wires the hooks into your user settings.json so the harness runs without the
// Claude Code plugin system. Run it from anywhere after cloning:
//
//   node scripts/install.mjs            # PRINT the hooks block + instructions
//   node scripts/install.mjs --write    # merge into ~/.claude/settings.json (backs up first)
//   node scripts/install.mjs --write --settings /path/to/settings.json
//
// It never deletes your existing hooks: --write merges skill-router's entries in
// and leaves everything else untouched. A timestamped backup is written first.

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const hooksDir = join(repoRoot, 'hooks')

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')
let settingsPath = null
const si = argv.indexOf('--settings')
if (si !== -1) settingsPath = resolve(argv[si + 1] || '')
if (!settingsPath) {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  settingsPath = join(home, '.claude', 'settings.json')
}

// Use forward slashes in the command paths — valid on every platform for node.
const hook = (file) => ({ type: 'command', command: `node "${join(hooksDir, file).replace(/\\/g, '/')}"` })

// settings.json hook format: events at the top level (no plugin wrapper).
const SKILL_ROUTER_HOOKS = {
  SessionStart: [{ hooks: [hook('agentic-brain-bootstrap.mjs')] }],
  UserPromptSubmit: [{
    hooks: [
      hook('prompt-intelligence.mjs'),
      hook('agentic-brain.mjs'),
      hook('agents-md-bridge.mjs'),
    ],
  }],
  PreToolUse: [
    { matcher: 'Edit|Write', hooks: [hook('file-dispatch.mjs')] },
    { matcher: '*', hooks: [hook('agentic-brain-tooluse.mjs')] },
  ],
  PostToolUse: [{ matcher: '*', hooks: [hook('agentic-brain-toolresult.mjs')] }],
  Stop: [{ hooks: [hook('agentic-brain-stop.mjs')] }],
}

if (!WRITE) {
  console.log('skill-router hooks block (settings.json format). Add this under "hooks" in')
  console.log(`your settings.json, or re-run with --write to merge it automatically.\n`)
  console.log(`  hooks dir : ${hooksDir}`)
  console.log(`  target    : ${settingsPath}\n`)
  console.log(JSON.stringify({ hooks: SKILL_ROUTER_HOOKS }, null, 2))
  console.log('\nThen drop a skill-router.config.json in your project (see examples/).')
  process.exit(0)
}

// --write: merge into settings.json, appending our entries to each event array.
let settings = {}
if (existsSync(settingsPath)) {
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) }
  catch (e) { console.error(`Could not parse ${settingsPath}: ${e.message}. Aborting (file left untouched).`); process.exit(1) }
  const backup = `${settingsPath}.skill-router-backup`
  copyFileSync(settingsPath, backup)
  console.log(`Backed up existing settings to ${backup}`)
} else {
  mkdirSync(dirname(settingsPath), { recursive: true })
}

settings.hooks = settings.hooks || {}
const tag = 'skill-router/hooks/'
for (const [event, entries] of Object.entries(SKILL_ROUTER_HOOKS)) {
  const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : []
  // Drop any prior skill-router entries so re-running is idempotent.
  const cleaned = existing.filter(group =>
    !(group.hooks || []).some(h => typeof h.command === 'string' && h.command.includes(tag)))
  settings.hooks[event] = [...cleaned, ...entries]
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
console.log(`Wired skill-router into ${settingsPath}`)
console.log('Restart Claude Code, then drop a skill-router.config.json in your project (see examples/).')
