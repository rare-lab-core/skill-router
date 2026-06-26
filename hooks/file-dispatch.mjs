#!/usr/bin/env node
// File-based skill dispatch — PreToolUse hook, fires before Edit / Write.
//
// When the agent opens a file matching a configured pattern, this hook injects a
// reminder to invoke the mapped skill(s) and read the matching convention/rule
// file before proceeding. The map is project-specific, so it is read from
// skill-router.config.json (fileSkillMap) and gated on the project match.
//
// Output contract: hookSpecificOutput.additionalContext (advisory only — never
// blocks).

import { loadConfig, matchesProject } from './lib/config.mjs'

let stdin = ''
for await (const chunk of process.stdin) stdin += chunk

const trimmed = stdin.trim()
if (!trimmed) { process.stdout.write('{}'); process.exit(0) }

let input
try { input = JSON.parse(trimmed) } catch { process.stdout.write('{}'); process.exit(0) }

// Only Edit / Write carry a file_path worth dispatching on.
const toolName = input.tool_name || ''
if (!['Edit', 'Write'].includes(toolName)) { process.stdout.write('{}'); process.exit(0) }

const toolInput = input.tool_input || {}
const filePath = toolInput.file_path || ''
if (!filePath) { process.stdout.write('{}'); process.exit(0) }

const cwd = (input.cwd || process.cwd()).replace(/\\/g, '/')
const config = loadConfig(cwd)
if (!matchesProject(config, cwd)) { process.stdout.write('{}'); process.exit(0) }

const map = Array.isArray(config.fileSkillMap) ? config.fileSkillMap : []
if (map.length === 0) { process.stdout.write('{}'); process.exit(0) }

const normalizedPath = filePath.replace(/\\/g, '/')
const matchedSkills = new Set()
const matchedRules = new Set()
for (const entry of map) {
  if (!entry || !entry.pattern) continue
  let re
  try { re = new RegExp(entry.pattern, 'i') } catch { continue }
  if (re.test(normalizedPath)) {
    for (const skill of (entry.skills || [])) matchedSkills.add(skill)
    for (const r of (entry.rules || [])) matchedRules.add(r)
  }
}

if (matchedSkills.size === 0 && matchedRules.size === 0) { process.stdout.write('{}'); process.exit(0) }

const rulesDir = config.rulesDir || '.claude/rules'
const skillList = [...matchedSkills].join(', ')
const ruleList = [...matchedRules].map(r => `${rulesDir}/${r}`).join(', ')
const shortPath = normalizedPath.split('/').slice(-3).join('/')
const skillPart = skillList ? ` skills: ${skillList}` : ''
const rulePart = ruleList ? ` | Read first: ${ruleList}` : ''
const advisory = `[skill-router:file] "${shortPath}" ->${skillPart}${rulePart}`

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: advisory,
  },
}))
