import { Command } from "commander";
import chalk from "chalk";

export const verify = new Command("verify")
  .description("Verify the guardian setup")
  .action(() => {
    console.log(chalk.yellow("verify: not implemented yet"));
  });
