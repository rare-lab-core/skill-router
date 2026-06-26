# promptSignals: the skill frontmatter contract

A skill opts into natural-language routing by declaring `metadata.promptSignals` (and optionally `metadata.pathPatterns` and `metadata.priority`) in its `SKILL.md` YAML frontmatter. This is the entire contract. The scorer reads only these fields; everything else about your skill is untouched.

## Fields

```yaml
---
name: my-skill                      # falls back to the directory name
description: One line on what this skill does and when to use it.
metadata:
  priority: 60                      # tie-breaker, default 50; higher wins ties
  pathPatterns:                     # regex sources; boost when an uncommitted file matches
    - "lib/payments/.*"
    - "\\.stripe\\.ts$"
  promptSignals:
    phrases:                        # the authoritative signal (see Scoring)
      - "split payment"
      - "stripe webhook"
      - "payout"
    minScore: 6                     # bar this skill must clear to be a confident match
    anyOf: []                       # gate: prompt must contain >= 1 of these (if non-empty)
    allOf: []                       # gate: prompt must contain ALL of these (if non-empty)
    noneOf:                         # gate: disqualified if ANY of these appears
      - "design system"
---
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `promptSignals.phrases` | string[] | `[]` | The keywords/phrases that define this skill's domain. The primary signal. |
| `promptSignals.minScore` | number | `6` (configurable) | Score the skill must reach to count as a *confident* match. |
| `promptSignals.anyOf` | string[] | `[]` | Hard gate. If non-empty, at least one must appear in the prompt or the skill is dropped. |
| `promptSignals.allOf` | string[] | `[]` | Hard gate. If non-empty, all must appear or the skill is dropped. |
| `promptSignals.noneOf` | string[] | `[]` | Hard gate. If any appears, the skill is dropped regardless of score. |
| `pathPatterns` | string[] | `[]` | Regex sources. A match against an uncommitted file adds a strong boost. |
| `priority` | number | `50` | Tie-breaker only. Does not change whether a skill matches. |

## Scoring

A skill is surfaced in the candidate menu when it **clears its gates** AND **either** reaches `minScore` (a confident match) **or** carries a *strong* signal (a declared phrase hit or a path match). Strong-but-below-minScore skills still earn a menu slot, because the agent makes the final pick: recall here, precision at the model.

Signal strength, highest to lowest:

1. **Phrase hit (strong).** A declared phrase present in the prompt. A single distinctive word (`stripe`, `zustand`, `marketplace`) scores its own length, so one domain word can clear a minScore-6 bar alone. Multi-word phrases score length/2 (they are already specific).
2. **Reordered phrase (strong).** All content words of a multi-word phrase present in any order (`"canvas goes black"` matches the declared `"black canvas"`).
3. **Path match (strong).** A `pathPatterns` entry matches a file you have uncommitted right now. `+3`.
4. **Intent affinity (corroborator).** The prompt's verb class (BUILD / DEBUG / REVIEW / PLAN / REFACTOR / TEST / DEPLOY) matches the skill's configured affinity. `+2` per class, but only if a strong signal already fired. It sharpens a real match; it cannot manufacture one.
5. **Description overlap (corroborator).** Shared words between prompt and `description`. Capped at `+2`. Never strong.
6. **Warm carry-over (corroborator).** A skill injected last turn carries a small `+1.5`.

Negative suppression: if the prompt says `don't use X` / `skip X` / `without X` / `avoid X` and `X` matches the skill name, the skill loses `5`.

Phrase matching is **inflection-tolerant** with a controlled stem-suffix set: `republish` matches `republishing`, `deploy` matches `deploying`, but `import` never matches `important`. Words shorter than 5 characters only match exactly or as a simple plural, since prefix drift on short words is mostly noise.

## Authoring guidance

- **Pick distinctive phrases.** One word that *is* your domain (`webhook`, `kubernetes`, `migration`) beats five generic ones (`render`, `update`, `data`).
- **Use gates for precision, not phrases.** If your skill must never fire on design prompts, add `noneOf: ["design tokens", "color palette"]` rather than starving the phrase list.
- **Raise `minScore` for broad skills.** A skill whose phrases are common words should sit at 8-9 so it needs corroboration to surface.
- **`pathPatterns` are for the file you are editing, not the topic.** They boost when the matching file is uncommitted, which is a strong signal you are working in that area right now.
- **Leave `promptSignals` off** for skills you only ever invoke by hand. They will not auto-route, and their description still contributes a weak corroborating signal if relevant.

## Memory frontmatter (optional)

If you point `memory.dir` at a folder of markdown notes, each is scored the same way against its frontmatter and body:

```yaml
---
name: deploy-runbook
description: Steps and gotchas for the production deploy.
type: project        # feedback | project | reference | (anything) — feedback/project score slightly higher
---
```

Files newer than 7 days get a small recency boost. `MEMORY.md` is treated as an index and skipped.
