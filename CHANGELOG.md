# Changelog

All notable changes to this project are documented here.

## [0.3.1] - 2026-08-05

### Fixed

- **CI was red on `master` (all jobs): `TypeError: TEXT_ENCODINGS.union is not a function`.**
  The CLI depends on execa 10, which requires Node ≥ 22 (`Set.prototype.union`, ES2024);
  both workflows pinned Node 20, where that method does not exist. CI (`ci.yml`, `guardian.yml`)
  now uses Node 22 and the `package.json` engines field is corrected from `>=18` to `>=22`
  (the published `0.3.0` engines metadata was misleading). The smoke test (`node dist/cli.js
  scan demo-repo`) was verified green locally on Node 22 — same version CI now uses.

## [0.3.0] - 2026-08-05

**Published to npm as `cli-guardian@0.3.0`.**

### Added (one-command install & use)

- **True one-command install**: `npx cli-guardian@latest install` writes `/guardian` into every
  supported tool in one shot — project-level into the current repo, user-level so it works in any
  repo. Runs idempotently with `-y`/`--force` (`npx cli-guardian@latest install -y` re-runs cleanly
  after updates).
- **Gemini CLI support** — first non-Markdown target. `install` now writes `.gemini/commands/guardian.toml`
  (project) and `~/.gemini/commands/guardian.toml` (user) via a new `gemini` transform that converts the
  prompt template to `{ description = "...", prompt = """ ... """ }`. Verified to load and route (model
  quota blocked a full live run on test day, parse OK).
- **Antigravity user/global targets** — `~/.agent/workflows/guardian.md` + `~/.agents/workflows/guardian.md`
  (already had the project-level pair).
- **Correct OpenCode user-level path** — global commands now also go to `~/.config/opencode/commands/`
  (the current documented location; the older `~/.opencode/commands/` layout is kept as legacy). Verified
  resolved from a fresh, project-less directory.

## [0.1.0] - 2026-08-05

### Changed

- **Published package renamed `guardian-cli` → `cli-guardian`.** The npm name
  `guardian-cli` is already taken by an unrelated maintainer, so `npx guardian-cli`
  could never resolve to this project. The package is now published as
  `cli-guardian` (verified free on npm at rename time); both the existing `guardian`
  bin and a new `cli-guardian` bin are shipped, and every docs/prompt/generated-repro
  reference (`npx cli-guardian scan`, `!npx cli-guardian repro …`, …) was updated to
  match.

### Fixed (found during the release audit)

- **`src/analyzers/tests.ts` / `src/analyzers/reliability.ts` — tests analyzer silently blind to real failures (Windows + npx).**
  Under `npx`, `node_modules/.bin` is added to `PATH`, so `commandExists("jest")` matched the POSIX shim
  `node_modules/.bin/jest`, which `execFileSync` cannot spawn on Windows (spawn fails in ~5 ms with empty
  output). The analyzer then reported `jest produced no JSON` and counted 0 tests, hiding genuinely failing
  test suites from `scan` and `verify` (verified with a repo whose suite had 2 failing tests show up as
  "skipped — jest produced no JSON" / verify `0 passed · 0 failed`). The runner now prefers the repo-local
  JS binary (`node node_modules/jest/bin/jest.js`, `node node_modules/vitest/vitest.mjs`) exactly like
  `src/repro/framework.ts` already did. Re-verified: the same repo now scans as `2 failed / 4 —
  5321ms, 86.04% cov` and verify reports the true test deltas.

- **`src/repro/framework.ts` — jest/vitest repros could report a false `FAIL — bug reproduced`.**
  `runTestFile` passed the absolute test-file path to jest/vitest. When the repo path contained a Windows
  8.3 short path segment (e.g. `C:\Users\KRISH_~1\...` vs the long `krish_b9e9r0w`), jest could not match
  the file against `rootDir`, exiting with `No tests found` — which `guardian repro` surfaced as a `FAIL`
  even though the exploit/assertions never ran. The runner now passes a repo-relative path to jest/vitest
  (node-test/pytest continue to use the absolute path). Re-verified on two finding types (ledger, security):
  the generated tests now genuinely FAIL with the bug present and genuinely PASS after the fix.

## [0.2.0] - 2026-08-05

**Published to npm as `cli-guardian@0.2.0`** (verified live: `npx cli-guardian@latest install`
and `npx cli-guardian@latest demo demo-repo` work from a clean dir against the registry package).
The npm name `guardian-cli` is owned by an unrelated package and cannot be used.

### Added

- **New integrity detector `assertionLiteralTamper` (pattern `assertion-expected-value-changed`, confidence
  `confirmed`).** Flags commits whose *entire* diff is a swapped literal RHS on a test assertion — same
  subject, same surviving suffix, changed expected value (JS `toBe|toEqual|toStrictEqual|toBeCloseTo|toMatch|toMatchObject`,
  Python `assertEqual`/`assertTrue`/`assertFalse`/`assert … ==|!=|<|>`, string-aware mid-line parsing, CRLF-safe).
  Any accompanying app change, added/deleted file, comment, or non-swap line suppresses all findings (an honest
  spec update is indistinguishable from a cheat). Covered by `fixtures/assertion-literal-tamper/` (baseline /
  cheat / honest + `verify.mjs`).

- **`windows-latest` CI job.** `.github/workflows/ci.yml` now runs build + smoke (`node dist/cli.js scan
  demo-repo`) on both `ubuntu-latest` and `windows-latest` via a matrix.

- **Installer targets expanded and made honest (`src/installer/targets.ts`, `src/commands/install.ts`).**
  Antigravity now receives workflow-formatted commands (`description`-only frontmatter + title + steps) in
  both `.agent/workflows/` and `.agents/workflows/`; Kilo Code's home target moved to the current
  `~/.config/kilo/commands/` (`.kilo/commands/` + legacy `.kilocode/workflows/` kept); Codex CLI unchanged.
  The Codex App / VS Code extension is **not** claimed as supported — no file is written, and the install
  summary prints that OpenAI hasn't shipped custom slash commands there (manual copy of the prompt is the
  only option). The install table now reports honest per-tool statuses (✅ Installed / ⚠️ Manual copy needed).

- **Bare `/guardian` now shows a mode menu (Part C).** `templates/guardian.prompt.md` opens with a mandatory
  mode-selection block: when invoked without arguments (or when the placeholder wasn't substituted) the agent
  prints a menu (full loop / `--scan-only` / `--demo` / `--ledger` / `--integrity-only`) and waits; when a
  flag is present in the invocation arguments it skips the menu and enters that mode directly. The
  `$ARGUMENTS` placeholder appears exactly once in the template so tool-side substitution can't corrupt the
  branch conditions (verified live in OpenCode: bare `/guardian` → menu + wait; substituted flag → straight
  into the mode).

### Changed

- **All tool spawning migrated from `child_process` shell strings to `execa` (v10).** `src/analyzers/util.ts`
  now implements `safeExec`/`commandExists` via `execaSync` and the `safeExecShell` helper was removed; every
  shell-style invocation was replaced with argv-based ones: `npm install`/`npm run build`/`npm audit --json`
  (stdout captured directly instead of a shell redirect to a temp file), the per-file Python interpreter
  (`python -c …` with stdin), and the async repro runner in `src/repro/framework.ts`. This removes the last
  places that assumed a POSIX shell (`/dev/null`, `&&`, glob/pipe semantics) on any platform.

- **`src/commands/ci.ts` snapshot now pure-git.** The unix-only `git archive | tar` pipeline was replaced with
  `fetchBaseSnapshot()`: it fetches the base SHA into a temp repo (`git fetch --depth=1 <repo> <sha>`) and
  detached-checkouts `FETCH_HEAD`, so `guardian ci` works on Windows without a `tar` unpacker.

- **CRLF normalization in `src/analyzers/integrity/git.ts`.** Blob/working-tree contents read for `integrity`
  diffing are normalized to `\n` before parsing, so an uncommitted CRLF working-tree edit no longer mangles
  per-line diffs.

### Verified (on real Windows, this session)

Both previously documented bugs were re-run on a real Windows host (Node 22, PowerShell, git for Windows,
`%TEMP%` on an 8.3 short path) and are fixed: the npx `node_modules/.bin` jest shim now fails loudly with the
true `2 failed / 2` suite instead of `jest produced no JSON`, and a `guardian repro` in an 8.3-path temp repo
genuinely `FAIL — bug reproduced` before the fix and `PASS — bug not reproduced` after. The full
`guardian demo → /guardian` loop, `guardian ci` (base-branch snapshot report), and a `guardian/*` branch
round-trip were also exercised on Windows.