import { Command } from "commander";
import chalk, { type ChalkInstance } from "chalk";
import boxen from "boxen";
import ora from "ora";
import path from "node:path";
import fs from "node:fs";
import { runAllAnalyzers } from "../analyzers/index.js";
import { runLedgerAnalyzer } from "../analyzers/ledger/index.js";
import { correlate } from "../graph/correlate.js";
import { relevantEntriesForFiles, type MemoryType } from "../memory/store.js";
import { stampFindings, findingIdFor } from "../repro/ids.js";
import { computeScore, type ScoreResult } from "../report/score.js";
import type { ScanResult } from "../analyzers/types.js";

function memTypeColor(t: MemoryType): (s: string) => string {
  switch (t) {
    case "decision":
      return chalk.cyan;
    case "fix":
      return chalk.green;
    case "rejection":
      return chalk.red;
  }
}

function rel(repo: string, p?: string): string {
  return p ? path.relative(repo, p) : "";
}

function label(text: string): string {
  return chalk.bold(text.padEnd(17));
}

function scorePaint(s: ScoreResult): ChalkInstance {
  switch (s.grade[0]) {
    case "A": return chalk.greenBright;
    case "B":
    case "C": return chalk.yellow;
    default: return chalk.red;
  }
}

export function renderBox(r: ScanResult): string {
  const lines: string[] = [];

  const sc = computeScore(r);
  const paint = scorePaint(sc);
  const skippedHint =
    sc.analyzed < sc.total ? chalk.dim(` · ${sc.total - sc.analyzed} skipped`) : "";
  lines.push(
    `${label("Guardian Score")}: ${paint.bold(`${sc.score}/100 (${sc.grade})`)}${skippedHint}`,
  );
  lines.push("");

  const dg = r.dependencyGraph;
  if (dg.status === "ok") {
    if (dg.circular.length > 0) {
      const cyc = dg.circular[0].map((f) => rel(r.repo, f)).join(" → ");
      lines.push(
        `${label("Dependency Graph")}: ${chalk.red(`${dg.circular.length} circular`)} — ${cyc}`,
      );
    } else {
      const top = dg.mostDependedOn[0];
      const topStr = top ? `${top.file} (${top.count} dependents)` : "no hubs";
      lines.push(
        `${label("Dependency Graph")}: ${chalk.green("0 circular")} — clean · ${topStr} · ${dg.orphans.length} orphans`,
      );
    }
  } else {
    lines.push(
      `${label("Dependency Graph")}: ${chalk.yellow("skipped")} — ${dg.note ?? "unavailable"}`,
    );
  }

  const securityClusterCount = r.clusters.filter((c) =>
    [c.rootCause, ...c.symptoms].some((f) => f.source === "security"),
  ).length;
  const clusteredSecurity = r.clusters.reduce(
    (n, c) =>
      n + [c.rootCause, ...c.symptoms].filter((f) => f.source === "security").length,
    0,
  );
  const sec = r.security;
  if (sec.status === "ok") {
    if (sec.issues.length > 0) {
      if (securityClusterCount > 0) {
        lines.push(
          `${label("Security")}: ${chalk.red(`${securityClusterCount} root cause(s)`)} → ${clusteredSecurity} symptoms (see below)`,
        );
      } else {
        const i = sec.issues[0];
        const loc = i.file
          ? ` (${rel(r.repo, i.file)}${i.line ? ":" + i.line : ""})`
          : "";
        lines.push(
          `${label("Security")}: ${chalk.red(`${sec.issues.length} issues`)} — ${i.severity} ${i.type}: ${i.description}${loc} [${chalk.dim(findingIdFor("security", i.type, i.file, i.description))}]`,
        );
      }    } else {
      lines.push(`${label("Security")}: ${chalk.green("0 issues")} — clean`);
    }
  } else {
    lines.push(
      `${label("Security")}: ${chalk.yellow("skipped")} — ${sec.note ?? "unavailable"}`,
    );
  }

  const lg = r.ledger;
  if (lg) {
    if (lg.status === "ok") {
      const proven = lg.evidence.filter((e) => e.doubleCharged);
      if (proven.length > 0) {
        const e = proven[0];
        const evFile = e.evidenceFile
          ? rel(r.repo, e.evidenceFile)
          : "";
        lines.push(
          `${label("Ledger")}: ${chalk.red(`PROVEN: ${e.summary}`)} — see ${chalk.dim(evFile)} for full request/response logs`,
        );
      } else {
        lines.push(
          `${label("Ledger")}: ${chalk.green(`${lg.endpoints.length} endpoint(s) probed`)} — 0 double-charges (idempotency holds)`,
        );
      }
    } else {
      lines.push(
        `${label("Ledger")}: ${chalk.yellow(lg.status)} — ${lg.note ?? "ledger mode aborted"}`,
      );
    }
  }

  if (r.clusters.length > 0) {
    lines.push("");
    const totalSymptoms = r.clusters.reduce((s, c) => s + c.symptoms.length, 0);
    lines.push(
      `${label("Root Causes")}: ${r.clusters.length} root cause(s) → ${totalSymptoms} symptom(s)`,
    );
    r.clusters.slice(0, 3).forEach((c, i) => {
      const rc = `${c.rootCause.severity.toUpperCase()} ${c.rootCause.type}${c.rootCause.id ? ` [${c.rootCause.id}]` : ""}`;
      const shared = c.sharedFiles.slice(0, 3).join(", ");
      lines.push(`    ${i + 1}. ${chalk.red(rc)}: ${c.rootCause.description}`);
      lines.push(
        `       → ${c.symptoms.length} symptom(s) · shared: ${chalk.dim(shared)}`,
      );
      const mem = relevantEntriesForFiles(r.repo, c.sharedFiles);
      for (const m of mem.slice(0, 3)) {
        const mc = memTypeColor(m.type);
        lines.push(
          `       ${chalk.dim("↳ recall:")} ${mc(m.type)} — ${m.summary}`,
        );
      }
    });
  }

  const dup = r.duplication;
  if (dup.status === "ok") {
    if (dup.cloneCount > 0) {
      const top = dup.clones[0];
      const files = top?.files.map((f) => rel(r.repo, f)).join(", ") ?? "";
      lines.push(
        `${label("Duplication")}: ${chalk.red(`${dup.cloneCount} clones`)} — ${files}`,
      );
    } else {
      lines.push(`${label("Duplication")}: ${chalk.green("0 clones")} — clean`);
    }
  } else {
    lines.push(
      `${label("Duplication")}: ${chalk.yellow("skipped")} — ${dup.note ?? "unavailable"}`,
    );
  }

  const t = r.tests;
  if (t.status === "ok") {
    const cov = t.coverage != null ? `, ${t.coverage}% cov` : "";
    const body =
      t.failed > 0
        ? chalk.red(`${t.failed} failed`) + ` / ${t.total}`
        : chalk.green(`${t.passed}/${t.total} passed`);
    lines.push(
      `${label("Tests")}: ${body} — ${t.durationMs}ms${cov}`,
    );
  } else {
    lines.push(
      `${label("Tests")}: ${chalk.yellow("skipped")} — ${t.note ?? "unavailable"}`,
    );
  }

  const p = r.perf;
  if (p.status === "ok") {
    const kb = p.bundleSizeBytes != null ? (p.bundleSizeBytes / 1024).toFixed(1) : "0";
    lines.push(
      `${label("Performance")}: ${chalk.green(`build ${p.buildTimeMs}ms`)} — bundle ${kb} KB`,
    );
  } else {
    lines.push(
      `${label("Performance")}: ${chalk.yellow("skipped")} — ${p.note ?? "unavailable"}`,
    );
  }

  const a = r.accessibility;
  if (a.status === "ok") {
    const sev =
      a.issues.length > 0 &&
      a.issues.some((i) => i.severity === "high" || i.severity === "critical");
    const body =
      a.issues.length > 0
        ? sev
          ? chalk.red(`${a.issues.length} issues`)
          : chalk.yellow(`${a.issues.length} issues`)
        : chalk.green("clean");
    const eng = a.engine ? ` · ${a.engine}` : "";
    lines.push(`${label("Accessibility")}: ${body}${eng}`);
  } else {
    lines.push(
      `${label("Accessibility")}: ${chalk.yellow("skipped")} — ${a.note ?? "unavailable"}`,
    );
  }

  const reliab = r.reliability;
  if (reliab.status === "ok") {
    const flaky =
      reliab.flakyTests.length > 0
        ? chalk.red(`${reliab.flakyTests.length} flaky`)
        : chalk.green("0 flaky");
    const smells =
      reliab.raceSmells.length > 0
        ? chalk.yellow(`${reliab.raceSmells.length} race smell(s)`)
        : chalk.green("0 race smells");
    const runs = reliab.runs > 0 ? ` · ${reliab.runs} runs` : "";
    lines.push(`${label("Reliability")}: ${flaky} · ${smells}${runs}`);
  } else {
    lines.push(
      `${label("Reliability")}: ${chalk.yellow("skipped")} — ${reliab.note ?? "unavailable"}`,
    );
  }

  const dx = r.devex;
  if (dx.status === "ok") {
    const unused =
      dx.unusedExports.length > 0
        ? chalk.yellow(`${dx.unusedExports.length} unused export(s)`)
        : chalk.green("0 unused exports");
    const dups =
      dx.duplicateFunctions.length > 0
        ? chalk.yellow(`${dx.duplicateFunctions.length} dup function(s)`)
        : chalk.green("0 dup functions");
    lines.push(`${label("Devex")}: ${unused} · ${dups}`);
  } else {
    lines.push(
      `${label("Devex")}: ${chalk.yellow("skipped")} — ${dx.note ?? "unavailable"}`,
    );
  }

  const content =
    lines.join("\n") +
    "\n\n  " +
    chalk.bold("Awaiting confirmation to begin autonomous fixing.");

  return boxen(content, {
    title: " GUARDIAN — Repository Scan Complete ",
    titleAlignment: "center",
    borderStyle: "double",
    padding: 1,
    borderColor: "cyan",
  });
}

export async function runScan(
  repo: string,
  opts?: { ledger?: boolean },
): Promise<{ result: ScanResult; file: string }> {
  const result = runAllAnalyzers(repo);

  // Ledger mode is invasive (it boots the app and probes live endpoints), so it
  // never runs unless explicitly requested via `--ledger`.
  if (opts?.ledger) {
    result.ledger = await runLedgerAnalyzer(repo);
  }

  // Stable finding ids first, so clusters and scan-latest.json carry the ids
  // that `guardian repro <id>` (and committed repro tests) reference.
  stampFindings(result);

  const { clusters } = correlate(repo, result);
  result.clusters = clusters;

  const outDir = path.join(repo, ".guardian");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(outDir, `scan-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, "scan-latest.json"), JSON.stringify(result, null, 2));
  return { result, file };
}

export const scan = new Command("scan")
  .description("Scan a repo for dependency, security, duplication, test and performance issues")
  .argument("[repo]", "path to the repo to scan", ".")
  .option(
    "--ledger",
    "opt-in, invasive: boot the app under a nock sandbox and probe money-moving " +
      "endpoints (charge/capture/payment/transfer/refund/webhook) for missing " +
      "idempotency. Never runs unless --ledger is passed.",
  )
  .option("--json", "print the raw scan result as JSON instead of the boxed report")
  .action(async (repoArg: string, options: { ledger?: boolean; json?: boolean }) => {
    const repo = path.resolve(repoArg);
    if (!options.json) {
      console.log(
        chalk.cyan(`\nScanning ${repo}${options.ledger ? " with --ledger" : ""} ...\n`),
      );
    }

    const run = async () => {
      const { result, file } = await runScan(repo, { ledger: options.ledger });
      return { result, file };
    };

    let result: ScanResult;
    let file: string;
    if (options.json) {
      ({ result, file } = await run());
    } else {
      const spin = ora("Running analyzers").start();
      try {
        ({ result, file } = await run());
        spin.succeed("Scan complete");
      } catch (err: any) {
        spin.fail("Scan failed");
        throw err;
      }
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(renderBox(result));
    console.log(chalk.dim(`\nReports written to ${file}\n`));
  });
