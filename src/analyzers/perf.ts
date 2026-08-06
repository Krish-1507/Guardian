import fs from "node:fs";
import path from "node:path";
import { commandExists, detectLanguage, dirSize, safeExecAsync } from "./util.js";
import type { PerfResult } from "./types.js";

export async function analyzePerf(repo: string): Promise<PerfResult> {
  const lang = detectLanguage(repo);
  if (lang === "js") return jsPerf(repo);
  if (lang === "go") return nativePerf(repo, "go", ["build", "./..."], null);
  if (lang === "rust") return nativePerf(repo, "cargo", ["build"], null);
  if (lang === "dart") return nativePerf(repo, "flutter", ["build", "web"], "build/web");
  if (lang === "dotnet") return nativePerf(repo, "dotnet", ["build"], "bin");
  if (lang === "java") {
    if (fs.existsSync(path.join(repo, "pom.xml"))) {
      return nativePerf(repo, "mvn", ["package", "-DskipTests"], "target");
    }
    const gradle = gradleCmd(repo);
    if (gradle) return nativePerf(repo, gradle, ["assemble"], "build/libs");
    return { status: "skipped", note: "no java build tool found (mvn or gradle)" };
  }
  return { status: "skipped", note: "no build command for this language" };
}

function gradleCmd(repo: string): string | null {
  const wrapperName = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  const wrapper = path.join(repo, wrapperName);
  if (fs.existsSync(wrapper)) return wrapper;
  return commandExists("gradle") ? "gradle" : null;
}

/**
 * Generic build-timing for non-JS stacks. `sizeDir` is an output directory
 * relative to the repo (measured when it exists) — some toolchains only expose
 * a meaningful build artifact size after the build.
 */
async function nativePerf(
  repo: string,
  cmd: string,
  args: string[],
  sizeDir: string | null,
): Promise<PerfResult> {
  if (!commandExists(cmd) && !path.isAbsolute(cmd)) {
    return { status: "skipped", note: `${cmd} not found on PATH` };
  }
  const start = performance.now();
  const build = await safeExecAsync(cmd, args, repo, 360000);
  if (build.code !== 0) {
    return {
      status: "skipped",
      note: `${cmd} ${args.join(" ")} failed (see stderr)`,
      stderr: build.stderr,
    };
  }
  const buildTimeMs = Math.round(performance.now() - start);

  let bundleSizeBytes: number | undefined;
  if (sizeDir) {
    const outAbs = path.resolve(repo, sizeDir);
    if (fs.existsSync(outAbs)) bundleSizeBytes = dirSize(outAbs);
  }

  return { status: "ok", buildTimeMs, bundleSizeBytes };
}

async function jsPerf(repo: string): Promise<PerfResult> {
  const pkgPath = path.join(repo, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { status: "skipped", note: "no package.json" };
  }
  let pkg: any = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return { status: "skipped", note: "unreadable package.json" };
  }
  const buildScript = pkg.scripts?.build;
  if (!buildScript) {
    return { status: "skipped", note: "no build script" };
  }

  const start = performance.now();
  const build = await safeExecAsync("npm", ["run", "build"], repo, 240000);
  if (build.code !== 0) {
    return {
      status: "skipped",
      note: "build script present but `npm run build` failed (see stderr)",
      stderr: build.stderr,
    };
  }
  const buildTimeMs = Math.round(performance.now() - start);

  let outDir = "dist";
  const tsconfigPath = path.join(repo, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    try {
      const tc = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
      if (typeof tc.compilerOptions?.outDir === "string") {
        outDir = tc.compilerOptions.outDir;
      }
    } catch {
      /* ignore */
    }
  }
  const outAbs = path.resolve(repo, outDir);
  let bundleSizeBytes: number | undefined;
  if (fs.existsSync(outAbs)) bundleSizeBytes = dirSize(outAbs);

  return { status: "ok", buildTimeMs, bundleSizeBytes };
}
