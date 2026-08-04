import type { FileChange, FileStatus, DiffLine } from "./types.js";

/** Map a file path to its language for analyzer selection. */
export function languageOf(path: string): "js" | "ts" | "python" | "unknown" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".pyw")) return "python";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  ) {
    return "ts";
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "js";
  }
  return "unknown";
}

/** A test file: foo.test.js, foo.spec.tsx, __tests__/x, or test_*.py / *_test.py. */
export function isTestFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (/\.(test|spec)\.[jt]sx?$/.test(normalized)) return true;
  if (/[\\/]__tests?__[\\/]/.test(normalized)) return true;
  const base = normalized.split("/").pop() ?? "";
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) return true;
  return false;
}

/**
 * A "test runner config" that legitimately contains suppressions / exits and
 * must not be flagged by suppressionCreep / exitCheat.
 */
export function isTestRunnerConfig(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return /\.(config|conf)\.[jt]sx?$/.test(normalized) || /(^|\/)conftest\.py$/.test(normalized);
}

/**
 * A legitimate CLI entrypoint (shebang / bin script) — `process.exit(0)` here is
 * normal and must NOT be flagged as an exit cheat.
 */
export function isCliEntrypoint(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const base = (normalized.split("/").pop() ?? "").toLowerCase();
  if (base === "cli.ts" || base === "cli.js" || base === "cli.mjs" || base === "cli.cjs") {
    return true;
  }
  if (/[\\/]bin[\\/]/.test(normalized)) return true;
  return false;
}

/** Application code = not a test, not a test-runner config, not a CLI entrypoint. */
export function isAppCode(path: string): boolean {
  return !isTestFile(path) && !isTestRunnerConfig(path) && !isCliEntrypoint(path);
}

/** Build a FileChange helper with added/removed lines and detected language. */
export function makeChange(
  path: string,
  status: FileStatus,
  before: string | undefined,
  after: string | undefined,
  added: DiffLine[],
  removed: DiffLine[],
): FileChange {
  return { path, status, before, after, added, removed, language: languageOf(path) };
}

/** Lines of a file version as DiffLine[] (used for fully-added files). */
export function linesToDiff(text: string): DiffLine[] {
  return text.split(/\r?\n/).map((text, i) => ({ line: i + 1, text }));
}
