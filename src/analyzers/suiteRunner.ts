import fs from "node:fs";
import path from "node:path";
import { commandExists, detectLanguage, safeExecAsync } from "./util.js";

/**
 * suiteRunner.ts — run a repo's test suite for non-JS/TS stacks and report
 * per-test outcomes (or a whole-suite pseudo-test when the runner only exposes
 * aggregates). Shared by the tests analyzer (one run) and the reliability
 * analyzer (N sequential runs for flakiness detection).
 *
 * Honest contract: a runner that cannot produce parseable outcomes returns
 * `unparseable` instead of inventing pass counts; a repo with no tests at all
 * returns null so callers report "no tests", not a fabricated clean run.
 */

export interface SuiteRun {
  framework: string;
  tests: { name: string; file?: string; status: "passed" | "failed" }[];
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  /** Set when the toolchain ran but produced no parseable results. */
  unparseable?: string;
}

/** Run the suite for Go/Rust/Flutter/.NET/Java repos; null if no toolchain or no tests. */
export async function runNonJsSuite(repo: string): Promise<SuiteRun | null> {
  switch (detectLanguage(repo)) {
    case "go":
      return runGo(repo);
    case "rust":
      return runCargo(repo);
    case "dart":
      return runFlutter(repo);
    case "dotnet":
      return runDotnet(repo);
    case "java":
      return runJava(repo);
    default:
      return null;
  }
}

/** True when the language's test toolchain is available (PATH or repo wrapper). */
export function nonJsToolchainPresent(lang: string, repo: string): boolean {
  switch (lang) {
    case "go":
      return commandExists("go");
    case "rust":
      return commandExists("cargo");
    case "dart":
      return commandExists("flutter");
    case "dotnet":
      return commandExists("dotnet");
    case "java":
      return commandExists("mvn") || gradleCommand(repo) !== null;
    default:
      return false;
  }
}

function gradleCommand(repo: string): string | null {
  for (const f of ["gradlew.bat", "gradlew"]) {
    const p = path.join(repo, f);
    if (fs.existsSync(p)) return p;
  }
  return commandExists("gradle") ? "gradle" : null;
}

/** Strip ANSI escapes so text-summary regexes work across terminal configs. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function pseudoSuite(
  framework: string,
  failed: number,
  passed: number,
  total: number,
  durationMs: number,
): SuiteRun {
  return {
    framework,
    tests: [
      {
        name: failed > 0 ? `(${framework} suite: failures)` : `(${framework} suite)`,
        status: failed > 0 ? "failed" : "passed",
      },
    ],
    total,
    passed,
    failed,
    durationMs,
  };
}

/* ------------------------------------------------------------------ */
/* Go: `go test -json ./...`                                           */
/* ------------------------------------------------------------------ */

/** Pure parser for `go test -json` stream. Exported for unit tests. */
export function parseGoTestOutput(stdout: string): {
  tests: SuiteRun["tests"];
  passed: number;
  failed: number;
} {
  const tests: SuiteRun["tests"] = [];
  let failed = 0;
  let passed = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let obj: any;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (typeof obj.Test !== "string" || !obj.Test) continue;
    if (obj.Action === "fail") {
      failed++;
      tests.push({ name: obj.Test, file: obj.Package, status: "failed" });
    } else if (obj.Action === "pass" || obj.Action === "skip") {
      passed++;
      tests.push({ name: obj.Test, file: obj.Package, status: "passed" });
    }
  }
  return { tests, passed, failed };
}

async function runGo(repo: string): Promise<SuiteRun | null> {
  if (!commandExists("go")) return null;
  const start = performance.now();
  const r = await safeExecAsync("go", ["test", "-json", "./..."], repo, 300000);
  const durationMs = Math.round(performance.now() - start);
  const { tests, passed, failed } = parseGoTestOutput(r.stdout);
  if (tests.length === 0) {
    if (r.code === 0) return null;
    return {
      framework: "go test",
      tests: [],
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
      unparseable: "go test produced no parseable results",
    };
  }
  return { framework: "go test", tests, total: tests.length, passed, failed, durationMs };
}

/* ------------------------------------------------------------------ */
/* Rust: `cargo test -- --format json` (libtest JSON, Rust >= 1.70)    */
/* ------------------------------------------------------------------ */

/** Pure parser for cargo's libtest JSON stream. Exported for unit tests. */
export function parseCargoTestOutput(stdout: string): {
  tests: SuiteRun["tests"];
  passed: number;
  failed: number;
} {
  const tests: SuiteRun["tests"] = [];
  let failed = 0;
  let passed = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let obj: any;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (obj.type !== "test" || typeof obj.event !== "string") continue;
    if (obj.event === "failed") {
      failed++;
      tests.push({ name: obj.name ?? "", status: "failed" });
    } else if (obj.event === "ok" || obj.event === "ignored") {
      passed++;
      tests.push({ name: obj.name ?? "", status: "passed" });
    }
  }
  return { tests, passed, failed };
}

async function runCargo(repo: string): Promise<SuiteRun | null> {
  if (!commandExists("cargo")) return null;
  const start = performance.now();
  const r = await safeExecAsync("cargo", ["test", "--", "--format", "json"], repo, 300000);
  const durationMs = Math.round(performance.now() - start);
  const { tests, passed, failed } = parseCargoTestOutput(r.stdout);
  if (tests.length === 0) {
    if (r.code === 0) return null;
    return {
      framework: "cargo test",
      tests: [],
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
      unparseable: "cargo test produced no parseable results (--format json needs Rust >= 1.70)",
    };
  }
  return { framework: "cargo test", tests, total: tests.length, passed, failed, durationMs };
}

/* ------------------------------------------------------------------ */
/* Flutter: `flutter test --machine` (JSON lines)                      */
/* ------------------------------------------------------------------ */

/** Pure parser for flutter --machine stream. Exported for unit tests. */
export function parseFlutterMachineOutput(stdout: string): {
  tests: SuiteRun["tests"];
  passed: number;
  failed: number;
} {
  const names = new Map<number, string>();
  const tests: SuiteRun["tests"] = [];
  let failed = 0;
  let passed = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let obj: any;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (obj.type === "testStart" && typeof obj.testID === "number") {
      names.set(obj.testID, obj.name ?? "");
    } else if (obj.type === "testDone" && typeof obj.testID === "number") {
      if (obj.result === "failure") {
        failed++;
        tests.push({ name: names.get(obj.testID) ?? "", status: "failed" });
      } else if (obj.result === "success" || obj.result === "skipped") {
        passed++;
        tests.push({ name: names.get(obj.testID) ?? "", status: "passed" });
      }
    }
  }
  return { tests, passed, failed };
}

async function runFlutter(repo: string): Promise<SuiteRun | null> {
  if (!commandExists("flutter")) return null;
  const start = performance.now();
  const r = await safeExecAsync("flutter", ["test", "--machine"], repo, 300000);
  const durationMs = Math.round(performance.now() - start);
  const { tests, passed, failed } = parseFlutterMachineOutput(r.stdout);
  if (tests.length === 0) {
    if (r.code === 0) return null;
    return {
      framework: "flutter test",
      tests: [],
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
      unparseable: "flutter test produced no parseable results",
    };
  }
  return { framework: "flutter test", tests, total: tests.length, passed, failed, durationMs };
}

/* ------------------------------------------------------------------ */
/* .NET: `dotnet test` (text summary)                                  */
/* ------------------------------------------------------------------ */

/** Pure parser for the dotnet test summary line. Exported for unit tests. */
export function parseDotnetSummary(output: string): {
  passed: number;
  failed: number;
  total: number;
} | null {
  const out = stripAnsi(output);
  const m = out.match(
    /\(?(?:Passed!|Failed!|Skipped!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/i,
  );
  if (!m) return null;
  return { passed: Number(m[2]), failed: Number(m[1]), total: Number(m[4]) };
}

async function runDotnet(repo: string): Promise<SuiteRun | null> {
  if (!commandExists("dotnet")) return null;
  const start = performance.now();
  const r = await safeExecAsync("dotnet", ["test"], repo, 300000);
  const durationMs = Math.round(performance.now() - start);
  const parsed = parseDotnetSummary(r.stdout + "\n" + r.stderr);
  if (!parsed) {
    if (r.code === 0) return null;
    return {
      framework: "dotnet test",
      tests: [],
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
      unparseable: "dotnet test output not parseable",
    };
  }
  if (parsed.total === 0) return null;
  return pseudoSuite("dotnet test", parsed.failed, parsed.passed, parsed.total, durationMs);
}

/* ------------------------------------------------------------------ */
/* Java: maven (surefire summaries) or gradle (build/test-results XML) */
/* ------------------------------------------------------------------ */

async function runJava(repo: string): Promise<SuiteRun | null> {
  if (fs.existsSync(path.join(repo, "pom.xml"))) return runMaven(repo);
  if (gradleCommand(repo)) return runGradle(repo);
  return null;
}

/** Pure parser for maven surefire "Tests run:" summaries. Exported for unit tests. */
export function parseMavenSummary(output: string): { passed: number; failed: number; total: number } {
  let total = 0;
  let failed = 0;
  const re = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    total += Number(m[1]);
    failed += Number(m[2]) + Number(m[3]);
  }
  return { passed: total - failed, failed, total };
}

async function runMaven(repo: string): Promise<SuiteRun | null> {
  const start = performance.now();
  const r = await safeExecAsync("mvn", ["test"], repo, 300000);
  const durationMs = Math.round(performance.now() - start);
  const parsed = parseMavenSummary(r.stdout + "\n" + r.stderr);
  if (parsed.total === 0) {
    if (r.code === 0) return null;
    return {
      framework: "maven (surefire)",
      tests: [],
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
      unparseable: "maven produced no surefire test summary",
    };
  }
  return pseudoSuite("maven (surefire)", parsed.failed, parsed.passed, parsed.total, durationMs);
}

/** Pure parser for gradle's build/test-results XML. Exported for unit tests. */
export function parseGradleXml(xml: string): { passed: number; failed: number; total: number } {
  let total = 0;
  let failed = 0;
  for (const tag of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    const a = tag[1];
    const tests = /tests="(\d+)"/.exec(a);
    if (!tests) continue;
    const failures = /failures="(\d+)"/.exec(a);
    const errors = /errors="(\d+)"/.exec(a);
    total += Number(tests[1]);
    failed += Number(failures?.[1] ?? 0) + Number(errors?.[1] ?? 0);
  }
  return { passed: total - failed, failed, total };
}

async function runGradle(repo: string): Promise<SuiteRun | null> {
  const cmd = gradleCommand(repo);
  if (!cmd) return null;
  const start = performance.now();
  const r = await safeExecAsync(cmd, ["test"], repo, 300000);
  const durationMs = Math.round(performance.now() - start);
  const out = r.stdout + "\n" + r.stderr;

  let parsed: { passed: number; failed: number; total: number } | null = null;
  const resultsDir = path.join(repo, "build", "test-results", "test");
  if (fs.existsSync(resultsDir)) {
    const stack = [resultsDir];
    while (stack.length) {
      const dir = stack.pop() as string;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) stack.push(path.join(dir, e.name));
        else if (e.isFile() && e.name.endsWith(".xml")) {
          try {
            const p = parseGradleXml(fs.readFileSync(path.join(dir, e.name), "utf8"));
            parsed = parsed
              ? {
                  passed: parsed.passed + p.passed,
                  failed: parsed.failed + p.failed,
                  total: parsed.total + p.total,
                }
              : p;
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  if (!parsed || parsed.total === 0) {
    if (/BUILD SUCCESSFUL/i.test(out)) return null;
    return {
      framework: "gradle",
      tests: [],
      total: 0,
      passed: 0,
      failed: 0,
      durationMs,
      unparseable: "gradle produced no test-results XML",
    };
  }
  return pseudoSuite("gradle", parsed.failed, parsed.passed, parsed.total, durationMs);
}
