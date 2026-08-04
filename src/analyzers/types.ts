export interface ScanIssue {
  type: string;
  severity: string;
  file?: string;
  line?: number;
  description: string;
}

export interface DependencyGraphResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  engine?: string;
  files: number;
  circular: string[][];
  mostDependedOn: { file: string; count: number }[];
  orphans: string[];
}

export interface SecurityResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  issues: ScanIssue[];
}

export interface DuplicationResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  cloneCount: number;
  clones: { files: string[]; lines: number }[];
}

export interface TestsResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  framework?: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  coverage?: number;
}

export interface PerfResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  buildTimeMs?: number;
  bundleSizeBytes?: number;
}

export interface AccessibilityResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  /** Which detector produced the findings. */
  engine?: "pa11y" | "axe" | "static-jsx";
  checked?: { type: "html" | "jsx"; count: number };
  issues: ScanIssue[];
}

export interface FlakyTest {
  name: string;
  file?: string;
  /** Outcome per sequential run (length === runs). */
  statuses: ("passed" | "failed")[];
}

export interface ReliabilityResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  /** How many sequential suite runs were executed (1 if skipped after timing). */
  runs: number;
  /** Wall-clock total across all runs. */
  durationMs: number;
  /** Duration of the first (timing) run. */
  suiteDurationMs?: number;
  flakyTests: FlakyTest[];
  /** Timer/state race-condition heuristics — never certain, always labeled. */
  raceSmells: ScanIssue[];
}

export interface DuplicateFunction {
  /** Function name when identical, else "<unnamed>". */
  name: string;
  files: { file: string; line: number }[];
  /** Source lines of the body. */
  lines: number;
  /** Dice similarity of normalized token streams, 0..1. */
  similarity: number;
}

export interface DevexResult {
  status: "ok" | "skipped" | "error";
  note?: string;
  unusedExports: ScanIssue[];
  duplicateFunctions: DuplicateFunction[];
}

export interface ClusterFinding {
  source: "security" | "duplication" | "graph" | "a11y" | "reliability" | "devex";
  severity: string;
  type: string;
  description: string;
  files: string[];
}

export interface Cluster {
  rootCause: ClusterFinding;
  symptoms: ClusterFinding[];
  sharedFiles: string[];
  size: number;
}

export interface ScanResult {
  timestamp: string;
  repo: string;
  language: "js" | "python" | "unknown";
  dependencyGraph: DependencyGraphResult;
  security: SecurityResult;
  duplication: DuplicationResult;
  tests: TestsResult;
  perf: PerfResult;
  accessibility: AccessibilityResult;
  reliability: ReliabilityResult;
  devex: DevexResult;
  clusters: Cluster[];
}
