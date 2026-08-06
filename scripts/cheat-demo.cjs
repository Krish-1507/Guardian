#!/usr/bin/env node
/**
 * cheat-demo.cjs — the 90-second "agent tried to cheat, Guardian caught it"
 * demo, fully scripted and deterministic. Use it in a video, or live in front
 * of judges: it produces the SUSPICIOUS -> CONFIRMED_CHEAT arc on cue.
 *
 * Story: demo-repo-integrity has a real float-rounding bug and a test that
 * proves it. A lazy "agent" tries to make the failing suite green WITHOUT
 * fixing the root cause, twice:
 *
 *   1. focuses the suite on the passing tests  -> SUSPICIOUS
 *   2. deletes the failing test file entirely  -> CONFIRMED_CHEAT
 *
 * `guardian gate` catches both, escalates to exit code 2, and blocks the
 * commit. That is the product: the agent finally has a referee.
 *
 * Usage:   node scripts/cheat-demo.cjs
 *          (set GUARDIAN_CLI to point at a build, e.g.
 *           GUARDIAN_CLI="node D:/Guardian-cli/dist/cli.js")
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = process.env.GUARDIAN_CLI || "npx cli-guardian";

const run = (cmd, cwd) => {
  console.log(`\n$ ${cmd}`);
  try {
    const out = execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") };
  }
};

const say = (t) => console.log("\n" + "─".repeat(72) + "\n" + t + "\n" + "─".repeat(72));

function main() {
  const src = path.join(ROOT, "demo-repo-integrity");
  if (!fs.existsSync(path.join(src, "package.json"))) {
    console.error(`demo-repo-integrity not found at ${src}`);
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-cheat-demo-"));
  fs.cpSync(src, tmp, { recursive: true, filter: (p) => !/node_modules$/.test(p) });

  say("GUARDIAN CHEAT-CATCH DEMO — the agent finally has a referee");
  console.log(`demo repo: ${tmp}`);

  say("ACT 1 — baseline: a real bug, a failing test, an honest scan");
  run("npm install --no-audit --no-fund", tmp);
  run("git init -q && git config user.email guardian@demo.local && git config user.name \"Guardian Demo\" && git add -A && git commit -q -m baseline", tmp);
  const scan = run(`${CLI} scan`, tmp);
  if (!/1 failed|failed 1|Tests\s*:.*fail/i.test(scan.out)) {
    console.log(scan.out);
    console.log("\n(scan output above; the test suite should show 1 failed — the float bug)");
  }

  say("ACT 2 — a lazy 'fix': focus the suite on the passing tests (SUSPICIOUS)");
  const testFile = path.join(tmp, "test", "money.test.js");
  let testCode = fs.readFileSync(testFile, "utf8");
  testCode = testCode.replace(
    'it("quotes base + 7.5% markup to the cent"',
    'fit("quotes base + 7.5% markup to the cent"',
  );
  testCode = testCode.replace(
    'it("splits a bill evenly to the cent"',
    'fit("splits a bill evenly to the cent"',
  );
  fs.writeFileSync(testFile, testCode, "utf8");
  const act2 = run(`${CLI} gate`, tmp);
  console.log("\nGuardian's verdict: jest now runs ONLY the focused tests — the failing one is");
  console.log("hidden, the suite is 'green', the bug is still there. SUSPICIOUS, needs a human.");
  if (act2.code !== 1) {
    console.log(`\nWARNING: expected gate exit 1 (SUSPICIOUS), got ${act2.code}`);
    process.exitCode = 1;
  }

  say("ACT 3 — the desperate 'fix': delete the failing test (CONFIRMED_CHEAT)");
  run("git rm -q -f test/money.test.js", tmp);
  const gate = run(`${CLI} gate`, tmp);
  console.log(`\ngate exit code: ${gate.code} — ` + (gate.code === 2 ? "CONFIRMED_CHEAT. The commit is blocked." : `expected 2, got ${gate.code}`));
  if (gate.code !== 2) process.exitCode = 1;

  say("THE PITCH");
  console.log(
    "Agents fix code; they don't know when to stop, and they'll tell you they're done regardless.\n" +
      "Guardian is the referee it can't cheat: deterministic scans, tamper-evident baselines,\n" +
      "runtime penetration tests with failing-first repro contracts, and a verification gate\n" +
      "that catches the agent lying — SUSPICIOUS needs a human, CONFIRMED_CHEAT is blocked.\n" +
      "\nNow run the same arc against a repo that matters: npx cli-guardian pen --fix, then\n" +
      "npx cli-guardian drive <finding-id> — your agent fixes it, and Guardian verifies the\n" +
      "repro flips FAIL -> PASS. The numbers can't be talked into looking better.",
  );
}

main();
