import type { FileChange, IntegrityFinding, IntegrityReport, Verdict } from "../analyzers/integrity/types.js";
import { runDetectors } from "../analyzers/integrity/index.js";

/**
 * Combine all detector output into a single integrity report with an overall
 * verdict.
 *
 * CALIBRATION (the contract that keeps this feature trustworthy):
 *   - CLEAN           : no detector fired.
 *   - SUSPICIOUS      : only "suspicious" findings — human judgment required,
 *                       NEVER auto-blocked.
 *   - CONFIRMED_CHEAT : at least one "confirmed" finding — auto-blocked, because
 *                       the pattern is unambiguous (whole test file deleted, a
 *                       whole test-case block removed, or process.exit(0) added
 *                       inside application code).
 *
 * Everything that is merely suggestive stays "suspicious" so a legitimate
 * refactor that updates a test (because the spec changed) surfaces with full
 * evidence for a human to judge — it is never silently reverted.
 */
export function buildIntegrityReport(
  repo: string,
  from: string,
  to: string,
  changes: FileChange[],
): IntegrityReport {
  const findings: IntegrityFinding[] = runDetectors(changes);

  const confirmed = findings.filter((f) => f.confidence === "confirmed").length;
  const suspicious = findings.filter((f) => f.confidence === "suspicious").length;

  let verdict: Verdict = "CLEAN";
  if (confirmed > 0) verdict = "CONFIRMED_CHEAT";
  else if (suspicious > 0) verdict = "SUSPICIOUS";

  return {
    timestamp: new Date().toISOString(),
    repo,
    from,
    to,
    verdict,
    findings,
    summary: { confirmed, suspicious, total: findings.length },
  };
}

export { runDetectors };
export type { IntegrityReport, Verdict, IntegrityFinding };
