import type { FileChange, IntegrityFinding } from "./types.js";
import { isTestFile } from "./helpers.js";

/**
 * mockOverreach — when a test file's diff mocks/stubs/patches the module UNDER
 * TEST (rather than its external dependencies like network/DB), it can fake a
 * passing result for code that was never really executed.
 *
 * SUSPICIOUS ONLY (never CONFIRMED): distinguishing "mock the SUT" from "mock a
 * dependency" is heuristic; a human must confirm it wasn't a legitimate seam.
 */

const MOCK_RE =
  /(?:jest|vi|sinon|td|module)\s*\.\s*(?:mock|spyOn|stub|patch)\s*\(\s*['"`]?([^'"`\s,)]+)['"`]?/gi;
const PY_PATCH_RE = /@mock\.patch\s*\(\s*['"`]([^'"`]+)['"`]/gi;
const MONKEY_RE = /monkeypatch\.setattr\s*\(\s*([^,)\s]+)/gi;

function moduleUnderTest(path: string): string[] {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const names: string[] = [];
  let m = base;
  m = m.replace(/\.(test|spec)\.[^.]+$/, "");
  m = m.replace(/^test_/, "");
  m = m.replace(/_test$/, "");
  names.push(m);
  names.push(m + ".js");
  names.push(m + ".ts");
  names.push(m + ".py");
  return names;
}

function basenameOf(target: string): string {
  const cleaned = target.replace(/['"`]/g, "").replace(/^.*[\\/]/, "");
  return cleaned.replace(/\.[^.]+$/, "");
}

function targetMatches(target: string, candidates: string[]): boolean {
  const base = basenameOf(target).toLowerCase();
  return candidates.some((c) => c.toLowerCase() === base);
}

export function detectMockOverreach(changes: FileChange[]): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  for (const c of changes) {
    if (!isTestFile(c.path)) continue;
    if (c.status === "added" || c.status === "modified") {
      const candidates = moduleUnderTest(c.path);
      for (const a of c.added) {
        const text = a.text;
        let hit = false;
        for (const re of [MOCK_RE, MONKEY_RE, PY_PATCH_RE]) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text))) {
            const target = m[1];
            if (targetMatches(target, candidates)) {
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
        if (hit) {
          findings.push({
            detector: "mockOverreach",
            pattern: "module-under-test-mocked",
            confidence: "suspicious",
            file: c.path,
            line: a.line,
            evidence: `module under test (${candidates[0]}) appears to be mocked/stubbed/patched in its own test: ${text.trim()}`,
          });
        }
      }
    }
  }

  return findings;
}
