# Configuration reference

skill-router reads one optional JSON file and deep-merges it over built-in defaults, so you only specify what you change. With no file present, it activates in any project that has a `.claude/skills/` directory and behaves generically.

## Where the file goes

Resolution order, first hit wins:

1. `$SKILL_ROUTER_CONFIG` (an absolute path, useful in CI)
2. `<project>/skill-router.config.json`
3. `<project>/.claude/skill-router.config.json`

## Two scopes of behavior

This matters for understanding what the project gate does:

- **Routing and project-specific advisories** respect `project.match`: skill injection (`prompt-intelligence`), the file dispatcher (`file-dispatch`), the AGENTS.md bridge (`agents-md-bridge`), and the config-supplied edit rules (`safety.denyEditGlobs` / `adviseEditGlobs`). These only fire when the working directory matches.
- **Universal operating discipline** runs everywhere, regardless of the gate: the senior-discipline injection (`agentic-brain`), the session bootstrap and verify-before-done gate, and the generic git-hygiene denies. Each of these is individually opt-out-able via a config flag.

## Fields

### `project`

```json
{ "project": { "match": ["my-app"] } }
```

Case-insensitive substring match against the working directory. `["*"]` or `[]` matches anything. Use it to scope routing to one repo when the config lives somewhere broad.

### `skillsDir`

Where skills live, relative to the project (default `.claude/skills`). Absolute paths are honored.

### `memory`

Optional per-project memory injection. Off by default.

```json
{ "memory": { "dir": "/abs/path/to/memory", "threshold": 3, "max": 4 } }
```

`dir` is an absolute path to a folder of `*.md` files with `name` / `description` / `type` frontmatter (see [SPEC.md](SPEC.md#memory-frontmatter-optional)). `threshold` is the score a note must clear to inject; `max` caps how many inject per prompt.

### `scoring`

```json
{
  "scoring": {
    "menuSize": 12,
    "picks": "2-3",
    "minScore": 6,
    "minPromptLength": 12
  }
}
```

`menuSize` is how many candidate skills the hook surfaces. `picks` is the count the agent is told to invoke from that menu. `minScore` is the default bar (a skill's own `promptSignals.minScore` overrides it). `minPromptLength` is the floor below which a prompt is treated as trivial.

### `intentAffinity`

Maps a skill name to the verb classes it serves. A match adds a `+2` boost, but only after a strong phrase or path signal already fired, so it sharpens a real match and never manufactures one.

```json
{ "intentAffinity": { "testing-verification": ["TEST", "DEBUG"] } }
```

Classes: `BUILD DEBUG REVIEW PLAN REFACTOR TEST DEPLOY`.

### `intentVerbs`

Extra verbs merged into the built-in class sets.

```json
{ "intentVerbs": { "DEPLOY": ["rollout", "promote"] } }
```

### `fileSkillMap`

Drives the `file-dispatch` hook: when you Edit or Write a file whose path matches a `pattern` (a regex source), it injects a reminder to invoke the listed skills and read the listed rule files.

```json
{
  "fileSkillMap": [
    { "pattern": "\\.test\\.ts$", "skills": ["/testing-verification"], "rules": [] },
    { "pattern": "(^|/)migrations?/", "skills": ["/database-optimization"], "rules": ["db.md"] }
  ],
  "rulesDir": ".claude/rules"
}
```

`rules` entries are rendered relative to `rulesDir`.

### `agentsMd`

Drives the `agents-md-bridge` hook: it reads the named markdown sections from the first existing file and injects them every prompt. Set `paths: []` to disable.

```json
{
  "agentsMd": {
    "paths": ["AGENTS.md", ".github/AGENTS.md"],
    "sections": ["Learned User Preferences", "Learned Workspace Facts"]
  }
}
```

### `safety`

The operating-discipline gate. The four booleans below default `true` and gate universal git-hygiene rules. The two glob arrays add project-specific edit rules (gated on `project.match`).

```json
{
  "safety": {
    "blockNoVerify": true,
    "blockForceAddAgentDirs": true,
    "blockAttributionCommits": true,
    "confirmDestructiveGit": true,
    "denyEditGlobs": [
      { "pattern": "vendor/", "reason": "vendored code is generated, do not hand-edit" }
    ],
    "adviseEditGlobs": [
      { "pattern": "(^|/)migrations?/", "advice": "Confirm this migration is reversible and safe mid-deploy before applying." }
    ]
  }
}
```

| Flag | Default | Denies / asks |
|------|---------|---------------|
| `blockNoVerify` | true | `git commit --no-verify` |
| `blockForceAddAgentDirs` | true | `git add -f` into `.agents` / `.claude` / `.cursor` / `.gemini` |
| `blockAttributionCommits` | true | commits with `Co-Authored-By` / `Generated with` trailers |
| `confirmDestructiveGit` | true | asks before `reset --hard` / `checkout .` / `clean -f` / `stash` / force-push |

Set any to `false` to turn that rule off. The gate fails open: any error allows the operation.

## A complete example

See [examples/skill-router.config.json](../examples/skill-router.config.json).
