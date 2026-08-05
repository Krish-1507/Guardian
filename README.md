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
you can watch the whole loop.

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
functions). A category whose underlying tool isn't installed prints `skipped` instead of a
made-up number. The box always opens with the **Guardian Score**: a single 0–100 health
number (with an A–F grade) computed across the categories that actually ran.

### Bonus commands

| Command | What it does |
|---|---|
| `guardian inspect <finding-id>` | Deep-dive on one finding: code snippet, root-cause cluster context, whether a permanent repro test exists, and Guardian's memory of the files. `npx cli-guardian report --html` also embeds the score. |
| `guardian trends` | Turns the `.guardian/scan-*.json` history into per-category sparklines plus a score trend — watch the loop actually improve a repo. |
| `guardian report --html` | Writes a single self-contained `GUARDIAN_REPORT.html` (inline SVG trend charts, integrity-gate timeline, zero external assets — send it to a stakeholder and it just works). Every `guardian report` also writes `GUARDIAN_BADGE.svg`, a README-ready shield: `![Guardian score](GUARDIAN_BADGE.svg)`. |
| `guardian doctor` | Explains why categories are `skipped`: checks the toolchain (Node, git, jscpd, gitleaks, semgrep, pa11y) and prints copy-paste install hints. |
| `guardian prompt [--args …]` | Prints the exact `/guardian` prompt your AI tool expands to, with your arguments substituted — full transparency into what the agent was told. |
| `guardian scan --json` | Prints the raw scan result as JSON (pipeline-friendly; no banner/spinner pollution). |
| `guardian verify` | Adds a **Guardian Score** row to the Δ table, so every fix iteration shows points moving, not just raw metrics. |

### The score & badge

Skipped categories are excluded and weights renormalized, so a missing `jscpd` never
silently tanks the number. The verify Δ compares the score against the last scan with the
*exact same categories measured* — a skipped category stays skipped on both sides, so the
score only moves when the code does.

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
patterns: deleted or loosened tests, swallowed exceptions, suppression comments,
hardcoded-to-pass values, a mocked module-under-test, forced `exit(0)` in app code, and an
assertion's expected value edited to match the buggy output. A caught cheat looks like
this: change `assert.equal(round2(8.075), 8.08)` to expect `8.07` with nothing else in the
diff → `CONFIRMED_CHEAT`, the change is blocked, and a human reviews it (verified against
`fixtures/assertion-literal-tamper/`). An honest app-side fix sails through `CLEAN`.

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

## Contributing

Guardian is built to be extended — adding a whole new analyzer is a small, well-scoped
change. See [CONTRIBUTING.md](CONTRIBUTING.md) for the analyzer interface, conventions, and
how to open a PR. For the launch notes and the "why", read [LAUNCH.md](LAUNCH.md).

## License

[MIT](LICENSE)
