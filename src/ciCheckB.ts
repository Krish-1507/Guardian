import { tagA } from "./ciCheckA.js";

export const tagB = "audit-b";

export function describeB(): string {
  return `b(${tagA})`;
}