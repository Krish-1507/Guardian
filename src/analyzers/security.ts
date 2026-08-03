import fs from "node:fs";
import path from "node:path";
import { commandExists, detectLanguage, safeExec } from "./util.js";
import type { ScanIssue, SecurityResult } from "./types.js";

export function analyzeSecurity(repo: string): SecurityResult {
  const lang = detectLanguage(repo);
  const issues: ScanIssue[] = [];

  if (lang === "js") {
    const r = safeExec("npm", ["audit", "--json"], repo, 120000);
    if (r.stdout) issues.push(...parseNpmAudit(r.stdout));
  } else if (lang === "python") {
    if (commandExists("pip-audit")) {
      const r = safeExec("pip-audit", ["-f", "json"], repo, 120000);
      if (r.stdout) issues.push(...parsePipAudit(r.stdout));
    }
  }

  if (commandExists("gitleaks")) {
    const tmp = path.join(repo, ".guardian", `gitleaks-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const r = safeExec(
      "gitleaks",
      ["detect", "--no-git", "--report-format", "json", "--report-path", tmp, "-v"],
      repo,
      120000,
    );
    if (fs.existsSync(tmp)) {
      try {
        issues.push(...parseGitleaks(fs.readFileSync(tmp, "utf8")));
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  if (commandExists("semgrep")) {
    const r = safeExec("semgrep", ["--config", "auto", "--json"], repo, 180000);
    if (r.stdout) issues.push(...parseSemgrep(r.stdout));
  }

  if (issues.length === 0 && lang === "unknown") {
    return {
      status: "skipped",
      note: "unsupported language / no security tooling",
      issues: [],
    };
  }

  return { status: "ok", issues };
}

function parseNpmAudit(stdout: string): ScanIssue[] {
  const issues: ScanIssue[] = [];
  let json: any;
  try {
    json = JSON.parse(stdout);
  } catch {
    return issues;
  }
  const vuls = json?.vulnerabilities ?? {};
  for (const [name, v] of Object.entries<any>(vuls)) {
    let desc = name;
    const via = v?.via;
    if (Array.isArray(via)) {
      const firstObj = via.find((x: any) => typeof x === "object" && x.title);
      if (firstObj?.title) desc = `${name}: ${firstObj.title}`;
      else if (typeof via[0] === "string") desc = `${name} (via ${via[0]})`;
    }
    issues.push({
      type: "dependency",
      severity: v?.severity ?? "unknown",
      description: desc,
    });
  }
  return issues;
}

function parsePipAudit(stdout: string): ScanIssue[] {
  const issues: ScanIssue[] = [];
  let arr: any[];
  try {
    arr = JSON.parse(stdout);
  } catch {
    return issues;
  }
  for (const v of arr) {
    issues.push({
      type: "dependency",
      severity: v.severity ?? "unknown",
      description: `${v.name} ${v.id ?? ""}`.trim(),
    });
  }
  return issues;
}

function parseGitleaks(stdout: string): ScanIssue[] {
  const issues: ScanIssue[] = [];
  let arr: any[];
  try {
    arr = JSON.parse(stdout);
  } catch {
    return issues;
  }
  for (const f of arr) {
    issues.push({
      type: "secret",
      severity: f.Severity ?? "high",
      file: f.File,
      line: f.StartLine,
      description: f.Description ?? f.RuleID ?? "secret detected",
    });
  }
  return issues;
}

function parseSemgrep(stdout: string): ScanIssue[] {
  const issues: ScanIssue[] = [];
  let json: any;
  try {
    json = JSON.parse(stdout);
  } catch {
    return issues;
  }
  for (const r of json?.results ?? []) {
    issues.push({
      type: "code",
      severity: r.extra?.severity ?? "medium",
      file: r.path,
      line: r.start?.line,
      description: r.extra?.message ?? r.check_id ?? "finding",
    });
  }
  return issues;
}
