import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Language = "js" | "python" | "unknown";

export function commandExists(cmd: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function safeExec(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs = 120000,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(file, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      code: typeof err.status === "number" ? err.status : -1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

/**
 * Run a shell command (needed for shell redirection, e.g. `npm audit --json >
 * file`, which pipe-capture fails to retrieve on some platforms).
 */
export function safeExecShell(
  command: string,
  cwd: string,
  timeoutMs = 120000,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      code: typeof err.status === "number" ? err.status : -1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

export function detectLanguage(repo: string): Language {
  if (fs.existsSync(path.join(repo, "package.json"))) return "js";
  if (
    fs.existsSync(path.join(repo, "requirements.txt")) ||
    fs.existsSync(path.join(repo, "pyproject.toml")) ||
    fs.existsSync(path.join(repo, "setup.py"))
  )
    return "python";
  return "unknown";
}

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".guardian",
  "coverage",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  // Fixture / seed directories that are not part of the codebase under analysis.
  "demo-repo",
  "templates",
]);

export function walkFiles(root: string, exts: string[]): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        stack.push(path.join(dir, e.name));
      } else if (e.isFile()) {
        if (exts.includes(path.extname(e.name))) out.push(path.join(dir, e.name));
      }
    }
  }
  return out;
}

/** 1-based line number of a character index in a string. */
export function lineOf(content: string, index: number): number {
  let line = 1;
  const end = Math.min(index, content.length);
  for (let i = 0; i < end; i++) if (content[i] === "\n") line++;
  return line;
}

export function dirSize(root: string): number {
  let total = 0;
  const stack = [root];
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
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}
