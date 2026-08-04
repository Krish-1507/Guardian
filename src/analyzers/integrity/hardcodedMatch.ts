import type { FileChange, IntegrityFinding } from "./types.js";
import { isTestFile } from "./helpers.js";

/**
 * hardcodedMatch — cross-reference literals introduced in non-test (app) files
 * against expected values asserted in the test files' diff.
 *
 * SUSPICIOUS ONLY (never CONFIRMED): matching a test's expected value is strong
 * evidence the implementation was hardcoded to pass rather than correctly
 * computed, but a human must confirm (e.g. a shared constant is a legit fixture).
 */

const ASSERT_SINGLE_RE =
  /(?:toBe|toEqual|toStrictEqual|toMatch|toMatchObject)\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+\.?\d*)\s*\)/g;
const ASSERT_TWO_RE =
  /(?:assertEqual|assertEquals|assert\.equal|assert\.strictEqual|assertDeepEqual|assert deepEqual|assertAlmostEqual|self\.assertEqual)\s*\([^,]*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+\.?\d*)\s*\)/g;
const ASSERT_PY_RE =
  /\bassert\s+[^=]*==\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+\.?\d*)/g;
const STR_RE = /'[^']*'|"[^"]*"/g;
const NUM_RE = /(?<!\w)(?:-?\d+\.\d+|-?\d+)(?!\w|\.)/g;

type Norm = { kind: "num"; value: number } | { kind: "str"; value: string };

function normalize(raw: string): Norm | null {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return { kind: "str", value: t.slice(1, -1) };
  }
  const n = Number(t);
  if (!Number.isNaN(n)) return { kind: "num", value: n };
  return null;
}

function trivial(n: Norm): boolean {
  if (n.kind === "num" && (n.value === 0 || n.value === 1)) return true;
  if (n.kind === "str" && n.value === "") return true;
  return false;
}

export function detectHardcodedMatch(changes: FileChange[]): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  // App literals introduced in this change.
  const appLiterals: { norm: Norm; file: string; line: number }[] = [];
  for (const c of changes) {
    if (isTestFile(c.path)) continue;
    for (const a of c.added) {
      for (const m of a.text.matchAll(STR_RE)) {
        const n = normalize(m[0]);
        if (n && !trivial(n)) appLiterals.push({ norm: n, file: c.path, line: a.line });
      }
      for (const m of a.text.matchAll(NUM_RE)) {
        const n = normalize(m[0]);
        if (n && !trivial(n)) appLiterals.push({ norm: n, file: c.path, line: a.line });
      }
    }
  }

  // Expected values asserted in test files' diff.
  const testExpected: { norm: Norm; file: string; line: number }[] = [];
  for (const c of changes) {
    if (!isTestFile(c.path)) continue;
    for (const a of c.added) {
      for (const m of a.text.matchAll(ASSERT_SINGLE_RE)) {
        const n = normalize(m[1]);
        if (n) testExpected.push({ norm: n, file: c.path, line: a.line });
      }
      for (const m of a.text.matchAll(ASSERT_TWO_RE)) {
        const n = normalize(m[1]);
        if (n) testExpected.push({ norm: n, file: c.path, line: a.line });
      }
      for (const m of a.text.matchAll(ASSERT_PY_RE)) {
        const n = normalize(m[1]);
        if (n) testExpected.push({ norm: n, file: c.path, line: a.line });
      }
    }
  }

  for (const app of appLiterals) {
    for (const t of testExpected) {
      if (app.norm.kind === t.norm.kind && app.norm.value === t.norm.value) {
        findings.push({
          detector: "hardcodedMatch",
          pattern: "hardcoded-matches-test-expectation",
          confidence: "suspicious",
          file: app.file,
          line: app.line,
          evidence: `literal ${JSON.stringify(app.norm.value)} introduced in app code matches an expected value asserted in the test "${t.file}:${t.line}"`,
          file2: t.file,
          line2: t.line,
        });
      }
    }
  }

  return findings;
}
