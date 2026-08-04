// Deliberate circular import for the Guardian CI test PR.
import { b } from "./cycleB.js";

export const a = "a";

export function useB(): string {
  return b;
}
