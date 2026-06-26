# skill-router

Natural-language skill routing for [Claude Code](https://docs.claude.com/en/docs/claude-code), as a zero-dependency plugin.

Every prompt, it scores your installed skills against what the user actually asked, then injects a ranked candidate menu so the agent invokes the right specialist *before* it starts editing. It ships with an operating-discipline layer and a safety gate too, but the headline is the router: you declare a few `promptSignals` in each skill's frontmatter, and the right skills surface on their own.

```text
user: "audit the upload endpoint for security, then write tests for it"
        │
        ▼  the UserPromptSubmit hook scores every installed skill
skill-router injects a ranked candidate menu:
  - /security-review        ("security audit", score 6.0)
  - /testing-verification   ("write tests", score 6.0)
        │
        ▼
the agent invokes the 2-3 most on-target before it starts editing.
```

## Why it is different

Most skill routers try to deterministically pick *one* skill from a prompt. Keyword scoring is good at surfacing candidates and bad at the final choice, so this one does not pretend otherwise. It splits the job:

- **Recall (the hook):** cast a wide, ranked candidate menu of everything plausibly relevant.
- **Precision (the model):** the agent invokes the 2-3 that actually fit the task.

The result is fewer missed specialists without the brittleness of a hard one-shot classifier.

It is also **measured, not asserted.** A prompt battery (`bin/eval.mjs`) runs the real scoring module and reports recall@3, top-1, and precision, so any tuning change to the scorer reports a number instead of a vibe.

And it is **zero dependency.** Pure Node (`node:fs`, `node:path`). No install step, no parser library. The YAML frontmatter parser is hand-rolled and handles block scalars, sequences, comments, and nesting.

## Install

Two ways, same harness. Pick whichever fits how you work.

### Option A: clone and wire it yourself

No plugin system, full control, easy to read and fork. Clone it anywhere and let the installer merge the hooks into your user settings:

```text
git clone https://github.com/REPLACE_ME/skill-router
cd skill-router
node scripts/install.mjs            # prints the exact hooks block to review
node scripts/install.mjs --write    # merges it into ~/.claude/settings.json (backs up first)
```

`--write` is idempotent and never touches your other hooks or permissions. Prefer to wire it by hand? Run it without `--write` and paste the printed block into any `settings.json`. Requires Node 18+. There is nothing to `npm install`.

### Option B: as a Claude Code plugin

The repo is also its own single-plugin marketplace:

```text
/plugin marketplace add REPLACE_ME/skill-router
/plugin install skill-router@skill-router
```

Or from a local clone:

```text
git clone https://github.com/REPLACE_ME/skill-router
/plugin marketplace add ./skill-router
/plugin install skill-router@skill-router
```

The hooks register automatically.

With no config file present, the router activates in any project that has a `.claude/skills/` directory and behaves generically. To scope or tune it, drop a `skill-router.config.json` in your project root (see [Configuration](#configuration)).

## Declare signals on your skills

A skill opts into routing by adding `metadata.promptSignals` to its `SKILL.md` frontmatter:

```yaml
---
name: security-review
description: Audit code for vulnerabilities, review auth, find injection and secret-handling flaws.
metadata:
  priority: 60
  promptSignals:
    phrases:
      - "security audit"
      - "sql injection"
      - "auth bypass"
      - "secret leak"
    minScore: 6
    anyOf: []        # if set, prompt must contain at least one of these
    noneOf:          # if any appears, the skill is disqualified
      - "design tokens"
  pathPatterns:
    - "auth/.*"      # boost when an uncommitted file matches
---
```

Nothing else changes about your skills. A skill with no `promptSignals` simply never auto-routes (its description still contributes a weak corroborating signal). Full contract in [docs/SPEC.md](docs/SPEC.md).

## What is in the box

Eight hooks across five events. The router is the star; the rest is an opinionated-but-optional operating layer you can trim via config.

| Hook | Event | Role |
|------|-------|------|
| `prompt-intelligence.mjs` | UserPromptSubmit | The router: score skills + memory, inject the candidate menu |
| `file-dispatch.mjs` | PreToolUse (Edit/Write) | Path to skill+rule advisory when you open a matching file |
| `agents-md-bridge.mjs` | UserPromptSubmit | Inject learned-preference sections from your `AGENTS.md` |
| `agentic-brain.mjs` | UserPromptSubmit | Inject senior operating discipline, scaled to the prompt |
| `agentic-brain-bootstrap.mjs` | SessionStart | Seed the operating brain, reset the per-session ledger |
| `agentic-brain-tooluse.mjs` | PreToolUse | Safety gate: deny never-correct ops, confirm destructive ones |
| `agentic-brain-toolresult.mjs` | PostToolUse | Re-judge results (a green type-check is not a working feature) |
| `agentic-brain-stop.mjs` | Stop | One verify-before-done self-review when real work happened |

Every hook fails open (any parse error allows normal flow) and no-ops when the project gate does not match, so a defect can never brick your toolchain.

## Configuration

Drop `skill-router.config.json` in your project root (or `.claude/`, or point `$SKILL_ROUTER_CONFIG` at it). It deep-merges over built-in defaults, so you only specify what you change. Full reference in [docs/CONFIG.md](docs/CONFIG.md); a worked example in [examples/skill-router.config.json](examples/skill-router.config.json).

```json
{
  "project": { "match": ["my-app"] },
  "intentAffinity": { "testing-verification": ["TEST", "DEBUG"] },
  "fileSkillMap": [
    { "pattern": "\\.test\\.ts$", "skills": ["/testing-verification"], "rules": [] }
  ]
}
```

## Tune the matcher

```
node bin/probe.mjs "the canvas goes black after a blur node" --skills ./.claude/skills
node bin/eval.mjs --skills ./.claude/skills   # recall@3 / top-1 / precision over a battery
```

The probe prints what the live hook would inject for one prompt; the battery measures the scorer against a set of expected/forbidden cases so regressions are visible.

## License

MIT. See [LICENSE](LICENSE).
