import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

// Produce a small but real bundle so the perf analyzer records a baseline.
const entries = [join(root, "src", "counter.js")];
for (const e of entries) {
  if (existsSync(e)) {
    copyFileSync(e, join(dist, "counter.js"));
  }
}
writeFileSync(join(dist, "manifest.json"), JSON.stringify({ builtAt: Date.now() }));
console.log("built demo-repo-generators -> dist/");
