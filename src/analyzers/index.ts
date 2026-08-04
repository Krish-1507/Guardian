import { analyzeDependencyGraph } from "./dependencyGraph.js";
import { analyzeSecurity } from "./security.js";
import { analyzeDuplication } from "./duplication.js";
import { analyzeTests } from "./tests.js";
import { analyzePerf } from "./perf.js";
import { analyzeAccessibility } from "./accessibility.js";
import { analyzeReliability } from "./reliability.js";
import { analyzeDevex } from "./devex.js";
import { detectLanguage } from "./util.js";
import type { ScanResult } from "./types.js";

export function runAllAnalyzers(repo: string): ScanResult {
  return {
    timestamp: new Date().toISOString(),
    repo,
    language: detectLanguage(repo),
    dependencyGraph: analyzeDependencyGraph(repo),
    security: analyzeSecurity(repo),
    duplication: analyzeDuplication(repo),
    tests: analyzeTests(repo),
    perf: analyzePerf(repo),
    accessibility: analyzeAccessibility(repo),
    reliability: analyzeReliability(repo),
    devex: analyzeDevex(repo),
    clusters: [],
  };
}
