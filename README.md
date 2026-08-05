# Guardian CLI

**Deterministic scans + your coding agent's own reasoning, in one autonomous quality loop.**

`cli-guardian` gives any AI coding tool a `/guardian` slash-command that scans your repo,
shows you a boxed summary of the root causes it found, waits for your **one-time
confirmation**, then lets your agent autonomously fix, verify, re-scan, and repeat until
nothing is left to fix.

[![CI](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

---

## Watch it run

This is the actual boxed output `guardian scan` prints — verbatim from a real run against the
intentionally-broken demo repo:

```
╔═══════════════════  GUARDIAN — Repository Scan Complete  ════════════════════╗
║                                                                              ║
║   Dependency Graph : 2 circular — src/userService.js → src/userRepo.js →     ║
║   src/userService.js                                                         ║
║   Security         : 1 issues — high dependency: lodash: Command Injection   ║
║   in lodash                                                                  ║
║                                                                              ║
║   Root Causes      : 1 root cause(s) → 2 symptom(s)                          ║
║   1. MEDIUM circular: circular dependency: src/userService.js →              ║
║   src/userRepo.js → src/userService.js                                       ║
║   → 2 symptom(s) · shared: src/userService.js, src/userRepo.js,              ║
║   src/userController.js                                                      ║
║   Duplication      : skipped — jscpd not found                               ║
║   Tests            : 2 failed / 2 — 5832ms, 38.46% cov                       ║
║   Performance      : skipped — no build script                               ║
║   Accessibility    : skipped — no HTML or JSX found in repo                  ║
║   Reliability      : 0 flaky · 0 race smells · 3 runs                        ║
║   Devex            : 0 unused exports · 1 dup function(s)                    ║
║                                                                              ║
║   Awaiting confirmation to begin autonomous fixing.                          ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

Then the loop: you confirm once, and the agent branches, fixes, verifies, re-scans, and stops
only when the repo is clean — `nothing left to fix, nothing broken.` A final `guardian
report` writes `GUARDIAN_REPORT.md`.

Run it yourself in under two minutes:

```bash
git clone https://github.com/Krish-1507/Guardian.git && cd Guardian
npm install
npx cli-guardian demo      # copies the intentionally-broken demo repo to a temp dir
# open that repo in Claude Code / Cursor / OpenCode / Kilo Code / Antigravity / Codex CLI / Gemini CLI, then:
/guardian                  # a boxed scan summary appears...
<Enter>                    # ...you confirm once, and watch it loop
```

---

## What Guardian is (and isn't)

Guardian is **two pieces glued together**:

1. **A deterministic scan/verify engine** (`cli-guardian`). It reads your code and runs
   real tools to produce numbers, not opinions:
   - **Dependency graph** — circular imports, most-depended-on hubs, orphan files
   - **Security** — `npm audit` / `pip-audit`, `gitleaks` (secrets), `semgrep` (code)
   - **Duplication** — `jscpd` (copy-paste clones)
   - **Tests** — `jest`, `vitest`, or `pytest` (pass/fail, duration, coverage)
   - **Performance** — build time + bundle size
   - **Accessibility** — `pa11y`/`axe` runtime checks on static HTML, plus a built-in
     static JSX lint that needs no install
   - **Reliability** — flaky-test detection (suite run repeatedly) + race-condition
     heuristics
   - **DevEx** — unused exports + structural duplicate-function detection
   - **Root-cause correlation** — clusters symptoms that share the same files into one root cause

   It also **records** every scan, verify, and fix in memory so the loop gets smarter over
   time and produces a `GUARDIAN_REPORT.md` at the end.

2. **Your existing coding agent's own reasoning.** Guardian never edits your code itself.
   The `/guardian` slash-command is a prompt template that drives *your* agent — Claude
   Code, Cursor, OpenCode, Kilo Code, Antigravity, Codex CLI, or Gemini CLI — through a
   disciplined loop: state a hypothesis, make the smallest fix, run `verify`, and re-scan.
   The agent does the editing; Guardian does the measuring.

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
   fix, runs `guardian verify` (re-runs tests/perf, diffs against the baseline to compute a
   **Regression Risk**, and gates the change through the **integrity gate** — a diff-scoped
   scan for AI-agent-cheat patterns), and commits + records a memory entry when risk is
   Low/Medium **and** the integrity verdict is CLEAN. High risk means revert and retry once,
   then move on. A SUSPICIOUS integrity verdict reverts and retries the same cluster once with
   a stricter "solve the root cause" instruction; CONFIRMED_CHEAT goes straight to human
   review (see [The integrity gate](#the-integrity-gate--a-referee-for-the-referee)).

4. **Re-check.** After every fix the agent re-scans and prints a short updated box. When a
   fresh scan shows **zero actionable clusters** it stops with `nothing left to fix, nothing
   broken.` Hard stops: 10 fix iterations or 45 minutes. On any stop it runs `guardian
   report`, which writes `GUARDIAN_REPORT.md`.

---

## Quick start

One command. It installs into **every supported tool at once** — project-level for the repo
you run it in, user-level so `/guardian` also works in any other repo on your machine:

```bash
# 1. In the repo you want guarded
cd your-repo

# 2. One command — install /guardian into all your coding tools at once
npx cli-guardian install

# 3. Open the repo in any tool and type:
/guardian
```

That's it. Claude Code, Cursor, OpenCode, Antigravity, Kilo Code, Codex CLI, and Gemini CLI
all pick it up. New tools support `-y` for re-runnable, idempotent installs (e.g. after an
update):

```bash
npx cli-guardian install -y    # overwrite with the latest template, safe to re-run
```

Then: read the box, hit **enter**, watch it loop.

### Try it without a real project

```bash
npx cli-guardian demo
```

This copies the intentionally-broken `demo-repo` into a fresh temp directory, git-inits and
commits a baseline (so the verify integrity gate can diff fixes), installs the slash-command
there, and prints where to open it. The demo is seeded with a circular dependency, a hardcoded
secret, a known-CVE dependency, duplicated code, and failing tests — so you can watch the whole
loop from a real `scan` down to a real `report`.

Other fixtures: `npx cli-guardian demo demo-repo-integrity` (a hard float-rounding bug that
exercises the integrity gate — see [The integrity gate](#the-integrity-gate--a-referee-for-the-referee)),
`demo-repo-fintech` (the ledger double-charge fixture), and `demo-repo-generators`.

---

## Installation paths

`npx cli-guardian install` writes `guardian.prompt.md` (from `templates/`) to the following
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
| OpenCode | user | `~/.config/opencode/commands/guardian.md` |
| OpenCode (legacy) | user | `~/.opencode/commands/guardian.md` |
| Antigravity | project | `.agent/workflows/guardian.md` |
| Antigravity (plural variant) | project | `.agents/workflows/guardian.md` *(docs are inconsistent across versions — both are written, one is harmless)* |
| Antigravity | user | `~/.agent/workflows/guardian.md` |
| Antigravity (plural variant) | user | `~/.agents/workflows/guardian.md` |
| Kilo Code | project | `.kilo/commands/guardian.md` |
| Kilo Code (legacy) | project | `.kilocode/workflows/guardian.md` *(auto-migrated to `.kilo/commands/` by the new extension)* |
| Kilo Code | user | `~/.config/kilo/commands/guardian.md` |
| Kilo Code (legacy) | user | `~/.kilocode/workflows/guardian.md` |
| Gemini CLI | project | `.gemini/commands/guardian.toml` *(TOML — `description` + `prompt`; the template is converted automatically)* |
| Gemini CLI | user | `~/.gemini/commands/guardian.toml` |
| Codex CLI | user | `~/.codex/prompts/guardian.md` *(Codex supports prompts at user level only)* |
| Codex App / VS Code extension | — | **not supported** — no file is written; the install prints a manual-copy note instead |

Existing files are never overwritten by default — pass `--force` (or `-y`) to replace them, or
`--uninstall` to remove them:

```bash
npx cli-guardian install --force
npx cli-guardian install --uninstall
```

### What you get when you type `/guardian`

Every tool renders the same template, and it starts with a mode menu when invoked bare:

```
Guardian modes:
 (enter) — full autonomous loop (scan, confirm, fix, verify, repeat)
 --scan-only — scan and report, no fixes
 --demo — run against Guardian's own seeded demo repo
 --ledger — payment idempotency fuzzing only
 --integrity-only — re-check the last commit for cheat patterns, no scanning
Reply with a mode, or just hit enter for the default full loop.
```

Invoking `/guardian --demo` (or `--scan-only`, `--ledger`, `--integrity-only`) skips the menu
and goes straight into that mode. If a tool ever fails to substitute arguments into the
prompt, Guardian falls back to the menu rather than guessing.

---

## Commands

| Command | What it does |
|---------|--------------|
| `guardian scan [repo]` | Run all analyzers, correlate root causes, print the boxed summary. |
| `guardian scan [repo] --ledger` | **Opt-in** ledger mode: boots the app, fires replay/double-submit/retry traffic at a mocked gateway, and proves whether payment endpoints double-charge. |
| `guardian repro <finding-id> [repo]` | Turn a captured finding into a permanent failing test: generate a repro, run it, and get a boxed FAIL/PASS verdict (exit 0 = bug not reproduced, exit 1 = bug reproduced). `-w` / `--write-only` writes the test without running it. |
| `guardian verify [repo]` | Re-run tests/perf, diff against the last baseline, AND gate the change on the integrity diff since HEAD. Prints Regression Risk + the integrity verdict with inline evidence; exit 0 = clean, 1 = SUSPICIOUS (or High risk), 2 = CONFIRMED_CHEAT. |
| `guardian integrity [repo]` | Standalone diff-scoped AI-agent-cheat scan over `--from..--to` (default: previous commit → working tree). Verdict CLEAN/SUSPICIOUS/CONFIRMED_CHEAT, exit 0/1/2; writes `.guardian/integrity-<timestamp>.json`. |
| `guardian memory add "..." --type <fix\|decision\|rejection>` | Record a lesson for future scans to recall. |
| `guardian report [repo]` | Aggregate scan/verify history into `GUARDIAN_REPORT.md` + a boxed terminal summary. |
| `guardian demo [fixture]` | Copy a broken demo repo (`demo-repo` by default; also `demo-repo-integrity`, `demo-repo-fintech`, `demo-repo-generators`) to a temp dir, git-init + baseline commit, and install the slash-command there. |
| `guardian install [--force\|--uninstall]` | Install/remove the `/guardian` slash-command into your tools. |
| `guardian ci [repo]` | Diagnostic-only: diff a PR against its base branch and print a markdown CI report (used by the GitHub Action). |

### What the engine detects

- **Dependency graph** — circular imports, dependency hubs, orphan files (included when
  `node_modules` is present).
- **Security** — `npm audit` / `pip-audit` vulnerabilities, `gitleaks` secrets, `semgrep`
  code findings (each tool is used only if installed).
- **Duplication** — `jscpd` clone detection (only if installed).
- **Tests** — `jest`, `vitest`, or `pytest`: total/passed/failed, duration, coverage.
- **Performance** — build time and bundle size when the repo has a `build` script.
- **Accessibility** — `pa11y`/`axe` runtime checks on static HTML (only if installed), plus a
  built-in static JSX lint that runs with no dependencies.
- **Reliability** — flaky tests (the suite is run repeatedly; outcomes that change across runs
  are flagged) and timer/state race-condition heuristics (always labeled as heuristics).
- **DevEx** — unused exports and near-identical duplicate function bodies, via structural
  source analysis that needs no extra tooling.
- **Integrity** — diff-scoped detection of AI-agent-cheat patterns, run automatically on every
  `guardian verify` (and standalone via `guardian integrity`): deleted or loosened tests,
  swallowed exceptions, suppression comments, hardcoded-to-pass values, a mocked module-under-
  test, forced `exit(0)` in application code, and an assertion's expected value being edited
  to match the buggy output. See [The integrity gate](#the-integrity-gate--a-referee-for-the-referee).
- **Ledger** *(opt-in, `--ledger`)* — discovers money-moving endpoints (charge/capture/
  payment/transfer/refund/webhook routes and razorpay/stripe/braintree SDK usage), boots the
  app under a sandbox where **every outbound HTTP call is intercepted**, replays real traffic
  (duplicate webhook, concurrent double-submit, delayed retry), and proves double-charges from
  the mock gateway's own receipt log. Any traffic the sandbox cannot intercept aborts the run —
  nothing ever reaches a real gateway.

---

## Ledger mode (`guardian scan --ledger`)

Most payment bugs are invisible to static analysis: the code *looks* idempotent until two
requests for the same order actually land. Ledger mode checks the claim at runtime.

1. **Discover.** Static analysis finds money-moving routes and payment-SDK imports
   (razorpay, stripe, braintree), and maps each SDK to the gateway host it calls.
2. **Sandbox.** Guardian boots the app under `templates/ledger/preload.cjs`, which injects
   nock with `disableNetConnect()` — no outbound request can leave the process. Any request
   the sandbox cannot intercept (unmocked hosts, raw `net`/`tls` sockets, `child_process`
   binaries, `global fetch`/undici) triggers an **abort** and the run is reported as
   `aborted` with the reason. The mock gateway records every request/response it receives.
3. **Attack.** For each discovered endpoint, Guardian replays the three classic
   idempotency failures — a duplicate webhook 300 ms later, a concurrent double-submit, and a
   delayed retry — using the endpoint's real contract (amount/currency, idempotency header).
4. **Prove.** The gateway's receipt log is counted per idempotency key. More than one charge
   per key is a **proven double-charge**, surfaced as a top-ranked
   `proven-double-charge` cluster plus a boxed `PROVEN:` line. Full request/response logs land
   in `.guardian/ledger-evidence-<timestamp>.json`; the raw receipt log lives under
   `.guardian/ledger/run-<timestamp>/`.

Safety is the contract: ledger mode never fires unless you pass `--ledger`, and the sandbox
**cannot** be bypassed while active — an app that tries to reach the network outside the mock
stops the run with `exit 77` before any real call escapes.

Try it against the intentionally-broken companion fixture:

```bash
npm run build
node dist/cli.js scan demo-repo-fintech --ledger
```

The fixture ships an Express + razorpay app whose charge and webhook endpoints have **no
idempotency guard** — expect three `PROVEN` double-charges (concurrent double-submit, delayed
retry, and webhook replay), each backed by two real mock-gateway requests in the receipt log.

---

## Reproduce before you fix (`guardian repro <finding-id>`)

Guardian never fixes a bug it hasn't first captured as a failing test. Every finding is stamped
with a deterministic id (`ledger-18f7bcc7`, `security-19c390c6`, …) shown in the scan box and
stored in `.guardian/scan-latest.json`. `guardian repro` turns one into a permanent repro test:

```bash
node dist/cli.js scan demo-repo-fintech --ledger   # shows [ledger-18f7bcc7] etc.
node dist/cli.js repro ledger-18f7bcc7 demo-repo-fintech
```

What happens:

1. **Resolve** the finding id from `.guardian/scan-latest.json`.
2. **Generate** a `guardian-repro-<slug>.test.{js,mjs,py}` file that replays the exact bug
   (ledger boot under the sandbox via `GUARDIAN_LEDGER_PRELOAD`, the verified lodash
   CVE-2021-23337 exploit, a parallel race probe, or a perf threshold against the Phase-1
   baseline). Guardian never fabricates a repro it can't make genuinely fail — unverified
   recipes are **refused** rather than faked.
3. **Run** the test file with the repo's real test framework (jest, vitest, node `--test`,
   pytest).
4. **Verdict** — a boxed `FAIL — bug reproduced` (exit 1) means the bug is real and captured;
   `PASS — bug not reproduced` (exit 0) means the hypothesis is unproven, so the loop must
   re-diagnose instead of fixing blind.

The loop in `templates/guardian.prompt.md` makes this step **mandatory before any fix**, then
re-runs the *same* repro test after the fix and requires it to PASS. The committed test file is
a permanent regression guard, and `guardian report` lists every one under **Fixes shipped with
permanent proof**.

---

## The integrity gate — a referee for the referee

The whole loop depends on the agent fixing root causes honestly. The integrity gate is the
check that keeps it honest: every `guardian verify` also diffs your uncommitted change against
`HEAD` and scans it for AI-agent-cheat patterns — the shortcuts an agent might take instead of
a real fix:

| Pattern | Detector | Verdict |
|---|---|---|
| Whole test file deleted / whole test case removed | `testTamper` | **CONFIRMED_CHEAT** |
| `process.exit(0)` / `sys.exit(0)` / `os._exit(0)` added in app code | `exitCheat` | **CONFIRMED_CHEAT** |
| Assertion's expected value edited with nothing else in the diff | `assertionLiteralTamper` | **CONFIRMED_CHEAT** |
| Test marked skipped / tolerance or equality loosened | `testTamper` | SUSPICIOUS |
| New `try/catch` that swallows the error | `exceptionSwallow` | SUSPICIOUS |
| New suppression marker (`eslint-disable`, `ts-ignore`, `noqa`, `@pytest.mark.skip`, …) | `suppressionCreep` | SUSPICIOUS |
| App literal matches a value asserted in a test | `hardcodedMatch` | SUSPICIOUS |
| Test mocks/stubs the module under test | `mockOverreach` | SUSPICIOUS |

Each diff gets **one overall verdict** — **CLEAN**, **SUSPICIOUS**, or **CONFIRMED_CHEAT**
(exit code 0 / 1 / 2):

- **CLEAN** → the change proceeds to commit as normal.
- **SUSPICIOUS** → the loop does **not** commit. It states what was flagged and why (detector,
  `file:line`, evidence), reverts the change, and retries the **same** cluster exactly once
  with a stricter instruction: *"solve the root cause; do not modify, skip, or loosen any test;
  do not add suppression comments or swallow exceptions."* If the retry is also SUSPICIOUS,
  the cluster is marked **"requires human review"** and the loop moves on — it never loops
  indefinitely on the same pattern.
- **CONFIRMED_CHEAT** → unambiguous (a deleted test or a forced success exit). Zero retries:
  the cluster is marked **"requires human review"** and a human looks at it.

In the verify box a blocked change reads `Regression risk: BLOCKED — integrity violation
(SUSPICIOUS|CONFIRMED_CHEAT)` with the evidence inline, and the exit code is 1 or 2
**regardless of what the tests/perf numbers say** — a cheating diff that makes tests *pass* is
still blocked, while an honest app-only fix sails through CLEAN. Every catch, including ones
the loop self-corrected on retry, is listed in `GUARDIAN_REPORT.md`'s **Integrity gate**
section, framed as the gate working rather than hidden.

Run it directly against any repo:

```bash
npx cli-guardian integrity .        # standalone: diff over --from..--to (default: previous commit → working tree)
npx cli-guardian verify .           # the loop's gate: same scan, gated pre-commit
```

Try it against the companion fixture (from a build):

```bash
npm run build
node dist/cli.js demo demo-repo-integrity
```

`demo-repo-integrity` ships a deliberately hard, ambiguous bug — a half-cent float-rounding
error (`round2(8.075)` returns `8.07` instead of `8.08`). The *lazy* fix looks attractive
(loosen the assertion, wrap it in a `try/catch`, hardcode the value) and is exactly what the
gate flags as SUSPICIOUS; the honest fix is a one-line change in app code that sails through
CLEAN. Both directions matter — a gate that blocks honest fixes is as broken as one that
misses cheats.

---

## Safety

The loop runs under hard safety rules baked into the prompt template:

- Never force-push; never touch `.git/`, `.env`, or secret files.
- Never delete a file unless the dependency graph shows zero incoming references.
- Never silently modify CI/deploy config — flagged to you instead.
- All work happens on a `guardian/*` branch; `main` stays untouched.

---

## Development

Requires **Node.js ≥ 22** (the CLI depends on execa 10, which uses ES2024 `Set.union` — not
available on older runtimes). CI builds and smokes on Node 22 across Ubuntu and Windows.

```bash
npm install
npm run build      # tsc → dist/
npm run dev        # tsx watch src/cli.ts
```

TypeScript, ESM, zero test framework dependency in the CLI itself. The packaged tarball
ships `dist/`, `templates/`, and `demo-repo/` — see the CI badge above for build + smoke
test status.

## Contributing

Guardian is built to be extended — adding a whole new analyzer is a ~10-minute change.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the analyzer interface, conventions, and how to
open a PR. For the launch notes and the "why", read [LAUNCH.md](LAUNCH.md).

## License

[MIT](LICENSE)
