import type { FileChange, IntegrityFinding } from "./types.js";

/**
 * suppressionCreep — grep added lines for newly introduced suppression markers.
 *
 * SUSPICIOUS ONLY (never CONFIRMED): a suppression comment might be a legitimate,
 * documented workaround or a locally-acknowledged false positive. A human must
 * judge whether it's hiding a real problem.
 */

const SUPPRESSION_RE =
  /\b(eslint-disable|eslint-disable-next-line|eslint-disable-line|@ts-ignore|ts-ignore|ts-nocheck|ts-expect-error|nolint|noqa|type:\s*ignore|SuppressWarnings)\b/i;

export function detectSuppressionCreep(changes: FileChange[]): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const c of changes) {
    for (const a of c.added) {
      if (SUPPRESSION_RE.test(a.text)) {
        findings.push({
          detector: "suppressionCreep",
          pattern: "suppression-comment-added",
          confidence: "suspicious",
          file: c.path,
          line: a.line,
          evidence: `newly added suppression marker: ${a.text.trim()}`,
        });
      }
    }
  }
  return findings;
}
