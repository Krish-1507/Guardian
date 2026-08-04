import type { FileChange, IntegrityFinding } from "./types.js";
import { isTestFile } from "./helpers.js";

/**
 * testTamper — compares test files before/after.
 *
 * CONFIRMED (unambiguous, auto-block):
 *   - a whole test file was deleted
 *   - an entire test case block (by name) was removed
 * SUSPICIOUS (human judgment):
 *   - a test was marked skip/xit/pending/@pytest.mark.skip
 *   - a numeric tolerance/threshold literal was loosened
 *   - an exact-equality assertion was replaced with a looser one on the same line
 */

interface TestName {
  name: string;
  line: number;
}

function extractTestNames(code: string | undefined): TestName[] {
  if (!code) return [];
  const out: TestName[] = [];
  const js = /(?:test|it|fit)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = js.exec(code))) out.push({ name: m[1], line: lineOf(code, m.index) });
  const py = /def\s+(test_\w+)\s*\(/g;
  while ((m = py.exec(code))) out.push({ name: m[1], line: lineOf(code, m.index) });
  return out;
}

function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i++) if (code[i] === "\n") line++;
  return line;
}

const SKIP_RE =
  /\b(xit|xtest|xdescribe|fit|fdescribe|test\s*\.\s*skip|it\s*\.\s*skip|describe\s*\.\s*skip|pending\s*\(|@pytest\.mark\.(skip|skipif|xfail))\b/;

const TOLERANCE_KEYWORDS = [
  "tolerance",
  "threshold",
  "epsilon",
  "timeout",
  "retries",
  "maxretries",
  "accuracy",
  "precision",
  "limit",
  "interval",
  "latency",
];

const EXACT_RE =
  /\b(toBe\(|toEqual\(|toStrictEqual\(|assertEqual\(|assertEquals\(|assert\.equal\(|assert\.strictEqual\(|assert\.deepEqual\(|assert deepEqual|assert almost equal)\b/;
const LOOSER_RE =
  /\b(toBeGreaterThan\(|toBeGreaterThanOrEqual\(|toBeLessThan\(|toBeLessThanOrEqual\(|toBeCloseTo\(|toBeTruthy\(|assertTrue\(|assertGreater|assertLess|assert almost|assertWarns)\b/;

export function detectTestTamper(changes: FileChange[]): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  for (const c of changes) {
    if (!isTestFile(c.path)) continue;

    // CONFIRMED: whole test file deleted.
    if (c.status === "deleted") {
      findings.push({
        detector: "testTamper",
        pattern: "test-file-deleted",
        confidence: "confirmed",
        file: c.path,
        evidence: `entire test file "${c.path}" was deleted in this change`,
      });
      continue;
    }

    const beforeNames = extractTestNames(c.before);
    const afterNames = new Set(extractTestNames(c.after).map((n) => n.name));
    const beforeNameSet = new Set(beforeNames.map((n) => n.name));

    // CONFIRMED: an entire test case (by name) was removed.
    for (const n of beforeNames) {
      if (!afterNames.has(n.name)) {
        findings.push({
          detector: "testTamper",
          pattern: "test-case-removed",
          confidence: "confirmed",
          file: c.path,
          line: n.line,
          evidence: `test case "${n.name}" present before but gone after — whole test block removed`,
        });
      }
    }

    // SUSPICIOUS: test marked as skipped.
    for (const a of c.added) {
      if (SKIP_RE.test(a.text)) {
        findings.push({
          detector: "testTamper",
          pattern: "test-marked-skipped",
          confidence: "suspicious",
          file: c.path,
          line: a.line,
          evidence: `test marked as skipped/suppressed: ${a.text.trim()}`,
        });
      }
    }

    // SUSPICIOUS: a numeric tolerance/threshold literal was loosened.
    const loosened = detectLoosenedTolerance(c);
    findings.push(...loosened);

    // SUSPICIOUS: exact-equality replaced with a looser assertion on the same line.
    const loosenedEq = detectLoosenedEquality(c);
    findings.push(...loosenedEq);
  }

  return findings;
}

function detectLoosenedTolerance(c: FileChange): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  const addedByKw = new Map<string, number[]>();
  const removedByKw = new Map<string, number[]>();

  const scan = (text: string, bucket: Map<string, number[]>) => {
    const lower = text.toLowerCase();
    for (const kw of TOLERANCE_KEYWORDS) {
      const re = new RegExp(`${kw}\\D*?(\\d+\\.?\\d*)`, "i");
      const m = lower.match(re);
      if (m) {
        const v = parseFloat(m[1]);
        if (!Number.isNaN(v)) (bucket.get(kw) ?? bucket.set(kw, []).get(kw)!).push(v);
      }
    }
  };

  for (const a of c.added) scan(a.text, addedByKw);
  for (const r of c.removed) scan(r.text, removedByKw);

  for (const [kw, added] of addedByKw) {
    const removed = removedByKw.get(kw);
    if (!removed) continue;
    const maxAdded = Math.max(...added);
    const maxRemoved = Math.max(...removed);
    if (maxAdded > maxRemoved) {
      out.push({
        detector: "testTamper",
        pattern: "tolerance-loosened",
        confidence: "suspicious",
        file: c.path,
        evidence: `numeric ${kw} increased from ${maxRemoved} to ${maxAdded} (threshold/tolerance loosened)`,
      });
    }
  }
  return out;
}

function detectLoosenedEquality(c: FileChange): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  for (const r of c.removed) {
    if (!EXACT_RE.test(r.text)) continue;
    for (const a of c.added) {
      if (Math.abs(a.line - r.line) > 3) continue;
      if (LOOSER_RE.test(a.text)) {
        out.push({
          detector: "testTamper",
          pattern: "equality-loosened",
          confidence: "suspicious",
          file: c.path,
          line: a.line,
          evidence: `exact-equality assertion replaced with a looser one near line ${r.line}: "${a.text.trim()}"`,
        });
        break;
      }
    }
  }
  return out;
}
