# Guardian — the 4-minute feature tour

A scripted, deterministic runbook for showing off Guardian's headline features.
Every command below is real output — nothing is pre-recorded. Aimed at a
screen-recording session (OBS, Xbox Game Bar `Win+G`, or an agentic IDE that
records itself).

Prep (once, before recording): warm the npm cache so the recording is smooth.

```bash
npx cli-guardian demo
```

Note the **finding ids** from the boxed report (e.g. `security-19c390c6`) and
the printed **demo repo path** (`cd C:\Users\...\Temp\guardian-demo-XXXX`) —
you'll use both in the shots below.

## The shots

| # | Time | Command (run inside the demo dir unless noted) | What the viewer sees |
|---|---|---|---|
| 1 | 0:00–0:30 | `npx cli-guardian demo` | A real broken repo appears and gets scanned instantly: Guardian Score, circular dep, known-CVE, failing tests, hardcoded secret — every finding has an id. |
| 2 | 0:30–0:45 | `npx cli-guardian verify` | The Δ table: score row, integrity gate CLEAN. Every iteration is measured. |
| 3 | 0:45–1:00 | `npx cli-guardian trends` | Sparklines across scan history. |
| 4 | 1:00–1:15 | `npx cli-guardian inspect security-19c390c6` | Deep-dive: finding, code context, cluster, next step. |
| 5 | 1:15–1:35 | `npx cli-guardian repro security-19c390c6` | A permanent regression test is written and **FAILS** while the bug is live — the contract. |
| 6 | 1:35–2:35 | `npx cli-guardian pen --fix` | The pen test: app boots under the sandbox, real attacks fire, findings carry **runtime-proof verdicts** (proven / indicated / unproven); repro tests + deterministic patches written. |
| 7 | 2:35–3:00 | `npx cli-guardian report --html` then `npx cli-guardian share` | `GUARDIAN_REPORT.html` + badge, then the 1200×630 share card. |
| 8 | 3:00–3:15 | `npx cli-guardian honesty --html` | The AI-honesty certificate: evidence chain + gate history → one verdict. |
| 9 | 3:15–3:40 | `npx cli-guardian watch` — then delete the `API_KEY` line in `src/config.js` and save | The live shield prints a score delta within ~12 s. Stop watch (Ctrl+C). |
| 10 | 3:40–4:00 | `cd <your project>` → `npx cli-guardian try .` | The closer: two seconds, your repo, your score. |

## Narration (one line per shot)

1. "One command, a real broken repo, honest numbers — every finding has an id."
2. "Every iteration is measured — here's the score delta and the integrity gate."
3. "Trends show the loop actually improving the repo."
4. "Every finding opens up to the exact code and context."
5. "Every fix starts with a failing repro — that's the contract."
6. "A real penetration test: the app is booted and attacked, and every finding carries its proof."
7. "The receipts — a self-contained HTML report and a share card."
8. "And the honesty certificate: evidence chain, gate history, one verdict."
9. "The live shield — watch the score move as I edit."
10. "Zero setup on your own repo. Go try it on yours."

## Rules

- All output must be real. If a command errors, fix the cause and re-run — never skip silently.
- `skipped` categories (jscpd, gitleaks, pa11y not installed) are honest-by-design — leave them on screen.
- Never run `guardian install` during the tour (it writes into tool configs).
- Dark terminal, maximized, no other windows.
