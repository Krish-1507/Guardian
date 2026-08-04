import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type TestFramework = "jest" | "vitest" | "node-test" | "pytest";

/**
 * framework.ts — figure out how the target repo runs tests, and run a single
 * repro test file through that runner. Guardian never invents a test setup; it
 * uses whatever the repo already has (jest/vitest/pytest), falling back to
 * Node's built-in `node --test` for JS repos with no framework (zero deps).
 */

export function detectTestFramework(repo: string): TestFramework | null {
  const pkgPath = path.join(repo, "package.json");
  if (fs.existsSync(pkgPath)) {
    let pkg: any = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      pkg = {};
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (deps.jest) return "jest";
    if (deps.vitest) return "vitest";
    return "node-test";
  }
  if (
    fs.existsSync(path.join(repo, "requirements.txt")) ||
    fs.existsSync(path.join(repo, "pyproject.toml")) ||
    fs.existsSync(path.join(repo, "setup.py"))
  ) {
    return "pytest";
  }
  return null;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Extension for a repro test file in this repo's framework. */
export function reproExtension(framework: TestFramework): string {
  switch (framework) {
    case "jest":
    case "vitest":
      return ".test.js";
    case "node-test":
      return ".test.mjs";
    case "pytest":
      return ".py";
  }
}

/** Run a single test file and report pass/fail. */
export function runTestFile(
  repo: string,
  file: string,
  extraEnv: Record<string, string> = {},
  timeoutMs = 120000,
): Promise<RunResult> {
  const framework = detectTestFramework(repo);
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];
    const local = (rel: string) => path.join(repo, rel);
    switch (framework) {
      case "jest": {
        // Prefer the repo's own jest binary (like the reliability analyzer does)
        // to avoid npx/.cmd resolution issues on Windows.
        const jestBin = local("node_modules/jest/bin/jest.js");
        if (fs.existsSync(jestBin)) {
          cmd = "node";
          args = [jestBin, file, "--runInBand", "--runTestsByPath"];
        } else {
          cmd = "npx";
          args = ["jest", file, "--runInBand", "--runTestsByPath"];
        }
        break;
      }
      case "vitest": {
        const vitestBin = local("node_modules/vitest/vitest.mjs");
        if (fs.existsSync(vitestBin)) {
          cmd = "node";
          args = [vitestBin, "run", file, "--reporter=basic"];
        } else {
          cmd = "npx";
          args = ["vitest", "run", file, "--reporter=basic"];
        }
        break;
      }
      case "pytest": {
        cmd = "python";
        args = ["-m", "pytest", file, "-q"];
        break;
      }
      case "node-test":
      default: {
        cmd = "node";
        args = ["--test", file];
        break;
      }
    }
    const child = spawn(cmd, args, {
      cwd: repo,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut: false });
    });
    child.on("error", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, timedOut: false });
    });
  });
}

export function frameworkLabel(framework: TestFramework | null): string {
  switch (framework) {
    case "jest":
      return "jest";
    case "vitest":
      return "vitest";
    case "pytest":
      return "pytest";
    case "node-test":
      return "node --test (built-in)";
    default:
      return "unknown";
  }
}
