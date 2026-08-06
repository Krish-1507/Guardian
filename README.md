# Guardian CLI

**Deterministic scans + your coding agent's own reasoning, in one autonomous quality loop. Adds a `/guardian` slash-command to any AI coding tool.**

[![npm version](https://img.shields.io/npm/v/cli-guardian)](https://www.npmjs.com/package/cli-guardian)
[![CI](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Install

One command, that's it:

```bash
npx cli-guardian@latest install
```

Run it from inside any project directory. It writes `/guardian` into every supported tool
below — project-level for the current repo, user-level so it works in any repo on your
machine. Re-run with `-y` to refresh after updates (idempotent).

Requires Node.js 22+ (npm will warn on older versions).

## Usage

Open your repo in any supported tool and type:

```
/guardian
```

Bare `/guardian` prints this menu and waits:

```
Guardian modes:
 (enter) — full autonomous loop (scan, confirm, fix, verify, repeat)
 --scan-only — scan and report, no fixes
 --demo — run against Guardian's own seeded demo repo
 --ledger — payment idempotency fuzzing only
 --integrity-only — re-check the last commit for cheat patterns, no scanning
Reply with a mode, or just hit enter for the default full loop.
```

Hit enter for the default loop, or jump straight into a mode:

| Invocation | Mode | What it does |
|---|---|---|
| `/guardian` (bare) | menu | Prints the mode menu above and **waits**. Reply with a mode, or hit enter for the default full loop. |
| `/guardian --scan-only` | scan-only | Runs `cli-guardian scan`, prints the entire boxed report verbatim, and stops — no fixes, no commentary. |
| `/guardian --demo` | demo | Scaffolds Guardian's seeded broken demo repo into a temp dir, then runs the default full loop there. |
| `/guardian --ledger` | ledger | Runs `cli-guardian scan --ledger` (boots the app with every outbound HTTP call intercepted and replays duplicate-webhook / double-submit / retry traffic), then runs the loop restricted to the payment findings. |
| `/guardian --integrity-only` | integrity-only | Runs `cli-guardian integrity`, prints the boxed verdict verbatim, and stops — no scanning, no fixes. |

A flag after `/guardian` skips the menu and goes straight into that mode. If a tool ever
fails to substitute arguments into the prompt, Guardian falls back to the menu rather than
guessing.

No repo handy? `npx cli-guardian@latest demo` scaffolds a broken demo repo in a temp dir so
you can watch the whole loop — self-contained, no installs on the hot path, and it never
writes into your tool configs (that stays an explicit `guardian install`).

## Tool support

| Tool | Installed to | Status |
|------|--------------|--------|
| Claude Code | `.claude/commands/guardian.md` (project + user), plus a Skill at `.claude/skills/guardian/SKILL.md` | Full support |
| Cursor | `.cursor/commands/guardian.md` (project + user) | Full support |
| OpenCode | `.opencode/commands/guardian.md` (project), `~/.config/opencode/commands/` (user) | Full support |
| Kilo Code | `.kilo/commands/guardian.md` (project), `~/.config/kilo/commands/` (user) | Full support |
| Antigravity | `.agent/workflows/guardian.md` (project + user) | Full support |
| Gemini CLI | `.gemini/commands/guardian.toml` (project + user) | Full support |
| Codex CLI | `~/.codex/prompts/guardian.md` | Full support |
| Codex App / VS Code extension | — (no file written) | **Not supported** — OpenAI hasn't shipped custom slash commands there; install prints a manual-copy note instead |

Legacy/alternate locations are also written where tool docs are inconsistent across versions
(see `src/installer/targets.ts`). Existing files are never overwritten unless you pass
`-y`/`--force`; `npx cli-guardian install --uninstall` removes everything.

## What Guardian actually does

### The scan

`guardian scan` runs deterministic analyzers: dependency graph (circular imports), security
(`npm audit`, plus `gitleaks` and `semgrep` when installed), duplication (`jscpd`), tests
(jest/vitest/pytest — pass/fail, duration, coverage), build performance, accessibility,
reliability (flaky tests, race-condition heuristics), and DevEx (unused exports, duplicate
functions). A category whose underlying tool isn't installed prints `skipped` with the
one-line install hint next to it, instead of a made-up number. The box always opens with the
**Guardian Score**: a single 0–100 health number (with an A–F grade) computed across the
categories that actually ran.

Scans are fast by design: the subprocess-bound analyzers run **in parallel**, flaky detection
runs the suite **twice** by default (`--reliability-runs <n>` to tune; `1` disables it), and
`npm audit` results are cached (24h, keyed on the lockfile hash) so repeated scans inside one
fix loop never re-hit the registry.

### Bonus commands

| Command | What it does |
|---|---|
| `guardian inspect <finding-id>` | Deep-dive on one finding: code snippet, root-cause cluster context, whether a permanent repro test exists, and Guardian's memory of the files. `npx cli-guardian report --html` also embeds the score. |
| `guardian trends` | Turns the `.guardian/scan-*.json` history into per-category sparklines plus a score trend — watch the loop actually improve a repo. |
| `guardian report --html` | Writes a single self-contained `GUARDIAN_REPORT.html` (inline SVG trend charts, integrity-gate timeline, zero external assets — send it to a stakeholder and it just works). Every `guardian report` also writes `GUARDIAN_BADGE.svg`, a README-ready shield: `![Guardian score](GUARDIAN_BADGE.svg)`. |
| `guardian doctor` | Explains why categories are `skipped`: checks the toolchain (Node, git, jscpd, gitleaks, semgrep, pa11y) and prints copy-paste install hints. |
| `guardian prompt [--args …]` | Prints the exact `/guardian` prompt your AI tool expands to, with your arguments substituted — full transparency into what the agent was told. |
| `guardian try [path]` | Zero-setup 2-second Guardian Score on **any existing repo** — no install, no tool config; static pass only, and it saves a sealed baseline so scan/verify/gate build on it. |
| `guardian gate [--score 60]` | Agentless commit gate for CI/pre-commit: score threshold + regression risk + integrity diff + evidence signature. Exit 0 = PASS, 1 = FAIL, 2 = CONFIRMED_CHEAT. |
| `guardian ci [path]` | CI-mode scan: runs scan + verify against the base branch and prints a PR-ready markdown report — the gate as a PR comment. Diagnostic only; fixes stay local via `/guardian`. |
| `guardian integrity [path]` | Re-checks the last commit / working tree for AI-agent-cheat patterns *without* scanning: deleted or neutered tests, swallowed errors, suppression comments, hardcoded-to-pass values, mocked SUT, forced exits. Writes `.guardian/integrity-<timestamp>.json`. Exit 0 = CLEAN, 1 = SUSPICIOUS, 2 = CONFIRMED_CHEAT. |
| `guardian demo [demo]` | Scaffolds an intentionally-broken demo repo into a fresh temp dir (default `demo-repo`, or `demo-repo-integrity` / `demo-repo-fintech` / `demo-repo-generators`), initializes git, and scans it immediately. |
| `guardian memory` | Guardian's in-repo memory: `memory add <summary>` records a decision, `memory list` shows it newest-first, `memory relevant <file>` recalls entries touching a file — past fixes and rejected approaches survive across sessions. |
| `guardian scan --json` | Prints the raw scan result as JSON (pipeline-friendly; no banner/spinner pollution). |
| `guardian verify` | Adds a **Guardian Score** row to the Δ table, so every fix iteration shows points moving, not just raw metrics. |
| `guardian share` | Renders a 1200×630 self-contained share card (`GUARDIAN_CARD.html`) — score, trend, integrity/evidence chips, top findings. Screenshot it and post it. |
| `guardian digest [--days N] [--md]` | The progress story: score movement, what got fixed/regressed, gate results, cheat catches, flakies, open findings. |
| `guardian honesty [--html]` | The AI-honesty proof: evidence chain + integrity history + verify delta + committed repro tests → one verdict, or a shareable HTML certificate. |
| `guardian pen [path] [--fix] [--html] [--json]` | A real penetration test. Static heuristics (secrets, routes, injection/SSRF/XSS rule sets) + a dynamic phase that boots the app under a sandbox which intercepts and records **every** outbound HTTP and spawn. Findings are `PROVEN` only when the sandbox evidence contains the attack canary (SSRF receipt, spawn with the payload marker, reflected marker) — everything else is honestly `indicated`. Nothing reaches the real network; raw sockets are blocked. Every static finding also gets a **runtime-proof verdict**: `proven` (its proving dynamic attack fired live), `indicated` (static rule fired, dynamic phase couldn't confirm), `unproven` (dynamic phase ran and found no evidence for that rule), or `not-tested`. `--fix` writes failing-then-passing repro tests + `git apply`-able patches. Exit: 0 = clean, 1 = high/critical found, 2 = aborted. |
| `guardian inspect <pen-id>` | Deep-dives pen findings too: the exact attack fired, the observed response, the sandbox evidence lines, the fix, and the repro. |
| `guardian repro <pen-id>` | Records a pen finding as a regression test that boots the app under the sandbox itself — fails now, must pass after the fix. |
| `guardian ready-check [path]` | The "is it worth scanning again?" gate: unchanged tree → exit 0, reuse the baseline; something changed → exit 1. |
| `guardian budget [path]` | The token-economy bill: scan/verify/pen/repro counts and compute-seconds per reliability run, plus reuse advice for the fix loop. |
| `guardian scan [path] --reuse` | Returns the sealed baseline when the source tree is unchanged — the fast path for the loop: `ready-check` → `scan --reuse` → work → verify. |
| `guardian watch [path] [--interval ms]` | The live shield: polls the tree and re-runs the fast static pass the moment a file changes, printing the score delta. |
| `guardian drive <finding-id> [path]` | Hands one finding to *your own agent* (`GUARDIAN_AGENT` env or `--agent '…{prompt}'`), demands the repro FAIL first → fix → PASS, then verifies. Guardian never edits your code. |

### The score & badge

Skipped categories are excluded and weights renormalized, so a missing `jscpd` never
silently tanks the number. The verify Δ compares the score against the last scan with the
*exact same categories measured* — a skipped category stays skipped on both sides, so the
score only moves when the code does.

### Tamper-evident evidence

Every scan, verify and integrity document Guardian writes is sealed with a `sha256` digest
over its own canonical content (`guardian-sha256-canonical-v1`, deterministic key-sorted
JSON). Edit the JSON after the fact — inflate a score, delete a finding — and
`guardian verify`/`guardian gate` recompute the digest, detect the mismatch and report the
chain as broken. Guardian can't be tricked into endorsing a baseline it didn't write; the
`gate` exit code treats a broken chain as a hard fail.

### Prompt transparency

Some AI tools show a slash-command's expanded prompt in their UI, some don't. Guardian
guarantees it two ways: the `/guardian` prompt's **Step 0** makes the agent print the exact
instructions it's operating under (mode, sequence, guardrails) as its very first message in
your window — and `guardian prompt` lets you preview the raw prompt before anyone types
anything.

### Root-cause correlation

Findings that touch the same files are clustered into root causes, so the box shows
`1 root cause → 2 symptoms` instead of a flat list. Every cluster gets a deterministic id
(e.g. `security-19c390c6`) that the repro step can reference.

### Confirm, then loop

The agent prints the boxed summary, then **waits for your one-time confirmation**. After
that it works cluster by cluster on a `guardian/*` branch: it must capture the bug as a
failing test first (`guardian repro <id>`), make the smallest fix, pass the same repro
test, run `guardian verify`, and commit. It re-scans after every fix and stops when a fresh
scan shows zero clusters (hard limits: 10 fix iterations or 45 minutes), ending with a
`GUARDIAN_REPORT.md`.

### Ledger mode (opt-in)

`guardian scan --ledger` boots the app with **every outbound HTTP call intercepted** by a
mock gateway, then replays the three classic idempotency failures (duplicate webhook,
concurrent double-submit, delayed retry). If the mock gateway's own receipt log shows more
than one charge per idempotency key, that is a proven double-charge — the shipped
`demo-repo-fintech` fixture produces three such PROVEN findings because its charge and
webhook endpoints have no idempotency guard. Any traffic the sandbox can't intercept aborts
the run (`exit 77`); nothing ever reaches a real gateway.

### Integrity gate

Every `guardian verify` also diffs your change against HEAD and scans it for agent-cheat
patterns: deleted or loosened tests, tests focused to hide failures (`fit`/`test.only`),
swallowed exceptions, suppression comments, hardcoded-to-pass values, a mocked
module-under-test, forced `exit(0)` in app code, and an assertion's expected value edited
to match the buggy output. A caught cheat looks like this: change `assert.equal(round2(8.075), 8.08)`
to expect `8.07` with nothing else in the diff → `CONFIRMED_CHEAT`, the change is blocked,
and a human reviews it (verified against `fixtures/assertion-literal-tamper/`). An honest
app-side fix sails through `CLEAN`.

### Cheat-catch demo

Want to *see* it? `scripts/cheat-demo.cjs` runs a fully scripted, deterministic
SUSPICIOUS → CONFIRMED_CHEAT arc against a real repo with a real failing jest test:
a lazy agent first focuses the suite on the passing tests (gate blocks, exit 1), then
deletes the failing test (gate blocks, exit 2 — with the tamper-evident baseline still
verifying). Point it at a build with `GUARDIAN_CLI="node /path/to/dist/cli.js"`, or let it
use `npx cli-guardian`. Great for a video or a live judge's demo.

## Architecture

Guardian is two pieces: a **deterministic CLI** that measures, and **your host agent** that
reasons and edits. The CLI produces reproducible scan/verify numbers and gated verdicts;
the model in whichever tool you're using reads them, decides what to change, and does the
editing through the `/guardian` prompt template. This is deliberately *not* a monolithic
agent — the numbers can't be talked into looking better, and the agent can't silently
cheat its own referee. That separation is the product.

## Known limitations

- **Windows** is CI-verified on every push (build + smoke on `ubuntu-latest` and
  `windows-latest`), and the Windows-specific bugs were reproduced and fixed on a real
  Windows host during development — but not every workflow has been exhaustively manually
  tested on Windows.
- **Codex App / VS Code extension** isn't supported and won't be until OpenAI ships custom
  slash commands; use Codex CLI for `/guardian`.
- **Graceful degradation:** duplication (`jscpd`), secrets/code scanning (`gitleaks`,
  `semgrep`), and accessibility runtime checks (`pa11y`/`axe`) run only when that tool is
  installed locally. The scan reports `skipped` for those categories and works fine without
  them.
- Requires **Node.js 22+** (the CLI depends on execa 10, which uses ES2024 `Set.union`).
- **Pen-test honesty:** `guardian pen` reports each finding with a **runtime-proof
  verdict**: **proven** (the live dynamic attack confirmed it under the sandbox),
  **indicated** (static rule fired but the dynamic phase couldn't confirm), **unproven**
  (the dynamic phase ran and found no evidence for that rule), or **not-tested** (dynamic
  phase aborted). Proven findings are real; everything else is a hypothesis until you
  replay the attack yourself. The sandbox records outbound connections and spawned
  processes instead of blocking them (so real bytes never leave your machine for canaries,
  but a compromised app could still run commands locally); raw socket APIs are blocked
  outright. `pen --fix` writes deterministic patches **only** for findings fixable by pure
  insertion (e.g. missing `helmet()`, `x-powered-by` leaks) — anything else gets a failing
  repro test and fix guidance, which is your contract for the fix.
- **`drive` verdicts** for runtime pen findings come from the repro test (FAIL first, PASS
  after the fix), not from the static score — the static gate has nothing to say about a
  runtime-only finding.

## Contributing

Guardian is built to be extended — adding a whole new analyzer is a small, well-scoped
change. See [CONTRIBUTING.md](CONTRIBUTING.md) for the analyzer interface, conventions, and
how to open a PR. For the launch notes and the "why", read [LAUNCH.md](LAUNCH.md).

## License

[MIT](LICENSE)
