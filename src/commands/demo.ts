import { Command } from "commander";
import chalk from "chalk";

export const demo = new Command("demo")
  .description("Run a demo against the seeded sample repo")
  .action(() => {
    console.log(chalk.yellow("demo: not implemented yet"));
  });
