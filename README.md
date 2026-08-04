# Guardian CLI

**Deterministic scans + your coding agent's own reasoning, in one autonomous quality loop.**

`guardian-cli` gives any AI coding tool a `/guardian` slash-command that scans your repo,
shows you a boxed summary of the root causes it found, waits for your **one-time
confirmation**, then lets your agent autonomously fix, verify, re-scan, and repeat until
nothing is left to fix.

[![CI](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

---

## Watch it run

> **Placeholder — replace with your real GIF or asciinema embed.**
> Record the exact flow below (clone → install → `/guardian` → box appears → hit enter → watch it loop):

```asciinema
$ git clone https://github.com/Krish-1507/Guardian.git
$ cd Guardian
$ npm install
$ node dist/cli.js demo          # or: npx guardian-cli demo — spins up the broken demo repo
$ npx guardian-cli install        # drops the /guardian command into your tool
$ <open the repo in Claude Code / Cursor / OpenCode / Kilo Code / Codex>
$ /guardian                      # a boxed scan summary appears...
<Enter>                           # ...you confirm once...
$ <watch the autonomous loop: fix → verify → re-scan → repeat>
```

Asciinema embed (replace `XXXX` with your cast id):

[![asciicast](https://asciinema.org/a/XXXX.svg)](https://asciinema.org/a/XXXX)

---

## What Guardian is (and isn't)

Guardian is **two pieces glued together**:

1. **A deterministic scan/verify engine** (`guardian-cli`). It reads your code and runs
   real tools to produce numbers, not opinions:
   - **Dependency graph** — circular imports, most-depended-on hubs, orphan files
   - **Security** — `npm audit` / `pip-audit`, `gitleaks` (secrets), `semgrep` (code)
   - **Duplication** — `jscpd` (copy-paste clones)
   - **Tests** — `jest`, `vitest`, or `pytest` (pass/fail, duration, coverage)
   - **Performance** — build time + bundle size
   - **Root-cause correlation** — clusters symptoms that share the same files into one root cause

   It also **records** every scan, verify, and fix in memory so the loop gets smarter over
   time and produces a `GUARDIAN_REPORT.md` at the end.

2. **Your existing coding agent's own reasoning.** Guardian never edits your code itself.
   The `/guardian` slash-command is a prompt template that drives *your* agent — Claude
   Code, Cursor, OpenCode, Kilo Code, or Codex — through a disciplined loop: state a
   hypothesis, make the smallest fix, run `verify`, and re-scan. The agent does the editing;
   Guardian does the measuring.

That division is the whole point: the engine guarantees the scan/verify numbers are
deterministic and honest, while the agent's judgment decides what to change and how.

---

## The model: scan → confirm → autonomous loop → re-check

```
 ┌────────────────┐   ┌──────────────────┐   ┌──────────────────────────┐   ┌────────────┐
 │ 1. SCAN        │   │ 2. CONFIRM       │   │ 3. AUTONOMOUS LOOP       │   │ 4. RE-CHECK│
 │ deterministic  │──▶│ one-time pause   │──▶│ fix → verify → commit    │──▶│ fresh scan │
 │ analysis,      │   │ the agent waits  │   │ → re-scan, per cluster   │   │ stop when  │
 │ boxed summary, │   │ for your enter   │   │ (max 2 attempts/cluster) │   │ 0 clusters │
 │ root causes    │   │ (never skipped)  │   └──────────────┬───────────┘   └──────┬─────┘
 └────────────────┘   └──────────────────┘                  │                     │
                                                           └─────────▶ repeat ◀───┘
                                                                 (or hard stop)
```

1. **Scan.** `guardian scan` runs every analyzer, correlates findings into root-cause
   clusters, and prints a boxed summary — circular deps, security issues, clones, test
   health, perf, and the clusters themselves. Every run is saved to `.guardian/`.

2. **Confirm.** The agent prints `Found [N] root-cause clusters covering [M] issues. Reply
   with anything (or just hit enter) to start...` and **stops**. This is the single,
   non-negotiable pause. Nothing is edited until you approve.

3. **Autonomous loop.** On confirmation, for each cluster the agent: picks the highest-value
   one, branches to `guardian/<slug>-<date>`, states its hypothesis, makes the **smallest**
   fix, runs `guardian verify` (re-runs tests/perf and diffs against the baseline to compute
   a **Regression Risk**), and commits + records a memory entry if risk is Low/Medium. High
   risk means revert and retry once, then move on.

4. **Re-check.** After every fix the agent re-scans and prints a short updated box. When a
   fresh scan shows **zero actionable clusters** it stops with `nothing left to fix, nothing
   broken.` Hard stops: 10 fix iterations or 45 minutes. On any stop it runs `guardian
   report`, which writes `GUARDIAN_REPORT.md`.

---

## Quick start

```bash
# 1. In the repo you want guarded
cd your-repo

# 2. Install the /guardian slash-command into your coding tool(s)
npx guardian-cli install

# 3. Open the repo in your tool and type:
/guardian
```

Then: read the box, hit **enter**, watch it loop.

### Try it without a real project

```bash
npx guardian-cli demo
```

This copies the intentionally-broken `demo-repo` into a fresh temp directory, installs the
slash-command there, and prints where to open it. The demo is seeded with a circular
dependency, a hardcoded secret, a known-CVE dependency, duplicated code, and failing tests —
so you can watch the whole loop from a real `scan` down to a real `report`.

---

## Installation paths

`npx guardian-cli install` writes `guardian.prompt.md` (from `templates/`) to the following
locations. Run it inside your repo for the **project** rows; the **user** rows apply to every
repo on your machine.

| Tool | Level | Path |
|------|-------|------|
| Claude Code | project | `.claude/commands/guardian.md` |
| Claude Code Skill | project | `.claude/skills/guardian/SKILL.md` |
| Claude Code | user | `~/.claude/commands/guardian.md` |
| Cursor | project | `.cursor/commands/guardian.md` |
| Cursor | user | `~/.cursor/commands/guardian.md` |
| OpenCode | project | `.opencode/commands/guardian.md` |
| OpenCode (legacy) | project | `.opencode/command/guardian.md` |
| OpenCode | user | `~/.opencode/commands/guardian.md` |
| Kilo Code | project | `.kilocode/workflows/guardian.md` |
| Kilo (legacy) | project | `.kilo/commands/guardian.md` |
| Kilo Code | user | `~/.kilocode/workflows/guardian.md` |
| Codex | user | `~/.codex/prompts/guardian.md` *(Codex supports prompts at user level only)* |

Existing files are never overwritten by default — pass `--force` to replace them, or
`--uninstall` to remove them:

```bash
npx guardian-cli install --force
npx guardian-cli install --uninstall
```

---

## Commands

| Command | What it does |
|---------|--------------|
| `guardian scan [repo]` | Run all analyzers, correlate root causes, print the boxed summary. |
| `guardian verify [repo]` | Re-run tests/perf, diff against the last baseline, print Regression Risk (exit code 1 on High). |
| `guardian memory add "..." --type <fix\|decision\|rejection>` | Record a lesson for future scans to recall. |
| `guardian report [repo]` | Aggregate scan/verify history into `GUARDIAN_REPORT.md` + a boxed terminal summary. |
| `guardian demo` | Copy the broken demo repo to a temp dir and install the slash-command there. |
| `guardian install [--force\|--uninstall]` | Install/remove the `/guardian` slash-command into your tools. |

### What the engine detects

- **Dependency graph** — circular imports, dependency hubs, orphan files (included when
  `node_modules` is present).
- **Security** — `npm audit` / `pip-audit` vulnerabilities, `gitleaks` secrets, `semgrep`
  code findings (each tool is used only if installed).
- **Duplication** — `jscpd` clone detection (only if installed).
- **Tests** — `jest`, `vitest`, or `pytest`: total/passed/failed, duration, coverage.
- **Performance** — build time and bundle size when the repo has a `build` script.

---

## Safety

The loop runs under hard safety rules baked into the prompt template:

- Never force-push; never touch `.git/`, `.env`, or secret files.
- Never delete a file unless the dependency graph shows zero incoming references.
- Never silently modify CI/deploy config — flagged to you instead.
- All work happens on a `guardian/*` branch; `main` stays untouched.

---

## Development

```bash
npm install
npm run build      # tsc → dist/
npm run dev        # tsx watch src/cli.ts
```

TypeScript, ESM, zero test framework dependency in the CLI itself. The packaged tarball
ships `dist/`, `templates/`, and `demo-repo/` — see the CI badge above for build + smoke
test status.

## License

[MIT](LICENSE)
