import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import Table from "cli-table3";
import fs from "node:fs";
import path from "node:path";
import {
  getTargets,
  resolveTemplatePath,
  renderContent,
} from "../installer/targets.js";

const READY_MESSAGE =
  "Guardian is ready. Type /guardian in Claude Code, Cursor, OpenCode, Kilo Code, Codex CLI or App or any AI coding tool installed, hit enter, and watch it work.";

export const install = new Command("install")
  .description("Install the guardian slash-command into Claude Code, Cursor, OpenCode, Kilo Code, Codex")
  .argument("[repo]", "target repo (defaults to cwd)", ".")
  .option("--force", "overwrite existing guardian files", false)
  .option("--uninstall", "remove guardian files only", false)
  .action(async (repoArg: string, opts: any) => {
    const cwd = path.resolve(repoArg);
    const targets = getTargets(cwd);
    const codexNote = targets.find((t) => t.note)?.note;

    if (opts.uninstall) {
      const table = new Table({
        head: ["Tool", "Path", "Status"],
        style: { head: ["cyan"], border: [] },
      });
      let removed = 0;
      for (const t of targets) {
        if (fs.existsSync(t.path)) {
          fs.rmSync(t.path);
          table.push([t.tool, t.path, chalk.red("🗑️  removed")]);
          removed++;
        } else {
          table.push([t.tool, t.path, chalk.dim("— absent")]);
        }
      }
      console.log(table.toString());
      console.log(
        chalk.bold(
          `\nGuardian uninstalled (${removed} file(s) removed). Nothing else was touched.`,
        ),
      );
      return;
    }

    const templateText = fs.readFileSync(resolveTemplatePath(), "utf8");

    const table = new Table({
      head: ["Tool", "Path", "Status"],
      style: { head: ["cyan"], border: [] },
    });
    let installed = 0;
    let skipped = 0;
    for (const t of targets) {
      fs.mkdirSync(path.dirname(t.path), { recursive: true });
      const exists = fs.existsSync(t.path);
      if (exists && !opts.force) {
        table.push([t.tool, t.path, chalk.yellow("⚠️  skipped — use --force")]);
        skipped++;
        continue;
      }
      fs.writeFileSync(t.path, renderContent(t, templateText));
      table.push([t.tool, t.path, chalk.green("✅ installed")]);
      installed++;
    }

    console.log(table.toString());
    if (codexNote) {
      console.log(chalk.dim(`Note: ${codexNote}.`));
    }
    console.log(
      boxen(chalk.bold(READY_MESSAGE), {
        padding: 1,
        borderStyle: "double",
        borderColor: "cyan",
      }),
    );
    if (skipped > 0) {
      console.log(
        chalk.dim(
          `\n(${skipped} existing file(s) kept — run with --force to overwrite them.)`,
        ),
      );
    }
  });
