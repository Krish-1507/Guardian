import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { buildModel, renderTerminal, renderMarkdown, renderHtml } from "../report/format.js";
import { computeScore, renderBadgeSvg } from "../report/score.js";

export const report = new Command("report")
  .description("Generate a repository analysis report from scan/verify history")
  .argument("[repo]", "path to the repo to report on", ".")
  .option("--html", "also write a self-contained GUARDIAN_REPORT.html (zero external assets)")
  .action(async (repoArg: string, options: { html?: boolean }) => {
    const repo = path.resolve(repoArg);
    console.log(chalk.cyan(`\nGenerating report for ${repo} ...\n`));

    const model = buildModel(repo);
    console.log(renderTerminal(model));

    const md = renderMarkdown(model);
    const mdPath = path.join(repo, "GUARDIAN_REPORT.md");
    fs.writeFileSync(mdPath, md);

    if (model.latestScan) {
      const sc = computeScore(model.latestScan);
      const badgePath = path.join(repo, "GUARDIAN_BADGE.svg");
      fs.writeFileSync(badgePath, renderBadgeSvg(sc));
      console.log(
        chalk.dim(`\nBadge (README-ready) written to ${badgePath}\n`) +
          chalk.dim(`   embed with: ![Guardian score](GUARDIAN_BADGE.svg)\n`),
      );
    }

    console.log(chalk.dim(`\nReport written to ${mdPath}\n`));

    if (options.html) {
      const htmlPath = path.join(repo, "GUARDIAN_REPORT.html");
      fs.writeFileSync(htmlPath, renderHtml(model));
      console.log(chalk.dim(`HTML report written to ${htmlPath}\n`));
    }
  });
