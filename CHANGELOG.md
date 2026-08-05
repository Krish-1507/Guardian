# Changelog

All notable changes to this project are documented here.

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