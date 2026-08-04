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
import type { VerifyMetrics } from "../report/format.js";
import { classifyRisk, deltasOf, metricsOf } from "../verify/metrics.js";

function readBaseline(repo: string): ScanResult | null {
  const p = path.join(repo, ".guardian", "scan-latest.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ScanResult;
  } catch {
    return null;
  }
}

function currentMetrics(repo: string): VerifyMetrics {
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
    const d = deltasOf(baseline, current);

    const risk = classifyRisk(baseline, current, d);

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
