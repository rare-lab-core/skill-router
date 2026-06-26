# Architecture

## The core idea: recall in the hook, precision in the model

A skill router has one job: given a prompt, decide which specialist knowledge to load. The tempting design is a classifier that picks the single best skill. In practice keyword scoring is good at one half of that and bad at the other:

- It reliably *surfaces* the handful of skills plausibly relevant to a prompt (recall).
- It is unreliable at *choosing* the single right one, because the right choice depends on architecture context a keyword count cannot see (precision).

So skill-router does not choose. The hook injects a wide, ranked candidate menu, and the agent, which already has the full conversation and codebase context, invokes the two or three that actually fit. The split is deliberate: cheap, deterministic scoring does the recall step; the model does the precision step it is better at.

A consequence worth stating: a skill earns a menu slot if it clears its gates and either reaches its `minScore` (a confident match) or carries a single strong signal (a declared phrase or a path hit). Strong-but-below-threshold skills still surface, because the agent makes the final call. This widens recall without lowering the bar that defines a confident match.

## Signal strength, and why it is gated

Not all evidence is equal. The scorer separates signals into strong and weak:

- **Strong** is the skill author's own contract: a declared phrase appeared, or a `pathPattern` matched a file you have uncommitted right now.
- **Weak** is circumstantial: description-word overlap, an intent-verb class, a warm carry-over from last turn.

Weak signals can corroborate and re-rank, but they can never solo-clear the bar. This is the single most important precision rule in the scorer. Without it, a skill whose description happens to share three common words with the prompt would surface on nothing real. Intent affinity, in particular, is explicitly gated on a strong signal having already fired, so it sharpens a true match instead of inventing one.

## Gates vs scores

Phrases and boosts move a number. Gates are boolean and run independently of the number:

- `noneOf`: if any listed phrase appears, the skill is dropped no matter how high it scored.
- `anyOf`: if the list is non-empty, at least one must appear or the skill is dropped.
- `allOf`: if the list is non-empty, all must appear or the skill is dropped.

Gates are how you buy precision without starving the phrase list. A broad skill keeps its useful phrases and adds a `noneOf` for the domain it must never fire on.

## Matching is inflection-tolerant, within limits

A naive substring match treats `deploy` and `deploying` as unrelated and `import` as a match inside `important`. The scorer uses a controlled stem-suffix set: an exact word, a simple plural, or a known morphological suffix (`-ing`, `-ed`, `-tion`, and a few more) on a shared stem of at least five characters. So `republish` matches `republishing`, but `import` never matches `important`, and short words only match exactly or as a plural, since prefix drift on three- and four-letter words is mostly noise. Multi-word phrases also match when their content words appear in any order, so a declared `"black canvas"` catches `"the canvas goes black"`.

## Measured, not asserted

The scorer is a pure module (`hooks/lib/skill-scoring.mjs`) with no IO. That is what lets `bin/eval.mjs` run the *real* scoring code against a battery of prompts and report recall@3, top-1, and precision. Any change to the matcher reports a number, so a tuning move that helps one case and quietly breaks two others is visible immediately instead of shipping on a hunch. The probe (`bin/probe.mjs`) does the same for a single prompt.

## Components

```
hooks/
  lib/
    config.mjs          # finds + merges skill-router.config.json over defaults
    skill-scoring.mjs   # pure scoring core: parse, scan, score, rank
  prompt-intelligence.mjs       # UserPromptSubmit: the router
  file-dispatch.mjs             # PreToolUse (Edit/Write): path -> skill+rule
  agents-md-bridge.mjs          # UserPromptSubmit: AGENTS.md learned sections
  agentic-brain.mjs             # UserPromptSubmit: operating discipline
  agentic-brain-bootstrap.mjs   # SessionStart: seed brain, reset ledger
  agentic-brain-tooluse.mjs     # PreToolUse: safety gate
  agentic-brain-toolresult.mjs  # PostToolUse: re-judge, flag work
  agentic-brain-stop.mjs        # Stop: verify-before-done, once per session
bin/
  probe.mjs             # routing for one prompt
  eval.mjs              # recall/precision battery
```

Every hook reads stdin, writes a single JSON object to stdout, and fails open: any parse error or unexpected shape returns the empty no-op `{}`, so a defect in a hook can never brick the toolchain. The router and the project-specific advisories honor the project gate; the operating discipline is universal. Session state (warm and seen skills, the per-session work ledger) lives under `~/.claude/skill-router/.sessions`, never in your repo.

## Zero dependencies

Everything is plain Node (`node:fs`, `node:path`, `node:child_process`). The YAML frontmatter parser is hand-rolled and handles the subset that skill frontmatter actually uses: nested keys, sequences, block scalars (`>` and `|`), and comments. There is no install step and nothing to keep up to date.
