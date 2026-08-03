import { a } from "./a.js";
import { b } from "./b.js";
import { c } from "./c.js";

// Hub module: imported by a.ts, b.ts and c.ts, each of which imports core.ts
// back -> three circular dependencies that share this file. The correlator
// should group all three cycles into one cluster and pick core.ts (highest
// centrality) as the root cause.
export const core = a + b + c;
