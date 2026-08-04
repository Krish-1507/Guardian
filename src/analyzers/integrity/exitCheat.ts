import type { FileChange, IntegrityFinding } from "./types.js";
import { isAppCode } from "./helpers.js";

/**
 * exitCheat — a `process.exit(0)` / `sys.exit(0)` / `os._exit(0)` added inside
 * application code is the one unambiguous cheat: it can force a "success" exit
 * to hide a failing run. CLI entrypoints and test-runner configs are excluded
 * because `process.exit(0)` is legitimate there.
 *
 * CONFIRMED (unambiguous, auto-block) — but only for exit(0) with no context.
 */
const EXIT_CHEAT_RE = /\b(?:process\.exit|sys\.exit|os\._exit)\s*\(\s*0\s*\)/;

export function detectExitCheat(changes: FileChange[]): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const c of changes) {
    if (!isAppCode(c.path)) continue;
    for (const a of c.added) {
      if (EXIT_CHEAT_RE.test(a.text)) {
        findings.push({
          detector: "exitCheat",
          pattern: "process-exit-0-in-app-code",
          confidence: "confirmed",
          file: c.path,
          line: a.line,
          evidence: `added ${a.text.trim().split(/\s+/)[0].split("(")[0]}(0) in application code — forces a success exit to hide failure`,
        });
      }
    }
  }
  return findings;
}
