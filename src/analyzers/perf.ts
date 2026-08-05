import fs from "node:fs";
import path from "node:path";
import { dirSize, safeExec } from "./util.js";
import type { PerfResult } from "./types.js";

export function analyzePerf(repo: string): PerfResult {
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
  const build = safeExec("npm", ["run", "build"], repo, 240000);
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
