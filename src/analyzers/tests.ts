import fs from "node:fs";
import path from "node:path";
import { commandExists, detectLanguage, safeExec } from "./util.js";
import type { TestsResult } from "./types.js";

export function analyzeTests(repo: string): TestsResult {
  const lang = detectLanguage(repo);
  const empty: TestsResult = {
    status: "skipped",
    note: "no test framework detected",
    total: 0,
    passed: 0,
    failed: 0,
    durationMs: 0,
  };

  if (lang === "python") {
    if (!commandExists("pytest")) return empty;
    const start = performance.now();
    const r = safeExec("pytest", ["-q"], repo, 180000);
    const durationMs = Math.round(performance.now() - start);
    const m = r.stdout.match(/(\d+)\s+passed/);
    const failed = r.stdout.match(/(\d+)\s+failed/);
    const total = (m ? Number(m[1]) : 0) + (failed ? Number(failed[1]) : 0);
    return {
      status: "ok",
      framework: "pytest",
      total,
      passed: m ? Number(m[1]) : 0,
      failed: failed ? Number(failed[1]) : 0,
      durationMs,
    };
  }

  // JS/TS
  const pkgPath = path.join(repo, "package.json");
  let pkg: any = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      pkg = {};
    }
  }
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  const hasJest =
    !!deps.jest ||
    fs.existsSync(path.join(repo, "jest.config.js")) ||
    fs.existsSync(path.join(repo, "jest.config.ts"));
  const hasVitest = !!deps.vitest || fs.existsSync(path.join(repo, "vitest.config.ts"));

  if (hasJest && commandExists("jest")) {
    return runJest(repo);
  }
  if (hasVitest && commandExists("vitest")) {
    return runVitest(repo);
  }
  return empty;
}

function runJest(repo: string): TestsResult {
  const start = performance.now();
  const r = safeExec(
    "jest",
    ["--json", "--coverage", "--coverageReporters=json-summary"],
    repo,
    180000,
  );
  const durationMs = Math.round(performance.now() - start);
  let json: any;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    return {
      status: "error",
      note: "jest produced no JSON",
      framework: "jest",
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
    };
  }
  let coverage: number | undefined;
  const summary = path.join(repo, "coverage", "coverage-summary.json");
  if (fs.existsSync(summary)) {
    try {
      const c = JSON.parse(fs.readFileSync(summary, "utf8"));
      coverage = c.total?.lines?.pct;
    } catch {
      /* ignore */
    }
  }
  return {
    status: "ok",
    framework: "jest",
    total: json.numTotalTests ?? 0,
    passed: json.numPassedTests ?? 0,
    failed: json.numFailedTests ?? 0,
    durationMs,
    coverage,
  };
}

function runVitest(repo: string): TestsResult {
  const tmp = path.join(repo, ".guardian", "vitest-report.json");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const start = performance.now();
  const r = safeExec(
    "vitest",
    ["run", "--reporter=json", "--outputFile", tmp],
    repo,
    180000,
  );
  const durationMs = Math.round(performance.now() - start);
  let json: any;
  if (fs.existsSync(tmp)) {
    try {
      json = JSON.parse(fs.readFileSync(tmp, "utf8"));
    } catch {
      json = undefined;
    }
  }
  if (!json) {
    return {
      status: "error",
      note: "vitest produced no JSON",
      framework: "vitest",
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
    };
  }
  const files = json.testResults ?? [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  for (const f of files) {
    total += f.assertionResults?.length ?? 0;
    for (const a of f.assertionResults ?? []) {
      if (a.status === "passed") passed++;
      else if (a.status === "failed") failed++;
    }
  }
  return {
    status: "ok",
    framework: "vitest",
    total,
    passed,
    failed,
    durationMs,
  };
}
