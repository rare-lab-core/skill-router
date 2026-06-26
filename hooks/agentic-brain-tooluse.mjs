#!/usr/bin/env node
// Agentic Tool Gate — PreToolUse hook, fires before every tool call.
//
// Inspects the validated call and either denies an unambiguously irreversible
// operation with an actionable reason, escalates a destructive-but-sometimes-
// legitimate operation to a confirmation, or injects targeted guidance ahead of
// a configured high-risk edit. The reason becomes a signal the model reads and
// corrects against, not a stack trace.
//
// Two layers:
//   1. Generic git-hygiene rules — universal, each opt-out-able via config.safety
//      booleans (default on).
//   2. Project edit rules — denyEditGlobs / adviseEditGlobs from the config,
//      applied only when the project gate matches.
//
// Fail-open by design: any parse error or unexpected shape allows the call, so a
// defect in this hook can never brick the toolchain.
//
// Output contract: hookSpecificOutput.permissionDecision of "deny" | "ask" with
// permissionDecisionReason, or additionalContext to advise while allowing, or {}
// to defer to the normal flow.

import { loadConfig, matchesProject } from './lib/config.mjs'

let stdin = ''
for await (const chunk of process.stdin) stdin += chunk

const trimmed = stdin.trim()
if (!trimmed) { process.stdout.write('{}'); process.exit(0) }

let input
try { input = JSON.parse(trimmed) } catch { process.stdout.write('{}'); process.exit(0) }

function emit(payload) { process.stdout.write(JSON.stringify(payload)); process.exit(0) }
function decide(decision, reason) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } })
}
function advise(context) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `[skill-router:gate] ${context}` } })
}
const pass = () => emit({})

try {
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}
  const cwd = (input.cwd || '').replace(/\\/g, '/')
  const path = String(ti.file_path || ti.path || '').replace(/\\/g, '/')
  const cmd = String(ti.command || '')

  const config = loadConfig(cwd || process.cwd())
  const safety = config.safety || {}
  const inProject = matchesProject(config, cwd || process.cwd())

  // ── Layer 1: generic git hygiene (universal, opt-out via config) ──
  if (tool === 'Bash' && cmd) {
    if (safety.blockNoVerify !== false && /\bgit\s+commit\b[^\n]*--no-verify\b/.test(cmd)) {
      decide('deny', 'git commit --no-verify skips the hooks and checks that exist to catch problems. Fix the failing check instead of bypassing it.')
    }
    if (safety.blockForceAddAgentDirs !== false &&
        /\bgit\s+add\s+(-f|--force)\b/.test(cmd) && /\.(agents|claude|cursor|gemini)\b/.test(cmd)) {
      decide('deny', 'Force-adding into an agent-workspace folder (.agents / .claude / .cursor / .gemini) leaks internal tooling into git history. These stay untracked.')
    }
    if (safety.blockAttributionCommits !== false &&
        /\bgit\s+commit\b/.test(cmd) && /(Co-Authored-By|Co-authored-by|Generated with|🤖)/i.test(cmd)) {
      decide('deny', 'Commit message carries authorship or tool-attribution language. Describe the change itself; no co-author or generated-by trailers.')
    }
    if (safety.confirmDestructiveGit !== false) {
      if (/\bgit\s+reset\s+--hard\b/.test(cmd) ||
          /\bgit\s+checkout\s+(--\s|\.\s*$|\.$)/.test(cmd) ||
          /\bgit\s+clean\s+-[a-z]*\bf/.test(cmd) ||
          /\bgit\s+stash\b/.test(cmd)) {
        decide('ask', 'Destructive on the working tree (reset --hard / checkout . / clean -f / stash) can discard uncommitted work. Confirm this is intended.')
      }
      if (/\bgit\s+push\b[^\n]*(--force|-f)\b/.test(cmd)) {
        decide('ask', 'Force-push rewrites remote history. Confirm the target branch and that no shared work is overwritten.')
      }
    }
  }

  // ── Layer 2: project edit rules (gated on project match) ──
  if (inProject && (tool === 'Edit' || tool === 'Write') && path) {
    for (const rule of (safety.denyEditGlobs || [])) {
      if (!rule || !rule.pattern) continue
      let re; try { re = new RegExp(rule.pattern, 'i') } catch { continue }
      if (re.test(path)) decide('deny', rule.reason || `Editing ${path} is blocked by a project rule.`)
    }
    for (const rule of (safety.adviseEditGlobs || [])) {
      if (!rule || !rule.pattern) continue
      let re; try { re = new RegExp(rule.pattern, 'i') } catch { continue }
      if (re.test(path) && rule.advice) advise(rule.advice)
    }
  }

  pass()
} catch {
  pass()
}
