# Guardian — the 2-minute demo (judge's script)

This is the story: **your AI agent finally has a referee it can't cheat.**
Every command below is real, deterministic output — nothing is pre-recorded.

Total time: ~2 minutes. You need Node 22+ and git. No AI tool required.

---

## Act 1 — a broken repo, scored honestly (0:00–0:40)

```bash
npx cli-guardian demo
```

Guardian copies an intentionally-broken app into a temp dir and scans it
immediately. You get the boxed report: circular dependency, known-CVE
dependency, failing tests, a hardcoded secret — each with its own finding id.

Then point it at a repo that matters:

```bash
cd <your-project>
npx cli-guardian scan
```

Exit code **0 = clean, 1 = issues found, 2 = suspicious**. That contract is
the whole product: the numbers are sealed, tamper-evident, and can't be
talked into looking better.

## Act 2 — the real penetration test (0:40–1:20)

```bash
npx cli-guardian pen --fix
```

`pen` boots your app's own `start` script inside a sandbox and fires attack
traffic at it: command injection, SSRF, XSS, rate limiting, missing headers.
For each route it records *proof* — the exact request and the app's response.

- Every finding carries a **runtime-proof verdict** — **proven** (the live
  attack confirmed it under the sandbox), **indicated**, **unproven**, or
  **not-tested** — never oversold. The report's summary line says exactly
  how many static findings were proven live, e.g.
  `Static findings verified live: 1 proven · 1 indicated · 3 unproven`.
- `--fix` writes two things:
  - **repro tests** — permanent regression tests that FAIL while the bug is
    live (that's the contract, by design);
  - **deterministic patches** for what's provably safe to auto-generate
    (missing `helmet()`, `x-powered-by` leaks) — every patch passes
    `git apply --check` (regression-tested in CI).

## Act 3 — the agent fixes it, and we verify it didn't fake it (1:20–2:00)

```bash
npx cli-guardian repro <finding-id>   # FAILS first — the bug is real
npx cli-guardian drive <finding-id>   # hands it to YOUR agent (claude/codex/...)
```

`drive` writes the mission prompt itself: *run the repro, it must FAIL, fix
the root cause, re-run it, it must PASS, don't break anything.* Then Guardian
verifies the result — not the agent's claims:

- the **repro test** must flip FAIL → PASS;
- `guardian verify` diffs the change against the signed baseline and flags
  deleted tests, swallowed errors, hardcoded-to-pass values — the classic
  agent-cheat patterns.

```bash
npx cli-guardian verify   # VERIFIED / NOT VERIFIED — no grey
```

## The one-liner pitch

> Agents fix code; they don't know when to stop, and they'll tell you they're
> done regardless. Guardian is the honest referee: deterministic scans,
> tamper-evident baselines, runtime penetration tests with failing-first
> regression contracts, and a verification gate that catches the agent lying.
> The CLI measures; the agent edits; the numbers can't be cheated.

## If they want depth

- `npx cli-guardian install` — registers the `/guardian` slash command in
  Claude Code, Cursor, OpenCode, Codex CLI, Gemini CLI.
- `npx cli-guardian honesty` — the evidence report: every number traced to a
  sealed file.
- `guardian gate` / `guardian ci` — the same contract as a CI gate.
- `node scripts/cheat-demo.cjs` — the 90-second cheat-catch demo: a scripted
  arc where a lazy agent focuses the suite on the passing tests (gate blocks,
  exit 1) then deletes the failing test (gate blocks, exit 2) — the
  tamper-evident baseline verifies the whole way. Point it at a local build
  with `GUARDIAN_CLI="node /path/to/dist/cli.js"`.
- `npx cli-guardian watch` / `ready-check` / `budget` — the token economy
  that keeps the agent loop cheap (reuse sealed baselines, skip waste).
- `docs/` — this repo's CI runs the patch-validity + evidence regression
  suites on Linux and Windows on every push.
