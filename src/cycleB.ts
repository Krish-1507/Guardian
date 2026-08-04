// Deliberate circular import for the Guardian CI test PR.
import { a } from "./cycleA.js";

export const b = "b";

export function useA(): string {
  return a;
}
