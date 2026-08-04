import type { FileChange, IntegrityFinding } from "./types.js";
import { detectTestTamper } from "./testTamper.js";
import { detectExceptionSwallow } from "./exceptionSwallow.js";
import { detectSuppressionCreep } from "./suppressionCreep.js";
import { detectHardcodedMatch } from "./hardcodedMatch.js";
import { detectMockOverreach } from "./mockOverreach.js";
import { detectExitCheat } from "./exitCheat.js";

export { detectTestTamper } from "./testTamper.js";
export { detectExceptionSwallow } from "./exceptionSwallow.js";
export { detectSuppressionCreep } from "./suppressionCreep.js";
export { detectHardcodedMatch } from "./hardcodedMatch.js";
export { detectMockOverreach } from "./mockOverreach.js";
export { detectExitCheat } from "./exitCheat.js";

/** Run every detector against the diff. Order is stable for reporting. */
export function runDetectors(changes: FileChange[]): IntegrityFinding[] {
  return [
    ...detectTestTamper(changes),
    ...detectExceptionSwallow(changes),
    ...detectSuppressionCreep(changes),
    ...detectHardcodedMatch(changes),
    ...detectMockOverreach(changes),
    ...detectExitCheat(changes),
  ];
}
