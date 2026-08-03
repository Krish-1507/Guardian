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

export interface ScanResult {
  timestamp: string;
  repo: string;
  language: "js" | "python" | "unknown";
  dependencyGraph: DependencyGraphResult;
  security: SecurityResult;
  duplication: DuplicationResult;
  tests: TestsResult;
  perf: PerfResult;
}
