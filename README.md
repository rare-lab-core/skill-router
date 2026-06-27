<div align="center">

<!-- banner image goes here: <img src="assets/banner.png" alt="skill-router" width="680"> -->

# `>_ skill-router`

### Make Claude Code reach for the right skill on its own

<br>

**Eight hooks. Zero dependencies. The skills you wrote stop sitting unused and start showing up exactly when they matter.**

<br>

[![License: MIT](https://img.shields.io/badge/License-MIT-c084fc?style=for-the-badge)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Compatible-c084fc?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/code)
[![Node.js](https://img.shields.io/badge/Node.js_18+-4ade80?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Zero Deps](https://img.shields.io/badge/Dependencies-Zero-4ade80?style=for-the-badge)](.)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-fb923c?style=for-the-badge)](.)

<br>

*If this helps you, hit the star button above. Built by Captain Red and shared with the community.*

</div>

---

<br>

## The Problem

Claude Code has skills. A skill is a folder with a `SKILL.md` file full of instructions and knowledge the agent can pull in when it's relevant. You can write one for your database conventions, one for your auth flow, one for how your team reviews code.

The catch is the word "relevant." The agent decides on its own whether a skill is worth loading, from a one-line description, and that decision is hit or miss.

So you write a genuinely good database skill. Then you watch the agent debug a slow query from scratch and **never open it.** The knowledge was right there. It just didn't get pulled in at the moment it mattered.

That is the whole gap. You did the work of writing the skill. The skill only pays off if it actually loads on the prompts where it counts.

**skill-router closes that gap.**

<br>

---

<br>

## What It Does

```diff
- You wrote a great skill, and the agent works without ever loading it
+ The right skills get shortlisted on every prompt, before the agent starts

- You have to remember to type /skill-name, or you miss it
+ Skills auto-match your prompt and get recommended for you

- Keyword routers pick one skill and confidently pick the wrong one
+ The router shortlists a few; the agent makes the final call with full context

- "run the tests" loads nothing useful
+ Your testing skill surfaces, because you told it what its territory is
```

Every time you send a prompt, a hook runs. It reads the keywords you declared on each of your skills, scores them against what you actually asked, and hands the agent a short, ranked shortlist of the skills worth loading. The agent picks the two or three that fit and loads them before it touches any code.

You don't change how you work. The right specialist knowledge just shows up at the start of the turn instead of getting missed. Here is what the agent sees when you type *"audit the upload endpoint for security, then write tests for it"*:

```text
[skill-router] 2 candidate skills below. Pick the 2-3 most on-target and invoke them first.
  - /security-review        ("security audit", score 6.0)
  - /testing-verification   ("write tests", score 6.0)
```

<br>

---

<br>

## Why It Works This Way

The interesting design choice is that it does **not** try to pick the one correct skill for you.

Keyword matching is good at one thing and bad at another. It is good at taking a hundred skills and narrowing them to the five that are plausibly relevant. It is bad at choosing the single best of those five, because the right choice depends on context a keyword count can't see: what file you're in, what the conversation has been about, what the architecture actually is.

So skill-router splits the work along that line. The hook does the part keywords are good at (narrow it down). The agent does the part it is good at (the final call, with everything it can see). The hook casts a wide net on purpose and lets the model judge. In practice this misses far fewer skills than a system that guesses a single winner, and it doesn't get brittle.

The second design choice: **it's measured, not vibes.** The scoring logic is a plain module with no side effects, so a test harness runs the real code against a list of example prompts and reports how often it surfaced the right skill. Tune the matcher, get a number back, not a hunch. On the six example skills shipped here it surfaces the right skill in the top 3 on 100% of the test prompts and never surfaces a forbidden one.

<br>

---

<br>

## What You Get

Eight small hooks, grouped into three jobs:

**1. The router.** The main event. Scores your skills on every prompt and injects the shortlist. Everything above.

**2. The file dispatcher.** When you open or edit a file, it can remind the agent to load a specific skill and read a specific conventions file for that kind of file. Edit anything under `migrations/`, get reminded about your database skill. You set these rules in config. Optional.

**3. An operating-discipline and safety layer.** A few hooks that keep the agent honest: run a real loop instead of one-shotting, verify before claiming something is done, and refuse a small set of genuinely dangerous git commands (like `git commit --no-verify`) unless you turn them off. Generic, runs everywhere, every piece switchable in config.

Use just the router and ignore the rest, or run the whole thing. It's one install.

<br>

---

<br>

## Quick Start

You need [Node](https://nodejs.org) 18 or newer. That is the only requirement. There is nothing to `npm install`.

### Option A: clone it and wire it in

```text
git clone https://github.com/rare-lab-core/skill-router
cd skill-router
node scripts/install.mjs --write
```

That last command registers the hooks in your `~/.claude/settings.json`, pointing them at the copy you just cloned. It backs up your existing settings first, leaves your other hooks and permissions alone, and is safe to run again (no duplicates).

Want to see exactly what it adds before it touches anything? Run it without `--write` and it prints the block for you to read or paste by hand:

```text
node scripts/install.mjs
```

Restart Claude Code so it picks up the hooks. Done.

> **Handing it to your agent.** Most people will just clone this and tell their Claude Code agent to set it up. A prompt like *"clone https://github.com/rare-lab-core/skill-router and run its installer"* is enough. The agent runs the clone and the install command itself.

### Option B: install it as a Claude Code plugin

This repo is also its own single-plugin marketplace:

```text
/plugin marketplace add rare-lab-core/skill-router
/plugin install skill-router@skill-router
```

Or from a local clone:

```text
git clone https://github.com/rare-lab-core/skill-router
/plugin marketplace add ./skill-router
/plugin install skill-router@skill-router
```

The plugin wires the hooks up for you, no settings editing.

### How to tell it's working

After install and restart, send any normal prompt in a project that has a `.claude/skills/` folder, and look at the context the agent receives. If it's working, you'll see lines starting with `[skill-router]` listing the candidates it found. No skills with keywords yet means nothing to suggest, which is expected. The next section fixes that.

<br>

---

<br>

## Make Your Skills Routable

Out of the box, skill-router can only suggest skills that tell it what they're about. You do that by adding a short `promptSignals` block to a skill's `SKILL.md` frontmatter:

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
    noneOf:
      - "design tokens"
  pathPatterns:
    - "auth/.*"
---
```

In plain terms:

- **`phrases`** are the words that mean "this is my territory." When one shows up in a prompt, the skill scores. This is the main thing you fill in.
- **`minScore`** is the bar to count as a confident match. Leave it at 6 unless the phrases are common words, in which case raise it.
- **`noneOf`** is a kill switch. If any of these appear, the skill is dropped no matter what. Keeps it from firing on the wrong topic.
- **`pathPatterns`** boost the skill when you have a matching file uncommitted, a strong sign you're working in that area now.

A skill with no `promptSignals` still works as a manual skill, it just won't auto-route. Its description still counts for a little, so relevant skills aren't invisible.

Full field list and exact scoring rules: [docs/SPEC.md](docs/SPEC.md). Real working examples to copy: [examples/skills/](examples/skills/).

<br>

---

<br>

## Tune It (optional config)

With no config at all, skill-router activates in any project with a `.claude/skills/` folder and behaves sensibly. To change anything, drop a `skill-router.config.json` in your project root. You write only the parts you want to change; the rest uses defaults.

```json
{
  "project": { "match": ["my-app"] },
  "intentAffinity": { "testing-verification": ["TEST", "DEBUG"] },
  "fileSkillMap": [
    { "pattern": "(^|/)migrations?/", "skills": ["/database-optimization"], "rules": ["db.md"] }
  ],
  "safety": { "blockNoVerify": false }
}
```

This says: only run where the path contains "my-app", nudge the testing skill on test-and-debug prompts, remind the agent about the database skill on migration edits, and turn off the `--no-verify` block. Every option: [docs/CONFIG.md](docs/CONFIG.md). Complete example: [examples/skill-router.config.json](examples/skill-router.config.json).

<br>

---

<br>

## What's In The Repo

The whole thing, file by file.

```text
skill-router/
├── hooks/                          the hooks themselves (the product)
│   ├── lib/
│   │   ├── skill-scoring.mjs        the scoring engine: parse, score, rank (no I/O, ~450 lines)
│   │   └── config.mjs               finds and loads your skill-router.config.json over defaults
│   ├── prompt-intelligence.mjs      THE ROUTER. runs on every prompt, injects the shortlist
│   ├── file-dispatch.mjs            on edit, suggests a skill + rules file for that path
│   ├── agents-md-bridge.mjs         injects "learned preferences" sections from your AGENTS.md
│   ├── agentic-brain.mjs            injects senior operating discipline, scaled to the prompt
│   ├── agentic-brain-bootstrap.mjs  runs once per session, sets up the operating brain
│   ├── agentic-brain-tooluse.mjs    safety gate: blocks dangerous git, confirms destructive ops
│   ├── agentic-brain-toolresult.mjs after a tool runs, reminds the agent a green build != done
│   ├── agentic-brain-stop.mjs       one self-review pass before the agent ends a turn
│   └── hooks.json                   tells the plugin system which hook runs on which event
│
├── bin/
│   ├── probe.mjs                    check what the router would suggest for one prompt
│   └── eval.mjs                     run the test battery, get recall/precision numbers
│
├── scripts/
│   └── install.mjs                  the clone-and-wire installer (Option A)
│
├── examples/
│   ├── skills/                      six real example skills with promptSignals, copy these
│   ├── battery.json                 the test prompts eval.mjs runs against
│   └── skill-router.config.json     a worked config example
│
├── docs/
│   ├── SPEC.md                      the promptSignals contract: every field, the scoring rules
│   ├── CONFIG.md                    every config option
│   └── ARCHITECTURE.md              how and why it's built this way, in depth
│
├── .claude-plugin/
│   ├── plugin.json                  plugin manifest (Option B)
│   └── marketplace.json             makes this repo its own single-plugin marketplace
│
├── .github/workflows/eval.yml       runs the test battery in CI on every push
├── package.json                     scripts: probe, eval, install-hooks. zero dependencies
├── LICENSE                          MIT
└── README.md                        this file
```

The two files that matter most if you want to understand it: `hooks/lib/skill-scoring.mjs` is the entire brain (all the scoring logic, with comments), and `hooks/prompt-intelligence.mjs` is the thin wrapper that reads your prompt, calls the brain, and writes the result. The other six hooks are independent and small.

<br>

---

<br>

## How A Hook Runs

Worth knowing, because it's why this can't break your setup. Claude Code calls a hook by running a command and passing it JSON on standard input (your prompt, the tool about to run, the working directory). The hook prints a JSON object back on standard output, and Claude Code uses it: add context, allow or deny a tool, whatever the hook decided.

Every hook here **fails open.** If anything goes wrong, a bad parse, a missing file, an unexpected shape, it prints an empty object and gets out of the way. A bug in a hook can make it do nothing. It can never jam your toolchain or block your work. That is deliberate.

Session state (which skills it suggested recently, a per-session work flag) is written under `~/.claude/skill-router/`, never into your repo or the project you're working on.

<br>

---

<br>

## How Scoring Works (briefly)

For the curious. Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The scorer separates evidence into strong and weak. A **strong** signal is the skill author's own keyword: a declared phrase, or a path pattern matching a file you have open right now. A **weak** signal is circumstantial: a description word that happens to match, a verb-class guess, a skill suggested last turn. Weak signals can nudge the ranking, but they can never push a skill onto the list by themselves. A skill needs a real, strong signal to surface. That single rule is most of what keeps it from suggesting junk.

On top of that, hard gates (`noneOf`, `anyOf`, `allOf`) drop a skill regardless of score, and matching is inflection-aware in a controlled way, so `deploy` matches `deploying` and `republish` matches `republishing`, but `import` never accidentally matches `important`.

<br>

---

<br>

## Prove It Works

Two commands. The probe shows the router's decision on a single prompt:

```text
node bin/probe.mjs "wrap this in usememo to fix the stale closure"
```

The battery runs a list of prompts and reports how often the right skill showed up:

```text
node bin/eval.mjs
```

This is what makes it trustworthy. Change the scoring and a number drops, you see it immediately, instead of finding out weeks later that routing quietly got worse. The same battery runs in CI on every push.

<br>

---

<br>

## What It Doesn't Do

Being straight about the limits:

- **It does not call any API or send your code anywhere.** It runs locally, reads files, prints text. That's it.
- **It does not write code or make decisions for you.** It surfaces skills and a few reminders. The agent does the work.
- **It can only suggest skills you actually have.** Empty `.claude/skills/` means nothing to route. It's a router, not a content pack.
- **Keyword scoring is keyword scoring.** It's good at recall and leaves the final pick to the model on purpose. If you wanted a perfect one-shot classifier, that is not the design, and the "Why It Works This Way" section explains why.

<br>

---

<br>

## License

MIT. Use it, fork it, ship it. See [LICENSE](LICENSE).

<div align="center">

**Built by Captain Red.**

</div>
