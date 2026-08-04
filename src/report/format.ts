import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import boxen from "boxen";
import type { ScanResult, Cluster } from "../analyzers/types.js";

export interface VerifyMetrics {
  tests: { total: number; passed: number; failed: number; durationMs: number; coverage?: number };
  perf: { buildTimeMs?: number; bundleSizeBytes?: number };
  securityCount: number;
  duplicationCount: number;
}

export interface VerifyReport {
  timestamp: string;
  repo: string;
  baselineTimestamp?: string;
  risk: "High" | "Medium" | "Low";
  exitCode: number;
  deltas: {
    passed: number;
    failed: number;
    durationMs: number;
    coverage: number;
    buildTimeMs: number;
    bundleSizeBytes: number;
    security: number;
    duplication: number;
  };
  baseline: VerifyMetrics;
  current: VerifyMetrics;
}

export interface History {
  repo: string;
  scans: ScanResult[];
  verifies: VerifyReport[];
}

export function loadHistory(repo: string): History {
  const dir = path.join(repo, ".guardian");
  const read = (prefix: string): any[] => {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  };
  const scans = read("scan-") as ScanResult[];
  const verifies = read("verify-") as VerifyReport[];
  scans.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  verifies.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  return { repo, scans, verifies };
}

export interface MetricLine {
  label: string;
  value: string;
  color?: "green" | "yellow" | "red" | "dim";
}

export interface ReportModel {
  repo: string;
  generatedAt: string;
  latestScan: ScanResult | null;
  latestVerify: VerifyReport | null;
  scansCount: number;
  verifiesCount: number;
  lines: MetricLine[];
  clusters: Cluster[];
  hasVerify: boolean;
}

const NOT_SCANNED = "not scanned";
const NOT_ASSESSED = "not assessed";

function bundleKB(b?: number): string {
  return b == null ? NOT_SCANNED : `${(b / 1024).toFixed(1)} KB`;
}
function ms(n?: number): string {
  return n == null ? NOT_SCANNED : `${n} ms`;
}

export function buildModel(repo: string): ReportModel {
  const hist = loadHistory(repo);
  const latestScan = hist.scans[hist.scans.length - 1] ?? null;
  const latestVerify = hist.verifies[hist.verifies.length - 1] ?? null;

  const lines: MetricLine[] = [];

  // Critical Issues Fixed — derived from improvements in the latest verify.
  if (!latestVerify) {
    lines.push({ label: "Critical Issues Fixed", value: NOT_ASSESSED, color: "dim" });
  } else {
    const d = latestVerify.deltas;
    let fixed = 0;
    if (d.security < 0) fixed += -d.security;
    if (d.duplication < 0) fixed += -d.duplication;
    if (d.failed < 0) fixed += -d.failed;
    lines.push({ label: "Critical Issues Fixed", value: String(fixed) });
  }

  // Security Vulnerabilities
  if (!latestScan || latestScan.security.status !== "ok") {
    lines.push({ label: "Security Vulnerabilities", value: NOT_SCANNED, color: "dim" });
  } else {
    const issues = latestScan.security.issues;
    const bySev: Record<string, number> = {};
    for (const i of issues) bySev[i.severity] = (bySev[i.severity] ?? 0) + 1;
    const crit = bySev.critical ?? 0;
    const high = bySev.high ?? 0;
    const color = issues.length > 0 ? (crit > 0 ? "red" : "yellow") : "green";
    const detail = issues.length === 0 ? "" : ` (crit ${crit} · high ${high})`;
    lines.push({
      label: "Security Vulnerabilities",
      value: `${issues.length}${detail}`,
      color,
    });
  }

  // Memory Leaks — no analyzer exists yet.
  lines.push({ label: "Memory Leaks", value: NOT_SCANNED, color: "dim" });

  // Broken Tests
  if (!latestScan || latestScan.tests.status !== "ok") {
    lines.push({ label: "Broken Tests", value: NOT_SCANNED, color: "dim" });
  } else {
    const t = latestScan.tests;
    const color = t.failed > 0 ? "red" : "green";
    lines.push({
      label: "Broken Tests",
      value: `${t.failed} failed / ${t.total} total`,
      color,
    });
  }

  // Reliability (flaky tests + race-condition heuristics)
  if (!latestScan || latestScan.reliability?.status !== "ok") {
    lines.push({ label: "Reliability", value: NOT_SCANNED, color: "dim" });
  } else {
    const rel = latestScan.reliability;
    const dirty = rel.flakyTests.length > 0 || rel.raceSmells.length > 0;
    lines.push({
      label: "Reliability",
      value: `${rel.flakyTests.length} flaky · ${rel.raceSmells.length} race smell(s) · ${rel.runs} runs`,
      color: dirty ? "yellow" : "green",
    });
  }

  // Accessibility
  if (!latestScan || latestScan.accessibility?.status !== "ok") {
    lines.push({ label: "Accessibility", value: NOT_SCANNED, color: "dim" });
  } else {
    const a = latestScan.accessibility;
    const dirty = a.issues.length > 0;
    lines.push({
      label: "Accessibility",
      value: `${a.issues.length} issues${a.engine ? ` · ${a.engine}` : ""}`,
      color: dirty ? "yellow" : "green",
    });
  }

  // Performance (with deltas from verify when available)
  if (!latestScan || latestScan.perf.status !== "ok") {
    lines.push({ label: "Performance", value: NOT_SCANNED, color: "dim" });
  } else {
    const p = latestScan.perf;
    const parts: string[] = [`build ${ms(p.buildTimeMs)}`, `bundle ${bundleKB(p.bundleSizeBytes)}`];
    if (latestVerify) {
      const d = latestVerify.deltas;
      if (p.buildTimeMs != null && d.buildTimeMs !== 0) {
        const good = d.buildTimeMs < 0;
        parts[0] += ` (${good ? "" : "+"}${d.buildTimeMs}ms)`;
      }
      if (p.bundleSizeBytes != null && d.bundleSizeBytes !== 0) {
        const good = d.bundleSizeBytes < 0;
        parts[1] += ` (${good ? "-" : "+"}${(Math.abs(d.bundleSizeBytes) / 1024).toFixed(1)}KB)`;
      }
    }
    lines.push({ label: "Performance", value: parts.join(" · "), color: "green" });
  }

  // Devex (unused exports / duplicate functions)
  if (!latestScan || latestScan.devex?.status !== "ok") {
    lines.push({ label: "Devex", value: NOT_SCANNED, color: "dim" });
  } else {
    const dx = latestScan.devex;
    const dirty = dx.unusedExports.length > 0 || dx.duplicateFunctions.length > 0;
    lines.push({
      label: "Devex",
      value: `${dx.unusedExports.length} unused export(s) · ${dx.duplicateFunctions.length} dup function(s)`,
      color: dirty ? "yellow" : "green",
    });
  }

  // Technical Debt
  if (!latestScan || latestScan.dependencyGraph.status !== "ok") {
    lines.push({ label: "Technical Debt", value: NOT_SCANNED, color: "dim" });
  } else {
    const dg = latestScan.dependencyGraph;
    const clones =
      latestScan.duplication.status === "ok"
        ? String(latestScan.duplication.cloneCount)
        : NOT_SCANNED;
    lines.push({
      label: "Technical Debt",
      value: `${dg.circular.length} circular · ${clones} clones · ${dg.orphans.length} orphans`,
      color: dg.circular.length > 0 ? "yellow" : "green",
    });
  }

  // Regression Risk
  if (!latestVerify) {
    lines.push({ label: "Regression Risk", value: NOT_ASSESSED, color: "dim" });
  } else {
    const c = latestVerify.risk === "High" ? "red" : latestVerify.risk === "Medium" ? "yellow" : "green";
    lines.push({ label: "Regression Risk", value: latestVerify.risk, color: c });
  }

  return {
    repo,
    generatedAt: new Date().toISOString(),
    latestScan,
    latestVerify,
    scansCount: hist.scans.length,
    verifiesCount: hist.verifies.length,
    lines,
    clusters: latestScan?.clusters ?? [],
    hasVerify: !!latestVerify,
  };
}

export function renderTerminal(model: ReportModel): string {
  if (model.scansCount === 0) {
    return boxen(
      chalk.yellow("No scan history found.\nRun `guardian scan` to generate a report."),
      {
        title: " GUARDIAN — Repository Analysis Complete ",
        titleAlignment: "center",
        borderStyle: "double",
        padding: 1,
        borderColor: "yellow",
      },
    );
  }

  const lines = model.lines.map((l) => {
    const colorFn =
      l.color === "green"
        ? chalk.green
        : l.color === "yellow"
          ? chalk.yellow
          : l.color === "red"
            ? chalk.red
            : chalk.dim;
    return `  ${chalk.bold(l.label.padEnd(24))}: ${colorFn(l.value)}`;
  });

  const header = `${chalk.dim(`repo: ${model.repo}`)}  ·  ${chalk.dim(`${model.scansCount} scan(s), ${model.verifiesCount} verify(ies)`)}`;
  const content = [header, "", ...lines].join("\n");

  return boxen(content, {
    title: " GUARDIAN — Repository Analysis Complete ",
    titleAlignment: "center",
    borderStyle: "double",
    padding: 1,
    borderColor: "cyan",
  });
}

function deltaCell(n: number, unit: string, higherIsBetter: boolean, isPct = false): string {
  if (n === 0) return "0";
  const good = higherIsBetter ? n > 0 : n < 0;
  const sign = n > 0 ? "+" : "";
  const val = isPct ? `${sign}${n.toFixed(1)}%` : unit === "KB" ? `${sign}${(n / 1024).toFixed(1)} KB` : `${sign}${n}${unit}`;
  return good ? chalk.green(val) : chalk.red(val);
}

export interface MarkdownOptions {
  /** Put the root-cause → symptoms clusters directly under the header. */
  clustersFirst?: boolean;
  /** One-line context shown under the header (branch, base, PR, etc.). */
  headerNote?: string;
  /** Title override (default "Repository Analysis Complete"). */
  title?: string;
}

function summarySection(lines: MetricLine[]): string[] {
  const out: string[] = [];
  out.push(`## Summary`);
  out.push("");
  out.push(`| Metric | Value |`);
  out.push(`| --- | --- |`);
  for (const l of lines) out.push(`| ${l.label} | ${l.value} |`);
  out.push("");
  return out;
}

/** Root cause → symptoms cluster framing, mirroring the interactive scan box. */
function clustersSection(clusters: Cluster[]): string[] {
  const out: string[] = [];
  out.push(`## Root-Cause Clusters`);
  out.push("");
  if (clusters.length === 0) {
    out.push(`No root-cause clusters identified.`);
    out.push("");
    return out;
  }
  clusters.forEach((c, i) => {
    const sev = c.rootCause.severity.toUpperCase();
    out.push(`${i + 1}. **Root cause** (${sev} ${c.rootCause.type}): ${c.rootCause.description}`);
    out.push(`   → ${c.symptoms.length} symptom(s) · shared: \`${c.sharedFiles.join("`, `")}\``);
    for (const s of c.symptoms) {
      out.push(`     - (${s.severity.toUpperCase()} ${s.type}): ${s.description}`);
    }
    if (i < clusters.length - 1) out.push("");
  });
  out.push("");
  return out;
}

function beforeAfterSection(model: ReportModel): string[] {
  const out: string[] = [];
  out.push(`## Before / After`);
  out.push("");
  if (!model.hasVerify || !model.latestVerify) {
    out.push(`No verify history — run \`guardian verify\` (or \`guardian ci\` in a PR) to populate the before/after diff.`);
    out.push("");
    return out;
  }
  const v = model.latestVerify;
  const b = v.baseline;
  const cur = v.current;
  const d = v.deltas;
  out.push(`Latest verify risk: **${v.risk}** (baseline ${v.baselineTimestamp ?? "unknown"})`);
  out.push("");
  out.push(`| Metric | Baseline | Current | Δ |`);
  out.push(`| --- | --- | --- | --- |`);
  const row = (name: string, base: string, curr: string, deltaStr: string) => {
    out.push(`| ${name} | ${base} | ${curr} | ${deltaStr} |`);
  };
  row(
    "Tests passed",
    String(b.tests.passed),
    String(cur.tests.passed),
    deltaCell(d.passed, "", true),
  );
  row(
    "Tests failed",
    String(b.tests.failed),
    String(cur.tests.failed),
    deltaCell(d.failed, "", false),
  );
  row("Duration", ms(b.tests.durationMs), ms(cur.tests.durationMs), deltaCell(d.durationMs, "ms", false));
  row(
    "Coverage",
    b.tests.coverage != null ? `${b.tests.coverage.toFixed(1)}%` : "—",
    cur.tests.coverage != null ? `${cur.tests.coverage.toFixed(1)}%` : "—",
    deltaCell(d.coverage, "%", true, true),
  );
  row(
    "Build time",
    ms(b.perf.buildTimeMs),
    ms(cur.perf.buildTimeMs),
    deltaCell(d.buildTimeMs, "ms", false),
  );
  row(
    "Bundle size",
    bundleKB(b.perf.bundleSizeBytes),
    bundleKB(cur.perf.bundleSizeBytes),
    deltaCell(d.bundleSizeBytes, "KB", false),
  );
  row(
    "Security findings",
    String(b.securityCount),
    String(cur.securityCount),
    deltaCell(d.security, "", false),
  );
  row(
    "Duplication clones",
    String(b.duplicationCount),
    String(cur.duplicationCount),
    deltaCell(d.duplication, "", false),
  );
  out.push("");
  return out;
}

function notesSection(): string[] {
  return [
    `## Notes`,
    ``,
    `- Every figure above is read directly from \`.guardian/scan-*.json\` and \`.guardian/verify-*.json\`.`,
    `- Categories marked **${NOT_SCANNED}** could not be analyzed for this repo (see the scan's per-category notes for why).`,
    `- Categories marked **${NOT_ASSESSED}** depend on a \`guardian verify\` run that has not happened.`,
    `- Accessibility can only run a live page test with pa11y/axe; otherwise it falls back to static JSX linting.`,
    `- Reliability and race-condition findings are heuristics — confirm each before acting.`,
    ``,
  ];
}

export function renderMarkdown(model: ReportModel, opts: MarkdownOptions = {}): string {
  const out: string[] = [];
  out.push(`# GUARDIAN — ${opts.title ?? "Repository Analysis Complete"}`);
  out.push("");
  out.push(`_Generated ${model.generatedAt}_  `);
  out.push(`_Repo: \`${model.repo}\` · ${model.scansCount} scan(s), ${model.verifiesCount} verify(ies)_`);
  if (opts.headerNote) out.push(`_${opts.headerNote}_`);
  out.push("");

  if (opts.clustersFirst) {
    out.push(...clustersSection(model.clusters));
    out.push(...summarySection(model.lines));
  } else {
    out.push(...summarySection(model.lines));
    out.push(...clustersSection(model.clusters));
  }

  out.push(...beforeAfterSection(model));
  out.push(...notesSection());

  return out.join("\n");
}
