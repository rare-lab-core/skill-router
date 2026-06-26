#!/usr/bin/env node
// Agentic Result Check — PostToolUse hook, fires after a tool runs.
//
// Re-judges what a tool actually produced and injects a follow-up directive,
// because a zero exit code is not the same as a correct result. Purely additive:
// it injects context next to the tool result, never rewrites output, never
// blocks. It also flags the per-session ledger (workTouched) that the Stop hook
// reads, so the verify-before-done gate only fires when real work happened.
//
// Universal discipline — not gated on the project; the reminders are generic.
//
// Output contract: hookSpecificOutput.additionalContext.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

let stdin = ''
for await (const chunk of process.stdin) stdin += chunk

const trimmed = stdin.trim()
if (!trimmed) { process.stdout.write('{}'); process.exit(0) }

let input
try { input = JSON.parse(trimmed) } catch { process.stdout.write('{}'); process.exit(0) }

function inject(context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `[agentic-check] ${context}` } }))
  process.exit(0)
}
const pass = () => { process.stdout.write('{}'); process.exit(0) }

function flagWork(sessionId) {
  try {
    const dir = resolve(process.env.HOME || process.env.USERPROFILE || '', '.claude/skill-router/.sessions')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, `${sessionId || 'default'}.brain.json`)
    let ledger = { workTouched: false, stopReminded: false }
    try { ledger = { ...ledger, ...JSON.parse(readFileSync(f, 'utf8')) } } catch { /* no prior ledger */ }
    writeFileSync(f, JSON.stringify({ ...ledger, workTouched: true }))
  } catch { /* best-effort; never affect the result */ }
}

try {
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}
  const path = String(ti.file_path || ti.path || '').replace(/\\/g, '/')
  const cmd = String(ti.command || '')

  if ((tool === 'Edit' || tool === 'Write') && path) {
    flagWork(input.session_id)
    pass()
  }

  if (tool === 'Bash' && cmd) {
    if (/\btsc\b[^\n]*--noEmit\b/.test(cmd) || /\b(tsc|type-?check)\b/.test(cmd)) {
      inject('A clean type-check is type-correctness, not feature-correctness. The result can be wrong with zero type errors. Verify the actual behavior before reporting this as working.')
    }
    if (/\bgit\s+commit\b/.test(cmd)) {
      flagWork(input.session_id)
      inject('Commit landed. Verify the diff actually matches what you described, with no claimed change the diff lacks, and scan the staged text for authorship or process language before moving on.')
    }
  }

  pass()
} catch {
  pass()
}
