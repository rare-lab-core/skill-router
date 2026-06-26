#!/usr/bin/env node
// AGENTS.md bridge — UserPromptSubmit hook.
//
// Many teams keep high-signal user preferences and workspace facts in an
// AGENTS.md file (some continual-learning pipelines write to it automatically).
// This hook reads the configured markdown sections from the first AGENTS.md it
// finds and injects them into context every prompt, so the agent inherits that
// accumulated learning without a manual port.
//
// Project-specific (the file + sections are configured), so it honors the
// project gate. Degrades gracefully if AGENTS.md is missing, malformed, or has
// none of the named sections.
//
// Output contract: hookSpecificOutput.additionalContext.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig, matchesProject } from './lib/config.mjs'

let stdin = ''
for await (const chunk of process.stdin) stdin += chunk

// Preserve pass-through on early exit (UserPromptSubmit hooks are concatenated,
// so an empty object is the correct no-op).
const noop = () => { process.stdout.write('{}'); process.exit(0) }

let input = {}
try { input = JSON.parse(stdin.trim() || '{}') } catch { /* tolerate */ }

const cwd = (input.cwd || process.cwd()).replace(/\\/g, '/')
const config = loadConfig(cwd)
if (!matchesProject(config, cwd)) noop()

const paths = Array.isArray(config.agentsMd?.paths) ? config.agentsMd.paths : []
const sections = Array.isArray(config.agentsMd?.sections) ? config.agentsMd.sections : []
if (paths.length === 0 || sections.length === 0) noop()

let agentsMdPath = null
for (const p of paths) {
  const abs = resolve(cwd, p)
  if (existsSync(abs)) { agentsMdPath = abs; break }
}
if (!agentsMdPath) noop()

let agentsMd = ''
try { agentsMd = readFileSync(agentsMdPath, 'utf-8') } catch { noop() }

// Extract a "## <Heading>" section up to the next "## " heading or EOF.
function extractSection(text, heading) {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|\\n)##\\s+${esc}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i')
  const m = text.match(re)
  return m ? m[2].trim() : ''
}

const blocks = []
for (const heading of sections) {
  const body = extractSection(agentsMd, heading)
  if (body) blocks.push(`## ${heading}\n\n${body}`)
}
if (blocks.length === 0) noop()

// Defensive cap — at rest these sections are small; runaway growth suggests a
// pipeline regression, not real content.
const MAX_BYTES = 40 * 1024
let injection = blocks.join('\n\n')
if (injection.length > MAX_BYTES) injection = injection.slice(0, MAX_BYTES) + '\n\n[truncated — exceeds 40KB cap]'

const rel = agentsMdPath.replace(cwd, '.')
const additionalContext = `[skill-router] AGENTS.md learned sections (${injection.length} bytes, source: ${rel})\n\n${injection}`

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext,
  },
}))
