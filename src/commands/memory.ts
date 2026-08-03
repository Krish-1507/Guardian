import { Command } from "commander";
import chalk from "chalk";

export const memory = new Command("memory")
  .description("Manage guardian memory")
  .action(() => {
    console.log(chalk.yellow("memory: not implemented yet"));
  });
