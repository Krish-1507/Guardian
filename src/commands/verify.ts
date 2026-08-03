import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import Table from "cli-table3";
import path from "node:path";
import fs from "node:fs";
import { analyzeTests } from "../analyzers/tests.js";
import { analyzePerf } from "../analyzers/perf.js";
import { analyzeSecurity } from "../analyzers/security.js";
import { analyzeDuplication } from "../analyzers/duplication.js";
import { addEntry } from "../memory/store.js";
import type { ScanResult } from "../analyzers/types.js";

interface Metrics {
  tests: {
    total: number;
    passed: number;
    failed: number;
    durationMs: number;
    coverage?: number;
  };
  perf: {
    buildTimeMs?: number;
    bundleSizeBytes?: number;
  };
  securityCount: number;
  duplicationCount: number;
}

function readBaseline(repo: string): ScanResult | null {
  const p = path.join(repo, ".guardian", "scan-latest.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ScanResult;
  } catch {
    return null;
  }
}

function metricsOf(r: ScanResult): Metrics {
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

function currentMetrics(repo: string): Metrics {
  const tests = analyzeTests(repo);
  const perf = analyzePerf(repo);
  const security = analyzeSecurity(repo);
  const duplication = analyzeDuplication(repo);
  return {
    tests: {
      total: tests.total,
      passed: tests.passed,
      failed: tests.failed,
      durationMs: tests.durationMs,
      coverage: tests.coverage,
    },
    perf: {
      buildTimeMs: perf.buildTimeMs,
      bundleSizeBytes: perf.bundleSizeBytes,
    },
    securityCount: security.issues.length,
    duplicationCount: duplication.cloneCount,
  };
}

function perfRegressed(b: Metrics["perf"], c: Metrics["perf"]): boolean {
  const bb = b.bundleSizeBytes ?? 0;
  const cb = c.bundleSizeBytes ?? 0;
  const bt = b.buildTimeMs ?? 0;
  const ct = c.buildTimeMs ?? 0;
  // Bundle size is stable across runs, so a >10% relative change is meaningful.
  if (bb > 0 && (cb - bb) / bb > 0.1) return true;
  // Build time is noisy at small absolute values; only treat as a regression
  // when the baseline is large enough for a relative % to be trustworthy.
  if (bt >= 500 && (ct - bt) / bt > 0.1) return true;
  return false;
}

function fmtBundle(b?: number): string {
  return b == null ? "—" : `${(b / 1024).toFixed(1)} KB`;
}
function fmtMs(n?: number): string {
  return n == null ? "—" : `${n} ms`;
}
function fmtPct(n?: number): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
function deltaBytes(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${(n / 1024).toFixed(1)} KB`;
}
function deltaMs(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${n} ms`;
}
function deltaPct(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export const verify = new Command("verify")
  .description("Re-run tests/perf and diff against the last scan baseline")
  .argument("[repo]", "path to the repo to verify", ".")
  .action(async (repoArg: string) => {
    const repo = path.resolve(repoArg);
    console.log(chalk.cyan(`\nVerifying ${repo} ...\n`));

    const baselineResult = readBaseline(repo);
    if (!baselineResult) {
      console.log(
        chalk.red("no baseline found — run `guardian scan` first to create .guardian/scan-latest.json"),
      );
      process.exitCode = 1;
      return;
    }
    const baseline = metricsOf(baselineResult);
    const current = currentMetrics(repo);

    const d = {
      passed: current.tests.passed - baseline.tests.passed,
      failed: current.tests.failed - baseline.tests.failed,
      durationMs: current.tests.durationMs - baseline.tests.durationMs,
      coverage: (current.tests.coverage ?? 0) - (baseline.tests.coverage ?? 0),
      buildTimeMs: (current.perf.buildTimeMs ?? 0) - (baseline.perf.buildTimeMs ?? 0),
      bundleSizeBytes: (current.perf.bundleSizeBytes ?? 0) - (baseline.perf.bundleSizeBytes ?? 0),
      security: current.securityCount - baseline.securityCount,
      duplication: current.duplicationCount - baseline.duplicationCount,
    };

    const testsNewlyFail = current.tests.failed > baseline.tests.failed && current.tests.failed > 0;
    const regressed = perfRegressed(baseline.perf, current.perf);

    let risk: "High" | "Medium" | "Low";
    if (testsNewlyFail || regressed) {
      risk = "High";
    } else {
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
      risk = !changed || improved ? "Low" : "Medium";
    }

    const table = new Table({
      head: ["Metric", "Baseline", "Current", "Δ"],
      style: { head: ["cyan"], border: [] },
    });

    const row = (
      name: string,
      baseStr: string,
      curStr: string,
      deltaNum: number,
      deltaStr: string,
      higherIsBetter: boolean,
    ) => {
      const col =
        deltaNum === 0
          ? chalk.dim
          : (higherIsBetter ? deltaNum > 0 : deltaNum < 0)
            ? chalk.green
            : chalk.red;
      table.push([chalk.bold(name), baseStr, curStr, col(deltaStr)]);
    };

    row("Tests passed", String(baseline.tests.passed), String(current.tests.passed), d.passed, signed(d.passed), true);
    row("Tests failed", String(baseline.tests.failed), String(current.tests.failed), d.failed, signed(d.failed), false);
    row("Duration", fmtMs(baseline.tests.durationMs), fmtMs(current.tests.durationMs), d.durationMs, deltaMs(d.durationMs), false);
    row(
      "Coverage",
      fmtPct(baseline.tests.coverage),
      fmtPct(current.tests.coverage),
      d.coverage,
      deltaPct(d.coverage),
      true,
    );
    row(
      "Build time",
      fmtMs(baseline.perf.buildTimeMs),
      fmtMs(current.perf.buildTimeMs),
      d.buildTimeMs,
      deltaMs(d.buildTimeMs),
      false,
    );
    row(
      "Bundle size",
      fmtBundle(baseline.perf.bundleSizeBytes),
      fmtBundle(current.perf.bundleSizeBytes),
      d.bundleSizeBytes,
      deltaBytes(d.bundleSizeBytes),
      false,
    );
    row("Security findings", String(baseline.securityCount), String(current.securityCount), d.security, signed(d.security), false);
    row(
      "Duplication clones",
      String(baseline.duplicationCount),
      String(current.duplicationCount),
      d.duplication,
      signed(d.duplication),
      false,
    );

    const riskColor = risk === "High" ? chalk.red : risk === "Medium" ? chalk.yellow : chalk.green;
    const riskLine = `${chalk.bold("Regression risk:")} ${riskColor(risk.toUpperCase())}`;
    const content = `${riskLine}\n\n${table.toString()}`;

    console.log(
      boxen(content, {
        title: " GUARDIAN — Verify ",
        titleAlignment: "center",
        borderStyle: "double",
        padding: 1,
        borderColor: risk === "High" ? "red" : risk === "Medium" ? "yellow" : "green",
      }),
    );

    const outDir = path.join(repo, ".guardian");
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(outDir, `verify-${ts}.json`);
    const report = {
      timestamp: new Date().toISOString(),
      repo,
      baselineTimestamp: baselineResult.timestamp,
      risk,
      exitCode: risk === "High" ? 1 : 0,
      deltas: d,
      baseline,
      current,
    };
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    const summary = `verify ${risk}: tests ${signed(d.failed)} fail, bundle ${deltaBytes(d.bundleSizeBytes)}, security ${signed(d.security)}`;
    addEntry(repo, {
      type: "fix",
      summary,
      context: `verify against baseline ${baselineResult.timestamp}`,
    });

    console.log(chalk.dim(`\nReport written to ${file}\n`));

    process.exitCode = risk === "High" ? 1 : 0;
  });
