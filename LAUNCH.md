# Show HN: Guardian — a `/guardian` slash-command that turns your coding agent into an autonomous fixer

> The first thing you see is the box. That box is the whole product thesis.

```
╔══════════════════  GUARDIAN — Repository Scan Complete  ══════════════════╗
║   Dependency Graph : 2 circular — src/userService.js → src/userRepo.js →  ║
║   src/userService.js                                                      ║
║   Security         : 1 issues — high dependency: lodash: Command Injection ║
║   Root Causes      : 1 root cause(s) → 2 symptom(s)                       ║
║   1. MEDIUM circular: circular dependency: src/userService.js → ...       ║
║   Tests            : 2 failed / 2 — 5832ms, 38.46% cov                    ║
║   Awaiting confirmation to begin autonomous fixing.                       ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

## The one-liner

Guardian is two pieces glued together: a **deterministic CLI** that scans your repo and
produces numbers, and **your existing coding agent's reasoning** — the CLI does the
measuring, your agent does the editing, and a prompt template makes them loop until the repo
is actually clean.

## Why this exists

Your agent is great at fixing code. It's terrible at *knowing when to stop* — it fixes the
one thing it noticed and declares victory. Guardian gives it an honest feedback loop:

1. **Scan** → `cli-guardian` runs real tools (`npm audit`, `jest`, a dependency-graph pass,
   a structural duplicate-function detector) and prints a **boxed root-cause summary** —
   circular deps, security issues, broken tests, copy-paste, flaky tests, unused exports.
2. **Confirm** → the agent prints *"Found N root-cause clusters covering M issues. Reply
   with anything to start."* and **stops**. One pause, never skipped. Nothing is edited until
   you approve.
3. **Loop** → the agent branches to `guardian/*`, states a hypothesis, makes the *smallest*
   fix, runs `guardian verify` (re-runs tests and diffs against the baseline → **Regression
   Risk**, gated by the **integrity gate** that scans the diff for AI-agent-cheat patterns),
   commits, and re-scans.
4. **Stop** → a fresh scan showing **zero actionable clusters** ends it:
   `nothing left to fix, nothing broken.` Then `guardian report` writes `GUARDIAN_REPORT.md`.

## What's honest about it

- **It never edits your code itself.** The CLI is deterministic and safe; the agent does the
  reasoning. No mystery black box.
- **Skips are visible.** No jscpd installed? It says `skipped — jscpd not found`. No HTML in
  the repo? It says so. You always know what was and wasn't checked.
- **Heuristics are labeled.** Race-condition smells and duplicate-function detection are
  structural guesses and are marked as such — never presented as certainty.
- **The agent can't cheat its own referee.** Every `verify` also diffs the change against HEAD
  and flags deleted/loosened tests, swallowed errors, suppression comments, hardcoded-to-pass
  values, and forced exits. SUSPICIOUS reverts and retries the same cluster once with a stricter
  "solve the root cause" instruction; CONFIRMED_CHEAT goes straight to a human.
- **Hard safety rules** are baked into the prompt: no force-pushes, no `.env`, no deleting
  files with incoming references, everything on a `guardian/*` branch.
- **Memory.** Every fix it makes is recorded and recalled on later scans, so the loop gets
  smarter on your actual codebase over time.

## Try it in under 2 minutes — no messy codebase needed

Don't want to point it at your own repo yet? The repo ships an intentionally-broken demo
project seeded with a circular dependency, a hardcoded secret, a known-CVE dependency,
duplicated code, and failing tests.

```bash
npx cli-guardian demo
```

That copies the demo into a temp dir, wires up `/guardian`, and prints where to open it.
Open it in Claude Code / Cursor / OpenCode / Kilo Code / Codex, type `/guardian`, hit enter,
and watch the whole loop: scan box → confirm → fix → verify → re-scan → report.

The demo source is at [`demo-repo/`](demo-repo/) if you want to read exactly what it plants
in the code before you watch it get fixed.

## What it won't do (yet)

- It won't fix things the scanners can't see — if a tool isn't installed, that dimension is
  honestly skipped.
- It won't reformat your entire codebase; it fixes *root causes the scan actually finds*.
- It's deliberately conservative: one cluster at a time, max 2 attempts per cluster, 10
  iterations max, then it stops and tells you what's left.

## Show, don't tell

- **Demo (2 min):** the box above is real output — or run `npx cli-guardian demo` locally.
- **Report sample:** a full `GUARDIAN_REPORT.md` is generated after every loop.
- **CI:** guardian runs in CI too — `guardian ci` diffs a PR against its base branch and
  posts one comment (`build-and-smoke` status in the badge below).

[![CI](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml)

## Built for the boring, important stuff

The pitch isn't "AI writes your code." It's: **the agent finally has a referee.** A loop
that measures, a loop that knows when it's done, and a report that says what actually
changed. Clone it, run the demo, and break it on your messiest repo — that's the review
feedback that matters.

---

*Guardian is MIT licensed. Found it useful, or found a way it breaks? Open an issue, or come
extend it — `CONTRIBUTING.md` walks through adding a whole new analyzer in ~10 minutes.*
