# skill-router

Make Claude Code reach for the right skill on its own, before it starts working.

This is a small set of hooks for [Claude Code](https://docs.claude.com/en/docs/claude-code). You install it once. After that, every time you type a prompt, it looks at the skills you have, figures out which ones are relevant, and tells the agent to load them first. No dependencies, nothing to build, runs entirely on your machine.

---

## The problem this fixes

Claude Code has skills. A skill is just a folder with a `SKILL.md` file full of instructions and knowledge the agent can pull in when it's working on something related. You can write one for your database conventions, one for your auth flow, one for how your team does code review, whatever you want.

The catch is the word "relevant." The agent decides on its own whether a skill is worth loading, based on a short description. That decision is hit or miss. You can write a genuinely good database skill, and then watch the agent debug a slow query from scratch and never open it, because nothing pointed it there at the right moment. The knowledge was sitting right there. It just didn't get used.

That is the gap. You did the work of writing the skill, but the skill only helps if it actually gets loaded on the prompts where it matters. skill-router closes that gap.

## What it does, in one paragraph

Every time you send a prompt, a hook runs. It reads the keywords you declared on each of your skills, scores them against what you actually asked for, and hands the agent a short, ranked shortlist of the skills worth loading for this task. The agent then picks the two or three that fit and loads them before it touches any code. You don't change how you work. The right specialist knowledge just shows up at the start of the turn instead of getting missed.

Here is what that looks like in practice. You type this:

```text
"audit the upload endpoint for security, then write tests for it"
```

The hook scores your skills and quietly adds this to the agent's context:

```text
[skill-router] 2 candidate skills below. Pick the 2-3 most on-target and invoke them first.
  - /security-review        ("security audit", score 6.0)
  - /testing-verification   ("write tests", score 6.0)
```

The agent reads that, loads those two skills, and now it's working with your security checklist and your testing conventions in hand instead of guessing. That's the whole idea.

## Why it works the way it does

The interesting design choice is that it does **not** try to pick the one correct skill for you.

Keyword matching is good at one thing and bad at another. It's good at taking a hundred skills and narrowing them to the five that are plausibly relevant. It's bad at choosing the single best one of those five, because the right choice depends on context a keyword count can't see: what file you're in, what the conversation has been about, what the actual architecture is.

So skill-router splits the work along that line. The hook does the part keywords are good at (narrow it down) and the agent does the part it's good at (make the final call, using everything it can see). The hook casts a wide net on purpose and lets the model be the judge. In practice this misses far fewer skills than a system that tries to guess the single winner, and it doesn't get brittle.

The second design choice: it's measured, not vibes. The scoring logic is a plain, isolated module with no side effects, which means there's a test harness that runs the real scoring code against a list of example prompts and reports how often it surfaced the right skill. So when you tune the matcher, you get a number back, not a hunch. (On the six example skills shipped here, it surfaces the right skill in the top 3 on 100% of the test prompts, and never surfaces a forbidden one.)

## What you get (three parts)

It's eight small hooks, but they group into three jobs:

1. **The router.** The main event. Scores your skills on every prompt and injects the shortlist. This is the part described above.

2. **The file dispatcher.** When you open or edit a file, it can remind the agent to load a specific skill and read a specific conventions file for that kind of file. For example: editing anything under `migrations/` reminds it to load your database skill. You set these rules in a config file. Optional.

3. **An operating-discipline and safety layer.** A few hooks that keep the agent honest: run a real loop instead of one-shotting, verify before claiming something is done, and refuse a small set of genuinely dangerous git commands (like `git commit --no-verify`) unless you turn those off. This part is generic and runs everywhere. Every piece of it can be switched off in config if you don't want it.

You can use just the router and ignore the rest, or run the whole thing. It's all in one install.

---

## Quick start

You need [Node](https://nodejs.org) 18 or newer. That's the only requirement. There is nothing to `npm install`.

There are two ways to install it. The first is the simple one most people will want.

### Option A: clone it and wire it in

```text
git clone https://github.com/rare-lab-core/skill-router
cd skill-router
node scripts/install.mjs --write
```

That last command edits your `~/.claude/settings.json` to register the hooks, pointing them at the copy you just cloned. It backs up your existing settings first, it leaves your other hooks and permissions alone, and you can run it again any time without creating duplicates.

If you'd rather see exactly what it's going to add before it touches anything, run it without `--write`:

```text
node scripts/install.mjs
```

That prints the exact block it would add. You can read it, and either let the script write it or paste it into any `settings.json` yourself.

Then restart Claude Code so it picks up the new hooks. Done.

**Handing it to your agent.** Most people will just clone this and tell their Claude Code agent to set it up. That works. A prompt like *"clone https://github.com/rare-lab-core/skill-router and run its installer"* is enough. The agent can run the clone and the install command itself.

### Option B: install it as a Claude Code plugin

This repo is also a self-contained Claude Code plugin, so if you prefer the plugin system:

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

The plugin wires the hooks up for you, no settings editing needed.

### How to tell it's working

After you install and restart, send any normal prompt in a project that has a `.claude/skills/` folder. Look at the context the agent receives. If it's working, you'll see lines starting with `[skill-router]`, listing the candidate skills it found. If your project has no skills with keywords declared yet, it won't find anything to suggest, which is expected. See the next section to fix that.

---

## Making your skills routable

Out of the box, skill-router can only suggest skills that tell it what they're about. You do that by adding a short `promptSignals` block to a skill's `SKILL.md` frontmatter. Here's a real one:

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

- **`phrases`** are the words and short phrases that mean "this is my territory." When one shows up in a prompt, this skill scores points. This is the main thing you fill in.
- **`minScore`** is the bar the skill has to clear to count as a confident match. Leave it at the default (6) unless the skill's phrases are common words, in which case raise it.
- **`noneOf`** is a kill switch. If any of these words appear, the skill is dropped no matter what. Use it to keep a skill from firing on the wrong topic.
- **`pathPatterns`** give the skill a boost when you have an uncommitted file matching that pattern, which is a strong sign you're working in that area right now.

A skill with no `promptSignals` still works fine as a manual skill, it just won't auto-route. Its description still counts for a little, so relevant skills aren't completely invisible.

The full set of fields and the exact scoring rules are in [docs/SPEC.md](docs/SPEC.md). The shipped example skills under [examples/skills/](examples/skills/) are all real, working examples you can copy.

## Tuning it (optional config)

With no config at all, skill-router activates in any project that has a `.claude/skills/` folder and behaves sensibly. To change anything, drop a `skill-router.config.json` in your project root. You only write the parts you want to change; everything else uses defaults.

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

This says: only run in a project whose path contains "my-app", give the testing skill a nudge on test-and-debug prompts, remind the agent about the database skill whenever it edits a migration, and turn off the `--no-verify` block. Every option is documented in [docs/CONFIG.md](docs/CONFIG.md), with a complete example in [examples/skill-router.config.json](examples/skill-router.config.json).

---

## What's in the repo

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
│   └── install.mjs                  the clone-and-wire installer (Option A above)
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

The two files that matter most if you want to understand it: `hooks/lib/skill-scoring.mjs` is the entire brain (scoring logic, all of it, with comments), and `hooks/prompt-intelligence.mjs` is the thin wrapper that reads your prompt, calls the brain, and writes the result. The other six hooks are independent and small.

## How a hook actually runs

Worth knowing, because it explains why this can't break your setup. Claude Code calls a hook by running a command and passing it a blob of JSON on standard input (your prompt, the tool about to run, the working directory). The hook prints a JSON object back on standard output, and Claude Code uses it: to add context, to allow or deny a tool, whatever the hook decided.

Every hook here is built to fail open. If anything goes wrong, a bad parse, a missing file, an unexpected shape, it prints an empty object and gets out of the way. A bug in a hook can make it do nothing. It can never jam your toolchain or block your work. That's a deliberate property, not an accident.

Session state (which skills it suggested recently, a per-session work flag) is written under `~/.claude/skill-router/`, never into your repo or the project you're working on.

## How the scoring works, briefly

For the curious. Full detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The scorer separates evidence into strong and weak. A **strong** signal is the skill author's own keyword (a declared phrase, or a path pattern matching a file you have open right now). A **weak** signal is circumstantial: a word in the skill's description happening to match, a verb-class guess (build, debug, review, and so on), a skill that was suggested last turn. Weak signals can nudge the ranking, but they can never push a skill onto the list by themselves. A skill needs a real, strong signal to surface. That single rule is most of what keeps it from suggesting junk.

On top of that there are hard gates (`noneOf`, `anyOf`, `allOf`) that drop a skill regardless of score, and the matching is inflection-aware in a controlled way, so `deploy` matches `deploying` and `republish` matches `republishing`, but `import` never accidentally matches `important`.

## Proving it works

Two commands. The probe shows you the router's decision on a single prompt:

```text
node bin/probe.mjs "wrap this in usememo to fix the stale closure"
```

The battery runs a list of prompts and reports how often the right skill showed up:

```text
node bin/eval.mjs
```

This is the part that makes the thing trustworthy. If you change the scoring and a number drops, you see it immediately, instead of finding out three weeks later that routing quietly got worse. The same battery runs in CI on every push.

## What it doesn't do

Being straight about the limits:

- **It does not call any API or send your code anywhere.** It runs locally, reads files, prints text. That's it.
- **It does not write code or make decisions for you.** It surfaces skills and a few reminders. The agent does the work.
- **It can only suggest skills you actually have.** If your `.claude/skills/` is empty, it has nothing to route. It's a router, not a content pack.
- **The keyword scoring is keyword scoring.** It's good at recall and deliberately leaves the final pick to the model. If you expected a perfect one-shot classifier, that's not the design, and the "Why it works the way it does" section explains why that's on purpose.

## License

MIT. Use it, fork it, ship it. See [LICENSE](LICENSE).

Built by Captain Red.
