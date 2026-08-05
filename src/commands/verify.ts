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
import { newestModifiedFile } from "../analyzers/util.js";
import type { ScanResult, ScanIssue } from "../analyzers/types.js";
import type { VerifyMetrics } from "../report/format.js";
import { classifyRisk, deltasOf, metricsOf } from "../verify/metrics.js";
import { computeScore, type ScoreResult } from "../report/score.js";
import { getDiff } from "../analyzers/integrity/git.js";
import { buildIntegrityReport } from "../graph/integrity.js";
import type { IntegrityFinding, Verdict } from "../analyzers/integrity/types.js";

interface IntegrityGate {
  verdict: Verdict;
  findings: IntegrityFinding[];
  summary: { confirmed: number; suspicious: number; total: number };
}

/**
 * Every verify run doubles as an integrity gate: it diffs the working tree
 * against the last commit (HEAD) and runs the AI-agent-cheat detectors. A
 * SUSPICIOUS or CONFIRMED_CHEAT verdict BLOCKS the change regardless of test
 * or perf numbers.
 */
function integrityGate(repo: string): IntegrityGate {
  const changes = getDiff(repo, "HEAD");
  const report = buildIntegrityReport(repo, "HEAD", "working tree", changes);
  return { verdict: report.verdict, findings: report.findings, summary: report.summary };
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

async function currentMetrics(repo: string): Promise<VerifyMetrics> {
  const [tests, perf, security, duplication] = await Promise.all([
    analyzeTests(repo),
    analyzePerf(repo),
    analyzeSecurity(repo),
    analyzeDuplication(repo),
  ]);
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

/**
 * Verify re-measures only the fast metrics (tests/perf/security/dup), so the
 * "current" Guardian Score is computed from the last scan with exactly those
 * categories patched in — the other categories keep their scan snapshot.
 */
function currentScoreOf(
  baselineResult: ScanResult,
  current: VerifyMetrics,
  integrityPenalty: number,
): ScoreResult {
  // Only patch categories that actually ran in the baseline scan; a category
  // that printed "skipped" must stay skipped on both sides of the delta,
  // otherwise the score could move for purely toolchain reasons.
  const hybrid: ScanResult = { ...baselineResult };
  if (hybrid.tests.status === "ok") {
    hybrid.tests = {
      status: "ok",
      total: current.tests.total,
      passed: current.tests.passed,
      failed: current.tests.failed,
      durationMs: current.tests.durationMs,
      coverage: current.tests.coverage,
    };
  }
  if (hybrid.perf.status === "ok") {
    hybrid.perf = {
      status: "ok",
      buildTimeMs: current.perf.buildTimeMs,
      bundleSizeBytes: current.perf.bundleSizeBytes,
    };
  }
  if (hybrid.security.status === "ok") {
    const synthetic: ScanIssue[] = Array.from({ length: current.securityCount }, () => ({
      type: "security",
      severity: "high",
      description: "current security findings (from verify)",
    }));
    hybrid.security = { status: "ok", issues: synthetic };
  }
  if (hybrid.duplication.status === "ok") {
    hybrid.duplication = { status: "ok", cloneCount: current.duplicationCount, clones: [] };
  }
  return computeScore(hybrid, { integrityPenalty });
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
  .description(
    "Re-run tests/perf, diff against the last scan baseline, AND gate on the integrity diff since HEAD — " +
      "SUSPICIOUS/CONFIRMED_CHEAT verifies exit 1/2 with 'BLOCKED — integrity violation'.",
  )
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
    const current = await currentMetrics(repo);
    const d = deltasOf(baseline, current);

    // Baseline staleness: if files changed after the baseline scan, the delta
    // and score are computed against a snapshot that no longer matches the
    // working tree — warn loudly instead of silently presenting stale math.
    let staleNote = "";
    const newest = newestModifiedFile(repo);
    const baselineAt = Date.parse(baselineResult.timestamp);
    if (newest && baselineAt && newest.mtimeMs > baselineAt + 1000) {
      const relFile = path.relative(repo, newest.file) || newest.file;
      staleNote =
        `baseline is STALE — ${relFile} changed ${new Date(newest.mtimeMs).toISOString()}, ` +
        `after the baseline scan (${baselineResult.timestamp}). Score delta vs baseline is ` +
        "approximate; re-run `guardian scan` for a fresh baseline.";
    }
    const stale = staleNote !== "";

    const risk = classifyRisk(baseline, current, d);

    // Integrity gate — runs automatically on every verify, gating the commit.
    const integrity = integrityGate(repo);
    const blocked =
      integrity.verdict === "SUSPICIOUS" || integrity.verdict === "CONFIRMED_CHEAT";
    const integrityPenalty = blocked
      ? integrity.verdict === "CONFIRMED_CHEAT"
        ? 25
        : 10
      : 0;

    const baselineScore = computeScore(baselineResult);
    const currentScore = currentScoreOf(baselineResult, current, integrityPenalty);
    const scoreDelta = currentScore.score - baselineScore.score;

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
    row(
      "Guardian score",
      `${baselineScore.score}/100 (${baselineScore.grade})`,
      `${currentScore.score}/100 (${currentScore.grade})`,
      scoreDelta,
      scoreDelta > 0 ? `+${scoreDelta} pts` : `${scoreDelta} pts`,
      true,
    );

    const riskColor = risk === "High" ? chalk.red : risk === "Medium" ? chalk.yellow : chalk.green;
    let riskLine: string;
    if (blocked) {
      riskLine = `${chalk.bold("Regression risk:")} ${chalk.red("BLOCKED — integrity violation")} (${integrity.verdict})`;
    } else {
      riskLine = `${chalk.bold("Regression risk:")} ${riskColor(risk.toUpperCase())}`;
    }

    const integrityParts: string[] = [];
    if (blocked) {
      integrityParts.push(
        chalk.red(
          `${chalk.bold("Integrity gate:")} ${integrity.verdict} — ` +
            `${integrity.summary.confirmed} confirmed · ${integrity.summary.suspicious} suspicious`,
        ),
      );
      for (const f of integrity.findings) {
        const tag =
          f.confidence === "confirmed" ? chalk.red("CONFIRMED") : chalk.yellow("SUSPICIOUS");
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        integrityParts.push(
          `  ${tag} ${chalk.bold(f.detector)} / ${f.pattern} @ ${chalk.cyan(loc)}`,
          `    ${f.evidence}`,
        );
      }
    }

    const contentParts: string[] = [];
    if (stale) {
      contentParts.push(chalk.yellow(`⚠ ${staleNote}`), "");
    }
    contentParts.push(...integrityParts, riskLine);
    contentParts.push("", table.toString());
    const content = contentParts.join("\n");

    const boxColor = blocked ? "red" : risk === "High" ? "red" : risk === "Medium" ? "yellow" : "green";

    console.log(
      boxen(content, {
        title: " GUARDIAN — Verify ",
        titleAlignment: "center",
        borderStyle: "double",
        padding: 1,
        borderColor: boxColor,
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
      blocked,
      stale,
      staleNote: stale ? staleNote : undefined,
      status: blocked ? "BLOCKED" : "OK",
      exitCode: blocked
        ? integrity.verdict === "CONFIRMED_CHEAT"
          ? 2
          : 1
        : risk === "High"
          ? 1
          : 0,
      integrity,
      deltas: d,
      baseline,
      current,
      score: {
        baseline: baselineScore.score,
        current: currentScore.score,
        delta: scoreDelta,
        grade: currentScore.grade,
      },
    };
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    const summary = blocked
      ? `verify BLOCKED (integrity ${integrity.verdict})`
      : `verify ${risk}: score ${currentScore.score}/100 (${currentScore.grade}) · tests ${signed(d.failed)} fail, bundle ${deltaBytes(d.bundleSizeBytes)}, security ${signed(d.security)}`;
    addEntry(repo, {
      type: "fix",
      summary,
      context: `verify against baseline ${baselineResult.timestamp} — integrity ${integrity.verdict}`,
    });

    console.log(chalk.dim(`\nReport written to ${file}\n`));

    process.exitCode = blocked
      ? integrity.verdict === "CONFIRMED_CHEAT"
        ? 2
        : 1
      : risk === "High"
        ? 1
        : 0;
  });
