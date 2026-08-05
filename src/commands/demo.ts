import { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execaSync } from "execa";
import { fileURLToPath } from "node:url";
import { safeExec } from "../analyzers/util.js";

export const demo = new Command("demo")
  .description(
    "Spin up an intentionally-broken Guardian demo repo in a fresh temp dir (default: demo-repo, " +
      "or pass demo-repo-integrity / demo-repo-fintech / demo-repo-generators). Initializes git and " +
      "commits a baseline so the integrity gate can diff fixes.",
  )
  .argument("[demo]", "demo fixture directory name (default: demo-repo)", "demo-repo")
  .action((demoArg: string) => {
    const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const demoName = path.basename(demoArg);
    const src = path.join(repoRoot, demoName);
    if (!fs.existsSync(src)) {
      console.log(`demo repo ${demoName} not found at ${src}`);
      return;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-demo-"));
    fs.cpSync(src, tmp, { recursive: true });

    // Best-effort: install deps so the loop can actually run tests/verify.
    // npm may exit non-zero on audit warnings; that's fine as long as the
    // packages landed. execa resolves the npm.cmd shim on Windows.
    safeExec("npm", ["install"], tmp, 600000);
    const ready = fs.existsSync(path.join(tmp, "node_modules", "jest"));
    console.log(
      ready
        ? chalk.dim("npm install (demo repo) complete.")
        : chalk.yellow("npm install did not complete — the demo may be incomplete"),
    );

    // The autonomous loop (branch, revert, commit) and the verify integrity gate
    // both need a git repo. Initialize one and commit a clean baseline so the
    // fix loop diffs against it.
    const init = safeExec("git", ["init"], tmp);
    if (init.code !== 0) {
      console.log(chalk.yellow("git init failed — the integrity gate will not be able to diff fixes."));
    } else {
      safeExec("git", ["config", "user.email", "guardian@demo.local"], tmp);
      safeExec("git", ["config", "user.name", "Guardian Demo"], tmp);
      const add = safeExec("git", ["add", "-A"], tmp);
      if (add.code !== 0) {
        console.log(chalk.yellow("git add failed — baseline commit skipped."));
      } else {
        const commit = safeExec("git", ["commit", "-m", "demo baseline"], tmp);
        console.log(
          commit.code === 0
            ? chalk.dim("git baseline committed (integrity gate will diff fixes against it).")
            : chalk.yellow("git commit failed — verify's integrity gate will not see a baseline."),
        );
      }
    }

    // Install the /guardian slash command into the temp repo (and user home).
    const cli = path.join(repoRoot, "dist", "cli.js");
    execaSync("node", [cli, "install", tmp], { stdio: "inherit" });

    console.log(
      `\ncd ${tmp}, open it in Claude Code/Cursor/OpenCode, type /guardian, hit enter.`,
    );
  });
