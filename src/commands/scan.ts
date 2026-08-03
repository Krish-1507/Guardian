import { Command } from "commander";
import chalk from "chalk";

export const scan = new Command("scan")
  .description("Scan a repo for security issues")
  .action(() => {
    console.log(chalk.yellow("scan: not implemented yet"));
  });
