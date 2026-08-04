import type { ScanResult } from "../analyzers/types.js";
import type { VerifyMetrics, VerifyReport } from "../report/format.js";

export type Delta = VerifyReport["deltas"];

/** Collapse a ScanResult into the compact metric shape used for diffs. */
export function metricsOf(r: ScanResult): VerifyMetrics {
  return {
    tests: {
      total: r.tests.total,
      passed: r.tests.passed,
      failed: r.tests.failed,
      durationMs: r.tests.durationMs,
      coverage: r.tests.coverage,
    },
    perf: {
      buildTimeMs: r.perf.buildTimeMs,
      bundleSizeBytes: r.perf.bundleSizeBytes,
    },
    securityCount: r.security.issues.length,
    duplicationCount: r.duplication.cloneCount,
  };
}

export function deltasOf(base: VerifyMetrics, current: VerifyMetrics): Delta {
  return {
    passed: current.tests.passed - base.tests.passed,
    failed: current.tests.failed - base.tests.failed,
    durationMs: current.tests.durationMs - base.tests.durationMs,
    coverage: (current.tests.coverage ?? 0) - (base.tests.coverage ?? 0),
    buildTimeMs: (current.perf.buildTimeMs ?? 0) - (base.perf.buildTimeMs ?? 0),
    bundleSizeBytes: (current.perf.bundleSizeBytes ?? 0) - (base.perf.bundleSizeBytes ?? 0),
    security: current.securityCount - base.securityCount,
    duplication: current.duplicationCount - base.duplicationCount,
  };
}

/**
 * Bundle size is stable across runs, so a >10% relative change is meaningful.
 * Build time is noisy at small absolute values; only treat as a regression when
 * the baseline is large enough for a relative % to be trustworthy.
 */
export function perfRegressed(
  base: VerifyMetrics["perf"],
  current: VerifyMetrics["perf"],
): boolean {
  const bb = base.bundleSizeBytes ?? 0;
  const cb = current.bundleSizeBytes ?? 0;
  const bt = base.buildTimeMs ?? 0;
  const ct = current.buildTimeMs ?? 0;
  if (bb > 0 && (cb - bb) / bb > 0.1) return true;
  if (bt >= 500 && (ct - bt) / bt > 0.1) return true;
  return false;
}

export function classifyRisk(
  base: VerifyMetrics,
  current: VerifyMetrics,
  d: Delta,
): VerifyReport["risk"] {
  const testsNewlyFail = current.tests.failed > base.tests.failed && current.tests.failed > 0;
  if (testsNewlyFail || perfRegressed(base.perf, current.perf)) return "High";
  // Build time is noisy at small absolute values; ignore sub-50ms deltas
  // when classifying risk so a re-run doesn't look like a regression.
  const buildDelta = Math.abs(d.buildTimeMs) > 50 ? d.buildTimeMs : 0;
  const changed =
    d.passed !== 0 ||
    d.failed !== 0 ||
    d.durationMs !== 0 ||
    d.coverage !== 0 ||
    buildDelta !== 0 ||
    d.bundleSizeBytes !== 0 ||
    d.security !== 0 ||
    d.duplication !== 0;
  const improved =
    d.failed < 0 ||
    d.passed > 0 ||
    d.durationMs < 0 ||
    d.coverage > 0 ||
    buildDelta < 0 ||
    d.bundleSizeBytes < 0 ||
    d.security < 0 ||
    d.duplication < 0;
  return !changed || improved ? "Low" : "Medium";
}