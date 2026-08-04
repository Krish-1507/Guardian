// Module-level mutable state near async code — a race-condition heuristic smell.
// `guardian scan` flags this; `guardian repro` then pounds the exports.
let counter = 0;

export async function increment() {
  counter = await Promise.resolve(counter + 1);
  return counter;
}

export function reset() {
  counter = 0;
}

export function current() {
  return counter;
}
