/**
 * pen/fix.ts — `guardian pen --fix`.
 *
 * What --fix actually does (and what it refuses to do):
 *   1. Writes a permanent repro test for every finding that has a replayable
 *      attack (dynamic) or a stable credential fragment (secrets). The test
 *      FAILS while the bug exists — that is the fail-first contract.
 *   2. Generates deterministic patches for the small set of fixes that are
 *      provably safe to suggest as `git apply`-able diffs:
 *        - `app.disable("x-powered-by")` (no behavior change)
 *        - `helmet()` middleware, only when helmet is already installed
 *      Everything else gets a precise manual fix note in GUARDIAN_PEN_FIXES.md.
 *   3. NEVER modifies the user's source. Patches are written to
 *      .guardian/pen-patches/ and the user (or their agent) applies them.
 */

import fs from "node:fs";
import path from "node:path";
import { generatePenRepro } from "../repro/pen.js";
import type { PenFinding, PenResult } from "./types.js";

export interface PenFixOutcome {
  repros: { findingId: string; file: string }[];
  patches: { findingId: string; file: string; diffPath: string; note: string }[];
  fixesMd: string;
}

/* ------------------------------------------------------------------ */
/* tiny unified-diff builder (single-hunk, insert/replace)             */
/* ------------------------------------------------------------------ */

function makeInsertPatch(
  rel: string,
  oldLines: string[],
  insertAfterLine: number,
  newLines: string[],
): string {
  const rangeStart = Math.max(1, insertAfterLine - 2);
  const rangeEnd = Math.min(oldLines.length, insertAfterLine + 1);
  const ctx = oldLines.slice(rangeStart - 1, rangeEnd);
  const anchorPos = insertAfterLine - rangeStart;
  const minus = ctx.map((l) => " " + l);
  const plus = [
    ...ctx.slice(0, anchorPos + 1).map((l) => " " + l),
    ...newLines.map((l) => "+" + l),
    ...ctx.slice(anchorPos + 1).map((l) => " " + l),
  ];
  const oldCount = minus.length;
  const newCount = plus.length;
  return [
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -${rangeStart},${oldCount} +${rangeStart},${newCount} @@`,
    ...minus,
    ...plus,
    "",
  ].join("\n");
}

function makeReplacePatch(
  rel: string,
  oldLines: string[],
  atLine: number,
  newLines: string[],
): string {
  const rangeStart = Math.max(1, atLine - 2);
  const rangeEnd = Math.min(oldLines.length, atLine + 2);
  const ctx = oldLines.slice(rangeStart - 1, rangeEnd);
  const relPos = atLine - rangeStart;
  const minus = ctx.map((l, i) => (i === relPos ? "-" + l : " " + l));
  const plus = [
    ...ctx.slice(0, relPos).map((l) => " " + l),
    ...newLines.map((l) => "+" + l),
    ...ctx.slice(relPos + 1).map((l) => " " + l),
  ];
  const oldCount = minus.length;
  const newCount = plus.length;
  return [
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -${rangeStart},${oldCount} +${rangeStart},${newCount} @@`,
    ...minus,
    ...plus,
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */

function findExpressAppFile(repo: string): { file: string; line: number; lineText: string } | null {
  const stack = [repo];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".guardian" || e.name === "dist" || e.name === "build") continue;
        stack.push(p);
      } else if (e.isFile() && /\.(js|mjs|cjs|ts)$/i.test(e.name)) {
        try {
          const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (/const\s+app\s*=\s*express\s*\(/.test(lines[i])) {
              return { file: p, line: i + 1, lineText: lines[i] };
            }
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  return null;
}

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

export function runFixes(repo: string, result: PenResult, packages: string[]): PenFixOutcome {
  const repros: PenFixOutcome["repros"] = [];
  const patches: PenFixOutcome["patches"] = [];
  const patchDir = path.join(repo, ".guardian", "pen-patches");
  fs.mkdirSync(patchDir, { recursive: true });

  for (const f of result.findings) {
    const outcome = generatePenRepro(repo, f);
    if (outcome.ok && outcome.file) repros.push({ findingId: f.id, file: outcome.file });
  }

  const expressApp = findExpressAppFile(repo);
  const helmetInstalled = packages.includes("helmet");

  for (const f of result.findings) {
    // x-powered-by: disable it right after app creation. Behavior-neutral.
    if (f.type === "info-leak-header" && expressApp) {
      const rel = path.relative(repo, expressApp.file).replace(/\\/g, "/");
      const lines = readLines(expressApp.file);
      const already = lines.some((l) => /disable\s*\(\s*["']x-powered-by["']/.test(l));
      if (!already) {
        const diff = makeInsertPatch(rel, lines, expressApp.line, [`app.disable("x-powered-by");`]);
        const diffPath = path.join(patchDir, `${f.id}-disable-x-powered-by.diff`);
        fs.writeFileSync(diffPath, diff, "utf8");
        patches.push({
          findingId: f.id,
          file: rel,
          diffPath: path.relative(repo, diffPath).replace(/\\/g, "/"),
          note: "inserts `app.disable(\"x-powered-by\");` after the Express app creation line",
        });
      }
    }

    // helmet: only patch when the dependency is already installed.
    if (f.type === "missing-security-headers" && expressApp && helmetInstalled) {
      const rel = path.relative(repo, expressApp.file).replace(/\\/g, "/");
      const lines = readLines(expressApp.file);
      const already = lines.some((l) => /\bhelmet\s*\(/.test(l));
      if (!already) {
        const importLine = /^(?:import|export)\b.*;?\s*$/.test(lines[0] ?? "") || lines.some((l) => /^import\b/.test(l))
          ? `import helmet from "helmet";`
          : `const helmet = require("helmet");`;
        const diff = makeInsertPatch(rel, lines, expressApp.line, [
          `app.use(helmet());`,
        ]);
        const fullDiff = diff.replace(
          /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/,
          (_m, a, b, c, d) => `@@ -${a},${b} +${c},${Number(d) + 1} @@`,
        ).replace(/^\+app\.use\(helmet\(\)\);\s*$/m, `+${importLine}\n+app.use(helmet());`);
        const diffPath = path.join(patchDir, `${f.id}-add-helmet.diff`);
        fs.writeFileSync(diffPath, fullDiff, "utf8");
        patches.push({
          findingId: f.id,
          file: rel,
          diffPath: path.relative(repo, diffPath).replace(/\\/g, "/"),
          note: "adds the helmet import + `app.use(helmet());` after the Express app creation line (helmet is already in package.json)",
        });
      }
    }
  }

  const fixesMd = buildFixesMd(repo, result, repros, patches);
  return { repros, patches, fixesMd };
}

function buildFixesMd(
  repo: string,
  result: PenResult,
  repros: { findingId: string; file: string }[],
  patches: { findingId: string; file: string; diffPath: string; note: string }[],
): string {
  const reproBy = new Map(repros.map((r) => [r.findingId, r.file]));
  const patchBy = new Map(patches.map((p) => [p.findingId, p]));
  const L: string[] = [];
  L.push(`# Guardian Pen Test — Fix Plan`);
  L.push("");
  L.push(`_${result.timestamp}_ — ${result.repo}`);
  L.push("");
  L.push(`How to use this file:`);
  L.push(`1. Every replayable finding now has a **repro test** that FAILS while the bug is live.`);
  L.push(`2. Apply deterministic patches with \`git apply\`, or hand the finding id to your agent:`);
  L.push(`   \`guardian drive <id>\` or tell your agent \`guardian repro <id>\` → fix → \`guardian verify\`.`);
  L.push(`3. When the repro test PASSES and \`guardian pen\` reports the finding gone, it is fixed — not vibes.`);
  L.push("");
  for (const f of result.findings) {
    L.push(`## ${f.severity.toUpperCase()} — ${f.title} \`${f.id}\``);
    L.push("");
    L.push(`- **Confidence**: ${f.confidence} · **Type**: ${f.type}`);
    const where = f.file
      ? path.relative(repo, f.file).replace(/\\/g, "/") + (f.line ? `:${f.line}` : "")
      : f.route
        ? `${f.route} (${f.method})`
        : "—";
    L.push(`- **Where**: \`${where}\``);
    L.push("");
    L.push(f.description);
    L.push("");
    const reproFile = reproBy.get(f.id);
    if (reproFile) {
      L.push(`- **Repro test**: \`${reproFile}\` — run with \`npx cli-guardian repro ${f.id}\`. It FAILS now; make it PASS.`);
    }
    const patch = patchBy.get(f.id);
    if (patch) {
      L.push(`- **Deterministic patch**: \`git apply ${patch.diffPath}\` — ${patch.note}.`);
      L.push(`  Verify with \`npx cli-guardian repro ${f.id}\` + \`npx cli-guardian verify\`.`);
    }
    if (f.fix) {
      L.push(`- **Fix guidance**: ${f.fix}`);
    }
    L.push("");
  }
  L.push(`---`);
  L.push(`Guardian can't promise "never hacked" — it CAN promise this: every demonstrable attack here`);
  L.push(`has a regression test that fails on the bug and passes on the fix. Ship with those tests green.`);
  L.push("");
  return L.join("\n");
}
