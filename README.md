# Guardian CLI

**Deterministic scans + your coding agent's own reasoning, in one autonomous quality loop. Adds a `/guardian` slash-command to any AI coding tool.**

[![npm version](https://img.shields.io/npm/v/cli-guardian)](https://www.npmjs.com/package/cli-guardian)
[![CI](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Krish-1507/Guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **The agent finally has a referee it can't cheat.** Guardian measures your repo with
> deterministic scans, seals every number in a tamper-evident evidence chain, attacks your
> app with a live penetration test, and gates every change — catching the "agent faked
> being done" moves with exit codes: `0` clean · `1` suspicious · `2` confirmed cheat.

---

## See it in 90 seconds

Two commands. First, a real broken repo — scanned, scored and reported in seconds:

```bash
npx cli-guardian@latest demo
```

Then the part that gets the *wow*: a scripted arc where a lazy agent tries to make the
failing suite green without fixing the bug — and the gate catches both attempts:

```bash
node scripts/cheat-demo.cjs                             # from a Guardian repo checkout
node node_modules/cli-guardian/scripts/cheat-demo.cjs   # from any project that installed it
```

Set `GUARDIAN_CLI="node /path/to/dist/cli.js"` to run it against a local build instead
of the registry.

```
ACT 1  honest baseline              →  1 failed test, scanned and sealed
ACT 2  agent focuses passing tests  →  GATE: SUSPICIOUS     (exit 1) — blocked
ACT 3  agent deletes the test       →  GATE: CONFIRMED_CHEAT (exit 2) — blocked
       (tamper-evident evidence chain verifies the whole way)
```

Deterministic, safe to run in a live room, and it's the whole product in miniature:
**Guardian measures, your agent edits, and the numbers can't be cheated.**

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

### The loop at a glance

```
scan ──► report ──► you confirm ──► repro (must FAIL first) ──► fix ──► verify ──► repeat
 │                                  │                           │        │
 │   deterministic analyzers,       │   captures the bug as a   │   repro PASS +
 │   sealed evidence, one score     │   permanent regression     │   anti-cheat gate
 └──────────────────────────────────┴───────────────────────────┴────────┘
                    stops only when a fresh scan shows zero clusters
```

The loop runs **inside your AI coding tool** via `/guardian`. Guardian never edits your
code — it measures, gates and explains; your agent does the editing under the threat of
being caught.

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

## Every command

All 23 commands, grouped by job. Run them from inside a repo as `guardian …` (CLI) or
`npx cli-guardian …` (one-off); `/guardian` in a tool drives the loop, the rest are
one-shot.

**Measure — the numbers**

| Command | What it does |
|---|---|
| `guardian scan [path] [--json] [--reuse] [--ledger]` | The full deterministic scan: dependency graph, security (`npm audit` + gitleaks/semgrep), duplication (jscpd), tests, build perf, accessibility, reliability, DevEx → one **Guardian Score** (0–100, A–F). `--json` for pipelines; `--reuse` returns the sealed baseline when the tree is unchanged; `--ledger` adds the payment idempotency fuzz. |
| `guardian verify` | Re-scans and shows the Δ — the score moves, points don't lie. Also runs the anti-cheat gate over your diff vs HEAD. |
| `guardian try [path]` | Zero-setup 2-second score on **any** repo — no install, no tool config; saves a sealed baseline so verify/gate can build on it. |
| `guardian ready-check [path]` | "Worth scanning again?" — unchanged tree → exit 0 and reuse the baseline; something changed → exit 1. |
| `guardian watch [path] [--interval ms]` | The live shield: re-runs the fast static pass the moment a file changes, printing the score delta. |
| `guardian trends` | Turns `.guardian/scan-*.json` history into per-category sparklines + score trend — watch the loop improve a repo. |
| `guardian budget [path]` | The token-economy bill: scan/verify/pen/repro counts and compute-seconds, plus reuse advice for the fix loop. |

**The fix loop — what the agent is told to do**

| Command | What it does |
|---|---|
| `guardian drive <finding-id> [path]` | Hands one finding to *your own agent* (`GUARDIAN_AGENT` or `--agent '…{prompt}'`): repro FAIL first → fix → repro PASS → verify. Guardian never edits your code. |
| `guardian memory add/list/relevant` | In-repo memory: record a decision (`add`), see it newest-first (`list`), recall entries touching a file (`relevant`) — past fixes and rejected approaches survive across sessions. |
| `guardian inspect <finding-id>` | Deep-dive on one finding: code snippet, root-cause cluster, whether a permanent repro test exists, and Guardian's memory of the files. |

**Integrity & anti-cheat — the referee**

| Command | What it does |
|---|---|
| `guardian gate [--score 60]` | Agentless commit gate for CI/pre-commit: score threshold + regression risk + integrity diff + evidence signature. **Exit 0 = PASS · 1 = FAIL · 2 = CONFIRMED_CHEAT.** |
| `guardian integrity [path]` | Re-checks the last commit / working tree for cheat patterns *without* scanning: deleted or neutered tests, swallowed errors, suppression comments, hardcoded-to-pass values, mocked SUT, forced exits. **Exit 0 = CLEAN · 1 = SUSPICIOUS · 2 = CONFIRMED_CHEAT.** |
| `guardian ci [path]` | CI-mode scan + verify against the base branch → PR-ready markdown report — the gate as a PR comment. Diagnostic only; fixes stay local via `/guardian`. |

**Penetration test — attack your own app**

| Command | What it does |
|---|---|
| `guardian pen [path] [--fix] [--html] [--json]` | A real pen test: static heuristics (secrets, routes, injection/SSRF/XSS) + a **dynamic phase that boots the app under a sandbox** recording every outbound HTTP and spawn. Findings are `PROVEN` only from sandbox canary evidence; everything else is honestly `indicated`/`unproven`. Nothing reaches the real network; raw sockets are blocked. `--fix` writes failing-then-passing repro tests + `git apply`-able patches. Exit 0 = clean · 1 = high/critical · 2 = aborted. |
| `guardian inspect <pen-id>` | Deep-dives pen findings: the exact attack fired, the observed response, the sandbox evidence lines, the fix, the repro. |
| `guardian repro <pen-id>` | Records a pen finding as a sandbox-booted regression test — fails now, must pass after the fix. |

**Proof & reports — what you show people**

| Command | What it does |
|---|---|
| `guardian report --html` | One self-contained `GUARDIAN_REPORT.html` (inline SVG trends, integrity timeline, zero external assets). Also writes `GUARDIAN_BADGE.svg` — a README-ready shield: `![Guardian score](GUARDIAN_BADGE.svg)`. |
| `guardian share` | Renders a 1200×630 share card (`GUARDIAN_CARD.html`) — score, trend, integrity/evidence chips, top findings. Screenshot it and post it. |
| `guardian digest [--days N] [--md]` | The progress story: score movement, what got fixed/regressed, gate results, cheat catches, flakies, open findings. |
| `guardian honesty [--html]` | The AI-honesty proof: evidence chain + integrity history + verify delta + committed repro tests → one verdict, or a shareable HTML certificate. |

**Setup & transparency**

| Command | What it does |
|---|---|
| `guardian install` / `install --uninstall` | Writes `/guardian` into every supported tool (project + user level). `--uninstall` removes everything. |
| `guardian doctor` | Explains why categories are `skipped`: checks the toolchain (Node, git, jscpd, gitleaks, semgrep, pa11y) and prints copy-paste install hints. |
| `guardian prompt [--args …]` | Prints the exact `/guardian` prompt your AI tool expands to, with your arguments substituted — full transparency into what the agent was told. |
| `guardian demo [demo]` | Scaffolds an intentionally-broken demo repo into a fresh temp dir (`demo-repo`, `demo-repo-integrity`, `demo-repo-fintech`, `demo-repo-generators`), initializes git, and scans it immediately. |

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

Want to *see* it? The scripted arc from **[See it in 90 seconds](#see-it-in-90-seconds)**
is `scripts/cheat-demo.cjs` — a fully deterministic SUSPICIOUS → CONFIRMED_CHEAT
sequence against a real repo with a real failing jest test. Point it at a build with
`GUARDIAN_CLI="node /path/to/dist/cli.js"`, or let it use `npx cli-guardian`. Great for a
video or a live judge's demo.

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
