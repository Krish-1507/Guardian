import fs from "node:fs";
import path from "node:path";
import type { ScanResult } from "../analyzers/types.js";
import { resolveFinding, enumerateFindings } from "./ids.js";
import { generateRepro, type ReproOutcome } from "./generate.js";
import { runRepro, type ReproRunResult } from "./run.js";

/**
 * repro/index.ts — `guardian repro <finding-id>`:
 *
 *   1. load `.guardian/scan-latest.json`,
 *   2. resolve the finding id to a real finding,
 *   3. generate a committed repro test that genuinely attempts to reproduce the bug,
 *   4. run it through the repo's own test framework and report PASS/FAIL.
 *
 * The repo has its own hypotheses-failing contract: a repro that does NOT fail is
 * evidence the hypothesis is wrong, not a green-light to fix blind.
 */

export interface ReproResult {
  status: "generated-and-ran" | "generated" | "refused" | "not-found" | "no-scan";
  findingId?: string;
  file?: string;
  reason?: string;
  ran?: ReproRunResult;
}

export function loadScan(repo: string): ScanResult | null {
  const p = path.join(repo, ".guardian", "scan-latest.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ScanResult;
  } catch {
    return null;
  }
}

export async function repro(
  repo: string,
  findingId: string,
  opts: { writeOnly?: boolean } = {},
): Promise<ReproResult> {
  const scan = loadScan(repo);
  if (!scan) {
    return { status: "no-scan", reason: "no .guardian/scan-latest.json — run `guardian scan` first" };
  }

  const finding = resolveFinding(scan, findingId);
  if (!finding) {
    const available = enumerateFindings(scan)
      .slice(0, 25)
      .map((f) => `  ${f.id}  ${f.source}/${f.type} — ${f.description}`)
      .join("\n");
    return {
      status: "not-found",
      reason:
        `no finding with id "${findingId}" in .guardian/scan-latest.json. ` +
        (available ? `\nRepro-able finding ids:\n${available}` : ""),
    };
  }

  const outcome: ReproOutcome = generateRepro(repo, scan, finding);
  if (!outcome.ok || !outcome.file) {
    return {
      status: "refused",
      findingId,
      reason: outcome.reason ?? "generator produced no test file",
    };
  }

  if (opts.writeOnly) {
    return { status: "generated", findingId, file: outcome.file };
  }

  const ran = await runRepro(repo, outcome.file);
  return { status: "generated-and-ran", findingId, file: outcome.file, ran };
}