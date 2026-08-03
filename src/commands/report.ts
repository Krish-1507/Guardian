import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { buildModel, renderTerminal, renderMarkdown } from "../report/format.js";

export const report = new Command("report")
  .description("Generate a repository analysis report from scan/verify history")
  .argument("[repo]", "path to the repo to report on", ".")
  .action(async (repoArg: string) => {
    const repo = path.resolve(repoArg);
    console.log(chalk.cyan(`\nGenerating report for ${repo} ...\n`));

    const model = buildModel(repo);
    console.log(renderTerminal(model));

    const md = renderMarkdown(model);
    const outPath = path.join(repo, "GUARDIAN_REPORT.md");
    fs.writeFileSync(outPath, md);

    console.log(chalk.dim(`\nReport written to ${outPath}\n`));
  });
