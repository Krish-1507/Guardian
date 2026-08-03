import { Command } from "commander";
import chalk from "chalk";

export const install = new Command("install")
  .description("Install the guardian prompt into a target repo")
  .action(() => {
    console.log(chalk.yellow("install: not implemented yet"));
  });
