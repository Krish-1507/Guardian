import fs from "node:fs";
import path from "node:path";
import { commandExists, safeExec, walkFiles, lineOf } from "./util.js";
import type { DuplicateFunction, DevexResult, ScanIssue } from "./types.js";

const TS_PRUNE_JSON = ["--json"];
const JS_EXTS = [".js", ".jsx", ".ts", ".tsx"];

// Duplicate-function detector thresholds.
const MIN_TOKENS = 12; // ignore tiny one-liners
const SIM_THRESHOLD = 0.85; // Dice similarity of normalized token streams
const MAX_DUP_FINDINGS = 10;

/**
 * Developer-experience (devex) analysis.
 *
 * Two independent signals:
 *
 * 1. `ts-prune` — unused TypeScript exports (requires ts-prune to be installed;
 *    otherwise that half is skipped and noted here).
 *
 * 2. A duplicated-utility-function detector. This is DIFFERENT from jscpd: jscpd
 *    is text/copy-paste based, whereas this splits each function out with a light
 *    brace-matching pass, normalizes its token stream (identifiers→I, strings→S,
 *    numbers→N, operators kept), and flags near-identical BODIES across files.
 *    The goal is a *structural* clone (same logic, possibly renamed variables),
 *    which jscpd can miss. It is a heuristic — a shared helper that was duplicated
 *    into two files is usually a real DRY violation, but two intentionally-identical
 *    thin wrappers may be fine.
 */
export function analyzeDevex(repo: string): DevexResult {
  const notes: string[] = [];

  // --- ts-prune (unused exports) ---
  let unusedExports: ScanIssue[] = [];
  let tsPruneRan = false;
  if (commandExists("ts-prune")) {
    tsPruneRan = true;
    const r = safeExec("ts-prune", TS_PRUNE_JSON, repo, 120000);
    // ts-prune emits one line per unused export: /path/file.ts:1:2 - exportName
    unusedExports = parseTsPrune(r.stdout, repo);
  } else {
    notes.push("ts-prune not installed — unused-export check skipped (npm i -D ts-prune)");
  }

  // --- duplicated-utility-function detector (always runs on JS/TS) ---
  const files = walkFiles(repo, JS_EXTS);
  const duplicateFunctions = findDuplicateFunctions(repo, files);

  // Nothing to analyze: not a JS/TS repo.
  if (files.length === 0) {
    return {
      status: "skipped",
      note: "no JS/TS files found",
      unusedExports,
      duplicateFunctions,
    };
  }

  const note = notes.length > 0 ? notes.join("; ") : undefined;
  return { status: "ok", note, unusedExports, duplicateFunctions };
}

function parseTsPrune(stdout: string, repo: string): ScanIssue[] {
  const out: ScanIssue[] = [];
  const re = /^(.+?):(\d+):\d+\s+-\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    out.push({
      type: "unused-export",
      severity: "medium",
      file: m[1],
      line: Number(m[2]),
      description: `unused export: ${m[3]}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Duplicate-utility-function detection (structural, not textual)      */
/* ------------------------------------------------------------------ */

interface FuncDef {
  name: string;
  file: string;
  line: number;
  body: string;
  lines: number;
}

function findDuplicateFunctions(repo: string, files: string[]): DuplicateFunction[] {
  const defs: FuncDef[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    defs.push(...extractFunctions(f, content));
  }

  // Tokenize every body exactly once (this is the cost of the detector) and
  // precompute its bigram map, so the pair loop is pure set comparison.
  const tokens = defs.map((d) => tokenize(d.body));
  const length = tokens.map((t) => t.length);
  const bigrams = tokens.map(bigramCounts);

  const scored: { a: FuncDef; b: FuncDef; similarity: number; tokens: number }[] = [];
  for (let i = 0; i < defs.length; i++) {
    const la = length[i];
    if (la < MIN_TOKENS) continue;
    for (let j = i + 1; j < defs.length; j++) {
      if (defs[i].file === defs[j].file) continue; // only cross-file duplication
      const lb = length[j];
      if (lb < MIN_TOKENS) continue;
      // Dice similarity can only reach the 0.85 threshold when the two bodies
      // are close in size — skip badly unbalanced pairs without touching the maps.
      const min = Math.min(la, lb);
      const max = Math.max(la, lb);
      if (min / max < 0.43) continue;
      const sim = diceFrom(bigrams[i], bigrams[j], la, lb);
      if (sim >= SIM_THRESHOLD) {
        scored.push({ a: defs[i], b: defs[j], similarity: sim, tokens: Math.min(la, lb) });
      }
    }
  }

  scored.sort((x, y) => y.similarity - x.similarity || y.tokens - x.tokens);

  const results: DuplicateFunction[] = [];
  const seenKeys = new Set<string>();
  for (const s of scored.slice(0, MAX_DUP_FINDINGS * 4)) {
    if (results.length >= MAX_DUP_FINDINGS) break;
    const aPath = path.resolve(s.a.file);
    const bPath = path.resolve(s.b.file);
    const key = [aPath, s.a.name, bPath, s.b.name].join("\u0000");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const names = new Set([s.a.name, s.b.name]);
    results.push({
      name: names.size === 1 ? s.a.name : `${s.a.name}/${s.b.name}`,
      files: [
        { file: s.a.file, line: s.a.line },
        { file: s.b.file, line: s.b.line },
      ],
      lines: Math.max(s.a.lines, s.b.lines),
      similarity: s.similarity,
    });
  }
  return results;
}

/**
 * Extract function declarations and arrow-function assignments with matched
 * brace bodies. Deliberately lightweight (no full parse) — good enough to find
 * real clone candidates.
 */
function extractFunctions(file: string, content: string): FuncDef[] {
  const defs: FuncDef[] = [];
  const fnRe = /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(content)) !== null) {
    const name = m[1];
    const open = findNextBrace(content, m.index + m[0].length);
    if (open < 0) continue;
    const close = findMatchingBrace(content, open);
    if (close < 0) continue;
    pushDef(defs, file, name, content, m.index, open, close);
  }
  const arrowRe =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = arrowRe.exec(content)) !== null) {
    const name = m[1];
    const open = findNextBrace(content, m.index + m[0].length);
    if (open < 0) continue;
    const close = findMatchingBrace(content, open);
    if (close < 0) continue;
    pushDef(defs, file, name, content, m.index, open, close);
  }
  return defs;
}

function pushDef(
  defs: FuncDef[],
  file: string,
  name: string,
  content: string,
  start: number,
  open: number,
  close: number,
): void {
  defs.push({
    name,
    file,
    line: lineOf(content, start),
    body: content.slice(open + 1, close),
    lines: countLines(content.slice(open, close + 1)),
  });
}

function countLines(body: string): number {
  let n = 0;
  for (const ch of body) if (ch === "\n") n++;
  return n + 1;
}

/** Find the index of the next `{` after `from`, ignoring nothing (params are simple). */
function findNextBrace(content: string, from: number): number {
  return content.indexOf("{", from);
}

/** Find the index of the brace matching `open` (index of a `{`). */
function findMatchingBrace(content: string, open: number): number {
  let depth = 0;
  let state: "code" | "single" | "double" | "template" | "template-expr" | "line" | "block" = "code";
  let i = open;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") state = "line";
      else if (ch === "/" && next === "*") state = "block";
      else if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      else if (ch === "`") state = "template";
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    } else if (state === "line") {
      if (ch === "\n") state = "code";
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i++;
      }
    } else if (state === "single") {
      if (ch === "\\") i++;
      else if (ch === "'") state = "code";
    } else if (state === "double") {
      if (ch === "\\") i++;
      else if (ch === '"') state = "code";
    } else if (state === "template") {
      if (ch === "\\") i++;
      else if (ch === "`") state = "code";
      else if (ch === "$" && next === "{") {
        state = "template-expr";
        i++;
      }
    } else if (state === "template-expr") {
      if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      else if (ch === "`") state = "template";
      else if (ch === "}") state = "template";
    }
    i++;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Tokenization + similarity                                           */
/* ------------------------------------------------------------------ */

function tokenize(body: string): string[] {
  const re =
    /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|=>|\+\+|--|==|!=|<=|>=|&&|\|\||[^\sA-Za-z0-9_$"'`]+/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = m[0];
    if (/^[A-Za-z_$][\w$]*$/.test(t)) tokens.push("I");
    else if (/^\d/.test(t)) tokens.push("N");
    else if (t.startsWith('"') || t.startsWith("'") || t.startsWith("`")) tokens.push("S");
    else tokens.push(t);
  }
  return tokens;
}

function bigramCounts(arr: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < arr.length - 1; i++) {
    const k = arr[i] + "\u0000" + arr[i + 1];
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient from precomputed bigram counts; la/lb are token counts. */
function diceFrom(
  ma: Map<string, number>,
  mb: Map<string, number>,
  la: number,
  lb: number,
): number {
  let inter = 0;
  const smaller = ma.size <= mb.size ? ma : mb;
  const other = smaller === ma ? mb : ma;
  for (const [k, n] of smaller) {
    const bn = other.get(k);
    if (bn != null) inter += Math.min(n, bn);
  }
  return (2 * inter) / (la - 1 + lb - 1);
}