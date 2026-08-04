import { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { safeExec } from "../analyzers/util.js";

export const demo = new Command("demo")
  .description("Spin up Guardian's intentionally-broken demo repo in a fresh temp dir")
  .action(() => {
    const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const src = path.join(repoRoot, "demo-repo");
    if (!fs.existsSync(src)) {
      console.log(`demo-repo not found at ${src}`);
      return;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-demo-"));
    fs.cpSync(src, tmp, { recursive: true });

    // Best-effort: install deps so the loop can actually run tests/verify.
    // npm may exit non-zero on audit warnings; that's fine as long as the
    // packages landed.
    safeExec("npm", ["install"], tmp, 600000);
    const ready = fs.existsSync(path.join(tmp, "node_modules", "jest"));
    console.log(
      ready
        ? chalk.dim("npm install (demo repo) complete.")
        : chalk.yellow("npm install did not complete — the demo may be incomplete"),
    );

    // Install the /guardian slash command into the temp repo (and user home).
    const cli = path.join(repoRoot, "dist", "cli.js");
    execFileSync("node", [cli, "install", tmp], { stdio: "inherit" });

    console.log(
      `\ncd ${tmp}, open it in Claude Code/Cursor/OpenCode, type /guardian, hit enter.`,
    );
  });
