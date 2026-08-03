import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import path from "node:path";
import fs from "node:fs";
import { runAllAnalyzers } from "../analyzers/index.js";
import type { ScanResult } from "../analyzers/types.js";

function rel(repo: string, p?: string): string {
  return p ? path.relative(repo, p) : "";
}

function label(text: string): string {
  return chalk.bold(text.padEnd(17));
}

function renderBox(r: ScanResult): string {
  const lines: string[] = [];

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

  const sec = r.security;
  if (sec.status === "ok") {
    if (sec.issues.length > 0) {
      const i = sec.issues[0];
      const loc = i.file
        ? ` (${rel(r.repo, i.file)}${i.line ? ":" + i.line : ""})`
        : "";
      lines.push(
        `${label("Security")}: ${chalk.red(`${sec.issues.length} issues`)} — ${i.severity} ${i.type}: ${i.description}${loc}`,
      );
    } else {
      lines.push(`${label("Security")}: ${chalk.green("0 issues")} — clean`);
    }
  } else {
    lines.push(
      `${label("Security")}: ${chalk.yellow("skipped")} — ${sec.note ?? "unavailable"}`,
    );
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

export const scan = new Command("scan")
  .description("Scan a repo for dependency, security, duplication, test and performance issues")
  .argument("[repo]", "path to the repo to scan", ".")
  .action(async (repoArg: string) => {
    const repo = path.resolve(repoArg);
    console.log(chalk.cyan(`\nScanning ${repo} ...\n`));

    const result = runAllAnalyzers(repo);

    const outDir = path.join(repo, ".guardian");
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(outDir, `scan-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outDir, "scan-latest.json"), JSON.stringify(result, null, 2));

    console.log(renderBox(result));
    console.log(chalk.dim(`\nReports written to ${file}\n`));
  });
