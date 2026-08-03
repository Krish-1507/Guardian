import { Command } from "commander";
import chalk from "chalk";

export const report = new Command("report")
  .description("Generate a security report")
  .action(() => {
    console.log(chalk.yellow("report: not implemented yet"));
  });
