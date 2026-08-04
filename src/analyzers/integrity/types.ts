/**
 * Shared types for the diff-scoped integrity (AI-agent-cheat) detectors.
 *
 * CALIBRATION (enforced in logic + comments throughout this folder):
 *   - `confidence: "confirmed"` is reserved for truly unambiguous patterns
 *     ONLY: a whole test file deleted, a whole test-case block removed, or a
 *     `process.exit(0)` / `sys.exit(0)` / `os._exit(0)` added inside app code.
 *   - Everything else is at most `"suspicious"` — it needs human judgment and
 *     must NEVER auto-block. A legitimate refactor that updates a test because
 *     the spec changed must surface with evidence, not get silently reverted.
 */

export type Confidence = "confirmed" | "suspicious";

export interface IntegrityFinding {
  /** Detector name, e.g. "testTamper". */
  detector: string;
  /** Short pattern name, e.g. "test-file-deleted". */
  pattern: string;
  confidence: Confidence;
  /** Primary file (relative path). */
  file: string;
  /** 1-based line in that file (when known). */
  line?: number;
  /** Human-readable evidence / explanation. */
  evidence: string;
  /** Optional second location (used by hardcodedMatch cross-reference). */
  file2?: string;
  line2?: number;
}

/** One changed line with its 1-based line number in the relevant file version. */
export interface DiffLine {
  line: number;
  text: string;
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

/**
 * A single file's change, scoped from a git diff. `before` is the content at
 * the `from` ref (undefined when the file was added); `after` is the content at
 * the `to` ref / working tree (undefined when deleted). `added` / `removed` are
 * the exact + / - lines with their line numbers in `after` / `before`.
 */
export interface FileChange {
  path: string;
  status: FileStatus;
  before?: string;
  after?: string;
  added: DiffLine[];
  removed: DiffLine[];
  language: "js" | "ts" | "python" | "unknown";
}

export type Verdict = "CLEAN" | "SUSPICIOUS" | "CONFIRMED_CHEAT";

export interface IntegrityReport {
  timestamp: string;
  repo: string;
  from: string;
  to: string;
  verdict: Verdict;
  findings: IntegrityFinding[];
  summary: { confirmed: number; suspicious: number; total: number };
}
