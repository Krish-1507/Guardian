#!/usr/bin/env node
import { Command } from "commander";
import { install } from "./commands/install.js";
import { scan } from "./commands/scan.js";
import { verify } from "./commands/verify.js";
import { memory } from "./commands/memory.js";
import { report } from "./commands/report.js";
import { demo } from "./commands/demo.js";
import { ci } from "./commands/ci.js";
import { reproCmd } from "./commands/repro.js";
import { integrity } from "./commands/integrity.js";

const program = new Command();

program
  .name("guardian")
  .description("Guardian CLI")
  .version("0.1.0");

program.addCommand(install);
program.addCommand(scan);
program.addCommand(verify);
program.addCommand(memory);
program.addCommand(report);
program.addCommand(demo);
program.addCommand(ci);
program.addCommand(reproCmd);
program.addCommand(integrity);

program.parseAsync(process.argv);
