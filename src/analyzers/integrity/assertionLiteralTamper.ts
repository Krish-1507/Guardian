import type { FileChange, IntegrityFinding } from "./types.js";
import { isTestFile } from "./helpers.js";

/**
 * assertionLiteralTamper — a diff that changes ONLY the literal right-hand side
 * of an equality/comparison assertion in a test file, with no other change
 * anywhere in the diff, is unambiguous evidence that the expected answer was
 * edited to match the output (e.g. `toBe(8.08)` → `toBe(8.07)` after a
 * half-cent rounding regression, or `assertEqual(x, 8.08)` → `assertEqual(x, 8.07)`).
 *
 * CONFIRMED (unambiguous, auto-block) — but ONLY when the ENTIRE diff is
 * exactly such literal swaps:
 *   - every changed file is a test file, status "modified" (never added,
 *     deleted, or renamed);
 *   - every removed and added line is part of a detected swap (same assertion,
 *     same subject, only the literal differs).
 *
 * If anything else changed alongside (app logic, a new test case, a comment,
 * a loosened tolerance), an honest spec update cannot be ruled out, so this
 * detector stays SILENT rather than risk a false flag. This is deliberately
 * stricter than the other detectors: the guarantee that makes the finding
 * "confirmed" is precisely that there is nothing else in the diff.
 */

interface Swap {
  line: number;
  subject: string;
  suffix: string;
  matcher: string;
  before: string;
  after: string;
}

/** A changed line parsed as `<subject><matcher>(<literal><suffix>`. */
interface ParsedLine {
  subject: string;
  suffix: string;
  matcher: string;
  literal: string;
}

const NUM_LIT = "-?\\d+(?:\\.\\d+)?";
const STR_LIT = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'`;
const LIT_SRC = `${NUM_LIT}|${STR_LIT}|true|false|null|undefined|None|True|False`;
const LIT_AT = new RegExp(`^\\s*(${LIT_SRC})`);

// JS/TS matcher calls, found ANYWHERE on the line but only outside string
// literals: `expect(f()).toBe(8.08);` or `it("x", () => { expect(f()).toBe(8.08) })`.
const JS_CALL_RE = /\b(toBeCloseTo|toStrictEqual|toEqual|toMatchObject|toMatch|toBe)\s*\(/g;

// Python assertEqual-family: assertEqual(<first-arg>, <lit>).
const PY_RE = new RegExp(
  `^(\\s*(?:assertEqual|assertEquals|assertAlmostEqual|assert\\s+deepEqual|assert\\s+almost\\s+equal|self\\s*\\.\\s*assertEqual|assert\\s*\\.\\s*(?:equal|strictEqual|deepEqual|almostEqual))\\s*\\(\\s*)(.+?),\\s*(${LIT_SRC})(\\s*\\)\\s*;?\\s*)$`,
);

// Python `assert <expr> <cmp> <lit>` whole line (optional trailing comment).
const PY_ASSERT_RE = new RegExp(
  `^(\\s*assert\\s+.*?(?:==|!=|<=|>=|<|>)\\s*)(${LIT_SRC})(\\s*(?:#.*)?)$`,
);

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** True when character `index` of `line` lies inside a single/template-quoted string. */
function insideString(line: string, index: number): boolean {
  let inStr: string | null = null;
  for (let i = 0; i < index; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
    }
  }
  return inStr !== null;
}

function parseJsLine(text: string): ParsedLine | null {
  if (/^\s*(\/\/|\*)/.test(text)) return null;
  JS_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JS_CALL_RE.exec(text))) {
    if (insideString(text, m.index)) continue;
    const litStart = m.index + m[0].length;
    const lit = text.slice(litStart).match(LIT_AT);
    if (!lit) continue;
    return {
      subject: norm(text.slice(0, litStart)),
      suffix: norm(text.slice(litStart + lit[0].length)),
      matcher: m[1],
      literal: lit[1],
    };
  }
  return null;
}

function parseLine(text: string): ParsedLine | null {
  // A comment cannot be an assertion — `// expect(x).toBe(8.08)` must not parse.
  if (/^\s*(\/\/|#|\*)/.test(text)) return null;
  const js = parseJsLine(text);
  if (js) return js;
  let m = text.match(PY_RE);
  if (m) {
    return {
      subject: norm(`${m[1]}${m[2]}`),
      suffix: norm(m[4]),
      matcher: "py-assert-func",
      literal: m[3],
    };
  }
  m = text.match(PY_ASSERT_RE);
  if (m) {
    return { subject: norm(m[1]), suffix: norm(m[3]), matcher: "py-assert", literal: m[2] };
  }
  return null;
}

interface FileSwaps {
  swaps: Swap[];
  consumedRemoved: Set<number>;
  consumedAdded: Set<number>;
}

/** Pair up assertion-literal swaps within a single test file's diff. */
function detectSwaps(c: FileChange): FileSwaps {
  const swaps: Swap[] = [];
  const consumedRemoved = new Set<number>();
  const consumedAdded = new Set<number>();
  if (c.status !== "modified" || !c.before || !c.after) return { swaps, consumedRemoved, consumedAdded };

  const removedParsed = new Map<number, ParsedLine>();
  for (const r of c.removed) {
    const p = parseLine(r.text);
    if (p) removedParsed.set(r.line, p);
  }

  for (const a of c.added) {
    const pa = parseLine(a.text);
    if (!pa) continue;
    for (const r of c.removed) {
      if (Math.abs(a.line - r.line) > 1) continue;
      if (consumedRemoved.has(r.line)) continue;
      const pr = removedParsed.get(r.line);
      if (!pr) continue;
      if (pr.subject !== pa.subject) continue;
      if (pr.suffix !== pa.suffix) continue;
      if (pr.literal === pa.literal) continue;
      swaps.push({
        line: a.line,
        subject: pa.subject,
        suffix: pa.suffix,
        matcher: pa.matcher,
        before: pr.literal,
        after: pa.literal,
      });
      consumedRemoved.add(r.line);
      consumedAdded.add(a.line);
      break;
    }
  }
  return { swaps, consumedRemoved, consumedAdded };
}

export function detectAssertionLiteralTamper(changes: FileChange[]): IntegrityFinding[] {
  const perFile: Map<string, FileSwaps> = new Map();

  // Phase 1 — find literal swaps in each test file.
  for (const c of changes) {
    if (!isTestFile(c.path)) continue;
    perFile.set(c.path, detectSwaps(c));
  }

  // Phase 2 — purity gate over the ENTIRE diff: nothing may exist besides the
  // swaps themselves. Any app-code change, added/deleted/renamed file, or
  // non-swap line (new test case, comment, loosened assertion) suppresses all
  // findings — an honest spec update is indistinguishable from a cheat then.
  for (const c of changes) {
    if (c.added.length === 0 && c.removed.length === 0) continue;
    const swaps = perFile.get(c.path);
    if (!swaps || swaps.swaps.length === 0) return [];
    if (c.status !== "modified" || !isTestFile(c.path)) return [];
    if (c.removed.length !== swaps.consumedRemoved.size) return [];
    if (c.added.length !== swaps.consumedAdded.size) return [];
  }

  const findings: IntegrityFinding[] = [];
  for (const [file, fs] of perFile) {
    if (fs.swaps.length === 0) continue;
    const evidence = fs.swaps
      .map(
        (s) =>
          `expected value in an equality/comparison assertion changed from ${s.before} to ${s.after} at line ${s.line}`,
      )
      .join("; ");
    findings.push({
      detector: "assertionLiteralTamper",
      pattern: "assertion-expected-value-changed",
      confidence: "confirmed",
      file,
      line: fs.swaps[0].line,
      evidence:
        `${evidence} — with no other change in the diff, the expected answer was ` +
        `edited to match the output rather than the logic being fixed`,
    });
  }
  return findings;
}
