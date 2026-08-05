import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LedgerEvidence, ScanResult } from "../analyzers/types.js";
import { detectTestFramework, reproExtension, type TestFramework } from "./framework.js";
import { reproSlug, type ReproFinding } from "./ids.js";

export interface ReproOutcome {
  ok: boolean;
  /** Relative path of the written test file (from the repo root). */
  file?: string;
  /** Human reason when the generator refuses to fabricate a test. */
  reason?: string;
  framework?: TestFramework;
}

const preloadPath = (): string =>
  fileURLToPath(new URL("../../templates/ledger/preload.cjs", import.meta.url));

const isJestLike = (fw: TestFramework): boolean => fw === "jest" || fw === "vitest";

function writeTest(
  repo: string,
  framework: TestFramework,
  slug: string,
  content: string,
): string {
  const ext = reproExtension(framework);
  const fileName = `guardian-repro-${slug}${ext}`;
  const abs = path.join(repo, fileName);
  fs.writeFileSync(abs, content, "utf8");
  return path.relative(repo, abs);
}

/** Framework-aware preamble: node-test (ESM) vs jest/vitest (CJS). */
function assemble(
  framework: TestFramework,
  header: string,
  body: string,
): string {
  const border = "=".repeat(78);
  const head = `// ${border}\n${header}\n// ${border}\n\n`;
  if (isJestLike(framework)) {
    return `${head}const assert = require("assert/strict");\n\n${body}\n`;
  }
  return (
    `${head}import { test } from "node:test";\n` +
    `import assert from "node:assert/strict";\n\n${body}\n`
  );
}

/**
 * One-time boilerplate that defines `requireFromRepo` for node-test ESM runs.
 * Emit this exactly once even when multiple `requireLine`s follow.
 */
function requireBoilerplate(framework: TestFramework): string {
  if (isJestLike(framework)) return "";
  return (
    `const { createRequire } = await import("node:module");\n` +
    `const requireFromRepo = createRequire(import.meta.url);`
  );
}

/** Require a module from the repo (works for both jest CJS and node-test ESM). */
function requireLine(framework: TestFramework, target: string, varName: string): string {
  if (isJestLike(framework)) {
    return `const ${varName} = require(${JSON.stringify(target)});`;
  }
  return `const ${varName} = requireFromRepo(${JSON.stringify(target)});`;
}

/* ------------------------------------------------------------------ */
/* 1. LEDGER — replay the exact attack, assert exactly one charge       */
/* ------------------------------------------------------------------ */

function ledgerRepro(
  repo: string,
  framework: TestFramework,
  finding: ReproFinding,
): ReproOutcome {
  if (isJestLike(framework)) {
    // The ledger repro boots the app under the sandbox preload and uses node's
    // own child/fetch APIs; it must be ESM (`node --test`), regardless of what
    // the repo's test framework is, so it always runs via `node --test`.
    return ledgerRepro(repo, "node-test", finding);
  }
  const ev = finding.data as LedgerEvidence;
  if (!ev || ev.chargeCalls.length === 0) {
    return {
      ok: false,
      reason: "ledger evidence record has no recorded gateway calls to replay",
    };
  }
  const first = ev.chargeCalls[0];
  const gatewayHost = first.host;
  const expectedKey = first.key ?? ev.orderId;
  const amount =
    typeof (first.requestBody as any)?.amount === "number"
      ? (first.requestBody as any).amount
      : 1000;
  const currency = String((first.requestBody as any)?.currency ?? "INR");
  const J = (s: unknown) => JSON.stringify(s);
  const slug = reproSlug(finding);

  const header = [
    `// Guardian permanent repro test — finding ${finding.id}`,
    `// Linked from .guardian/scan-latest.json (issue / cluster finding id ${finding.id}).`,
    `//`,
    `// Scenario: ${ev.scenario} on ${ev.endpoint}`,
    `//   order ${ev.orderId} · idempotency key ${ev.idempotencyKey}`,
    `//   Gateway contract: exactly ONE charge for key "${expectedKey}"`,
    `//   (observed now: ${ev.chargeCalls.length} charges — the bug this test exists to guard).`,
    `//`,
    `// Run via: npx cli-guardian repro ${finding.id}`,
    `// The app is booted under Guardian's nock sandbox, so no request can ever reach`,
    `// a real payment gateway; the "gateway" is a local mock that records every call.`,
    `// This test MUST FAIL on the buggy code and MUST PASS only after the fix.`,
  ].join("\n");

  const body = [
    `const REPO = process.cwd();`,
    `const PRELOAD = process.env.GUARDIAN_LEDGER_PRELOAD;`,
    `const GATEWAY_HOST = ${J(gatewayHost)};`,
    `const ENDPOINT = ${J(ev.endpoint)};`,
    `const SCENARIO = ${J(ev.scenario)};`,
    `const ORDER_ID = ${J(ev.orderId)};`,
    `const IDEM_KEY = ${J(ev.idempotencyKey)};`,
    `const EXPECTED_KEY = ${J(expectedKey)};`,
    `const AMOUNT = ${Number(amount)};`,
    `const CURRENCY = ${J(currency)};`,
    `const NODE_BASED = new Set(["node","node.exe","nodejs","npm","npm.cmd","npx","npx.cmd","yarn","yarn.cmd","pnpm","pnpm.cmd","tsx","ts-node","babel-node","ojs","vitest","jest"]);`,
    ``,
    `import { spawn } from "node:child_process";`,
    `import { readFileSync, mkdirSync, existsSync } from "node:fs";`,
    `import net from "node:net";`,
    `import path from "node:path";`,
    ``,
    `function freePort() {`,
    `  return new Promise((resolve, reject) => {`,
    `    const s = net.createServer();`,
    `    s.unref();`,
    `    s.on("error", reject);`,
    `    s.listen(0, () => {`,
    `      const p = s.address().port;`,
    `      s.close(() => resolve(p));`,
    `    });`,
    `  });`,
    `}`,
    `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));`,
    ``,
    `function resolveStart() {`,
    `  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));`,
    `  const start = (pkg.scripts && pkg.scripts.start) || "";`,
    `  if (!start) throw new Error("no start script in package.json");`,
    `  const tokens = start.trim().split(/\\s+/);`,
    `  if (!NODE_BASED.has(tokens[0])) {`,
    `    throw new Error("start script runs " + tokens[0] + ", which is not Node-based — refusing");`,
    `  }`,
    `  return { cmd: tokens[0], args: tokens.slice(1) };`,
    `}`,
    ``,
    `function resolvePath(route, orderId) {`,
    `  return route`,
    `    .replace(/:([A-Za-z_][\\w-]*)/g, (_, name) => (/id|order/i.test(name) ? orderId : name))`,
    `    .replace(/\\{([A-Za-z_][\\w-]*)\\}/g, (_, name) => (/id|order/i.test(name) ? orderId : name));`,
    `}`,
    ``,
    `async function post(baseUrl, p, body, headers) {`,
    `  try {`,
    `    const res = await fetch(baseUrl + p, { method: "POST", headers, body: JSON.stringify(body) });`,
    `    await res.text().catch(() => "");`,
    `    return res.status;`,
    `  } catch {`,
    `    return 0;`,
    `  }`,
    `}`,
    ``,
    `function controlHas(controlPath, needle) {`,
    `  if (!existsSync(controlPath)) return false;`,
    `  try {`,
    `    return readFileSync(controlPath, "utf8").split(/\\r?\\n/).some((l) => l.includes(needle));`,
    `  } catch {`,
    `    return false;`,
    `  }`,
    `}`,
    ``,
    `function countCharges(gatewayLogPath) {`,
    `  if (!existsSync(gatewayLogPath)) return [];`,
    `  const out = [];`,
    `  for (const line of readFileSync(gatewayLogPath, "utf8").split(/\\r?\\n/)) {`,
    `    const t = line.trim();`,
    `    if (!t) continue;`,
    `    try {`,
    `      const e = JSON.parse(t);`,
    `      if (e.charge && e.key === EXPECTED_KEY) out.push(e);`,
    `    } catch {}`,
    `  }`,
    `  return out;`,
    `}`,
    ``,
    `test("guardian repro ${finding.id}: exactly one gateway charge for key '" + EXPECTED_KEY + "'", async () => {`,
    `  assert.ok(PRELOAD, "GUARDIAN_LEDGER_PRELOAD not set — run this via \`npx cli-guardian repro ${finding.id}\`");`,
    ``,
    `  const start = resolveStart();`,
    `  const runDir = path.join(REPO, ".guardian", "repro", new Date().toISOString().replace(/[:.]/g, "-"));`,
    `  mkdirSync(runDir, { recursive: true });`,
    `  const controlPath = path.join(runDir, "control.jsonl");`,
    `  const gatewayLogPath = path.join(runDir, "gateway.log.jsonl");`,
    `  const port = await freePort();`,
    `  const baseUrl = "http://127.0.0.1:" + port;`,
    ``,
    `  const env = {`,
    `    ...process.env,`,
    `    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--require=" + PRELOAD].filter(Boolean).join(" "),`,
    `    PORT: String(port),`,
    `    GUARDIAN_LEDGER_CONTROL: controlPath,`,
    `    GUARDIAN_LEDGER_GATEWAY_LOG: gatewayLogPath,`,
    `    GUARDIAN_LEDGER_GATEWAY_HOSTS: GATEWAY_HOST,`,
    `    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "rzp_test_guardian000000",`,
    `    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "guardian_fake_secret",`,
    `    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_guardian_fake",`,
    `    NODE_ENV: process.env.NODE_ENV || "test",`,
    `  };`,
    `  const child = spawn(start.cmd, start.args, { cwd: REPO, env, stdio: ["ignore", "ignore", "inherit"] });`,
    `  try {`,
    `    const deadline = Date.now() + 25000;`,
    `    let up = false;`,
    `    while (Date.now() < deadline) {`,
    `      if (child.exitCode !== null) break;`,
    `      if (controlHas(controlPath, '"event":"armed"')) {`,
    `        try {`,
    `          await fetch(baseUrl + "/__guardian_ledger_probe__");`,
    `          up = true;`,
    `          break;`,
    `        } catch {}`,
    `      }`,
    `      await sleep(150);`,
    `    }`,
    `    assert.ok(up, "app did not come up under the sandbox within 25s (" + start.cmd + " " + start.args.join(" ") + ")");`,
    `    assert.ok(!controlHas(controlPath, '"event":"abort"'), "sandbox aborted during startup");`,
    ``,
    `    if (SCENARIO === "concurrent-double-submit" || SCENARIO === "delayed-retry") {`,
    `      const reqBody = { amount: AMOUNT, currency: CURRENCY };`,
    `      const headers = { "Content-Type": "application/json", ...(IDEM_KEY ? { "Idempotency-Key": IDEM_KEY } : {}) };`,
    `      const p = resolvePath(ENDPOINT, ORDER_ID);`,
    `      if (SCENARIO === "concurrent-double-submit") {`,
    `        await Promise.all([post(baseUrl, p, reqBody, headers), post(baseUrl, p, reqBody, headers)]);`,
    `      } else {`,
    `        await post(baseUrl, p, reqBody, headers);`,
    `        await sleep(2000);`,
    `        await post(baseUrl, p, reqBody, headers);`,
    `      }`,
    `    } else {`,
    `      const payload = {`,
    `        event: "payment.captured",`,
    `        id: ORDER_ID + "_evt",`,
    `        payload: { payment: { entity: { id: EXPECTED_KEY, amount: AMOUNT, currency: CURRENCY, order_id: ORDER_ID } } },`,
    `      };`,
    `      const headers = { "Content-Type": "application/json" };`,
    `      await post(baseUrl, ENDPOINT, payload, headers);`,
    `      await sleep(300);`,
    `      await post(baseUrl, ENDPOINT, payload, headers);`,
    `    }`,
    ``,
    `    await sleep(400);`,
    `    assert.ok(!controlHas(controlPath, '"event":"abort"'), "sandbox aborted during the attack");`,
    `    const charges = countCharges(gatewayLogPath);`,
    `    assert.equal(`,
    `      charges.length,`,
    `      1,`,
    `      "expected exactly 1 gateway charge for key '" + EXPECTED_KEY + "', saw " + charges.length +`,
    `      ". This repro proves the idempotency bug: it FAILS on the buggy code and must PASS only after the fix.",`,
    `    );`,
    `  } finally {`,
    `    try { child.kill(); } catch {}`,
    `  }`,
    `});`,
  ].join("\n");

  const file = writeTest(repo, "node-test", slug, assemble("node-test", header, body));
  return { ok: true, file, framework: "node-test" };
}

/* ------------------------------------------------------------------ */
/* 2. SECURITY — attempt the real exploit, assert it is rejected        */
/* ------------------------------------------------------------------ */

/**
 * Verified exploit recipes, keyed by the npm package name parsed from the
 * audit finding. A recipe is only added once its PoC has been confirmed to
 * (a) actually execute on the vulnerable version and (b) be blocked on the
 * patched version. No recipe means `guardian repro` refuses rather than emit
 * a test that cannot genuinely fail.
 */
const SECURITY_RECIPES: Record<
  string,
  { name: string; titleKeywords: string[]; check: (fw: TestFramework) => string }
> = {
  lodash: {
    name: "lodash",
    titleKeywords: ["command injection", "code injection"],
    check: (fw) => {
      const req = requireLine(fw, "lodash", "_");
      return [
        req,
        ``,
        `test("guardian repro: lodash must reject the command-injection payload (CVE-2021-23337)", () => {`,
        `  const MARKER = "GUARDIAN-PWN-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);`,
        `  let markerHit = false;`,
        `  let threw = false;`,
        `  const origLog = console.log;`,
        `  console.log = (...a) => { if (String(a[0] || "").includes(MARKER)) markerHit = true; origLog.apply(console, a); };`,
        `  try {`,
        `    _.template("", { variable: "){console.log('" + MARKER + "')}; with(obj" })();`,
        `  } catch (e) {`,
        `    threw = true;`,
        `  } finally {`,
        `    console.log = origLog;`,
        `  }`,
        `  assert.ok(threw, "fixed lodash must reject the malicious variable option (CVE-2021-23337)");`,
        `  assert.ok(!markerHit, "attacker-controlled code EXECUTED via _.template — command injection is live");`,
        `});`,
      ].join("\n");
    },
  },
};

function securityPackageName(description: string): string {
  return description.split(/[:(]/)[0].trim();
}

function securityRepro(
  repo: string,
  framework: TestFramework,
  finding: ReproFinding,
): ReproOutcome {
  if (framework === "pytest") {
    return {
      ok: false,
      reason:
        "no verified exploit recipe for Python packages yet; add one in src/repro/generate.ts " +
        "(recipes are only shipped once the PoC is proven to execute + be blocked)",
    };
  }
  const name = securityPackageName(finding.description);
  const recipe = SECURITY_RECIPES[name];
  if (!recipe) {
    return {
      ok: false,
      reason:
        `no verified exploit recipe for package "${name || finding.description}" — Guardian refuses to ` +
        "emit a repro test that cannot genuinely fail. Add a confirmed PoC to src/repro/generate.ts " +
        "(it must actually execute on the vulnerable version and be blocked on the patched one) or " +
        "write the exploit test by hand and commit it as guardian-repro-*.test.*.",
    };
  }
  const slug = reproSlug(finding);
  const header = [
    `// Guardian permanent repro test — finding ${finding.id}`,
    `// Linked from .guardian/scan-latest.json (issue / cluster finding id ${finding.id}).`,
    `//`,
    `// Attempts the real ${recipe.name} exploit (${recipe.titleKeywords.join(", ")}) and asserts it`,
    `// is rejected. This test MUST FAIL while the vulnerable version is installed and MUST PASS`,
    `// after the dependency is upgraded.`,
  ].join("\n");

  const file = writeTest(
    repo,
    framework,
    slug,
    assemble(framework, header, requireBoilerplate(framework) + "\n\n" + recipe.check(framework)),
  );
  return { ok: true, file, framework };
}

/* ------------------------------------------------------------------ */
/* 3. RACE — parallel stress probe (inherently a probe, not a proof)    */
/* ------------------------------------------------------------------ */

function raceRepro(
  repo: string,
  framework: TestFramework,
  finding: ReproFinding,
): ReproOutcome {
  if (!finding.file) {
    return { ok: false, reason: "race finding has no source file to stress" };
  }
  const rel = path.relative(repo, finding.file);
  if (rel.startsWith("..")) {
    return { ok: false, reason: `race finding file is outside the repo: ${finding.file}` };
  }
  // Keep the extension: ESM `import()` resolves relative specifiers strictly
  // ("./src/counter.js"), whereas CJS `require()` tolerates extensionless paths.
  const moduleTarget = rel;
  const slug = reproSlug(finding);
  const header = [
    `// Guardian repro test — finding ${finding.id}`,
    `// Linked from .guardian/scan-latest.json.`,
    `//`,
    `// PARALLEL STRESS PROBE (heuristic): the scan flagged module-level mutable`,
    `// state in ${rel} near async code. This test pounds the module's exports with`,
    `// concurrent invocations to try to surface a race.`,
    `// ${finding.description}`,
    `// A probe: a race may not manifest deterministically. If it PASSES, the race`,
    `// hypothesis is UNPROVEN — the fix loop must re-diagnose rather than fix blind.`,
  ].join("\n");

  const body = [
    `test("guardian repro ${finding.id}: ${moduleTarget} stays consistent under concurrent load", async () => {`,
    `  const mod = await import(${JSON.stringify("./" + moduleTarget)});`,
    `  const fns = Object.values(mod).filter((v) => typeof v === "function");`,
    `  assert.ok(fns.length > 0, "no exported functions to stress");`,
    `  const N = 30;`,
    `  const results = await Promise.all(`,
    `    Array.from({ length: N }, () =>`,
    `      Promise.resolve()`,
    `        .then(() => Promise.all(fns.map((fn) => Promise.resolve().then(() => fn()))).then(() => "ok"))`,
    `        .catch((e) => "err: " + e.message),`,
    `    ),`,
    `  );`,
    `  const bad = results.filter((r) => r !== "ok");`,
    `  assert.deepEqual(bad, [], "concurrent invocations of ${moduleTarget} threw: " + JSON.stringify(bad.slice(0, 5)));`,
    `});`,
  ].join("\n");

  const file = writeTest(repo, framework, slug, assemble(framework, header, body));
  return { ok: true, file, framework };
}

/* ------------------------------------------------------------------ */
/* 4. PERF — re-run the build, assert under the Phase-1 baseline        */
/* ------------------------------------------------------------------ */

function perfRepro(
  repo: string,
  framework: TestFramework,
  finding: ReproFinding,
  scan: ScanResult,
): ReproOutcome {
  if (framework === "pytest") {
    return { ok: false, reason: "perf repro currently supports Node build scripts only" };
  }
  const perf = scan.perf;
  if (perf.buildTimeMs == null) {
    return {
      ok: false,
      reason: "Phase-1 scan had no build baseline (no build script / perf skipped) — nothing to guard",
    };
  }
  const limitMs = Math.max(1, Math.ceil(perf.buildTimeMs * 1.5));
  const bundleLimit =
    perf.bundleSizeBytes != null ? Math.max(1, Math.ceil(perf.bundleSizeBytes * 1.1)) : null;
  const slug = reproSlug(finding);
  const header = [
    `// Guardian perf repro test — finding ${finding.id}`,
    `// Linked from .guardian/scan-latest.json (perf baseline: build ${perf.buildTimeMs}ms` +
      (bundleLimit != null ? `, bundle ${perf.bundleSizeBytes}B` : "") + `).`,
    `//`,
    `// Regression guard: the build must stay under the Phase-1 baseline threshold.`,
  ].join("\n");

  const body: string[] = [];
  if (isJestLike(framework)) {
    body.push(
      `const { execSync } = require("child_process");`,
      `const { statSync, existsSync, readdirSync } = require("fs");`,
      `const path = require("path");`,
    );
  } else {
    body.push(
      `import { execSync } from "node:child_process";`,
      `import { statSync, existsSync, readdirSync } from "node:fs";`,
      `import path from "node:path";`,
    );
  }
  body.push(
    ``,
    `test("guardian repro ${finding.id}: build stays under ${limitMs}ms", () => {`,
    `  const t0 = Date.now();`,
    `  execSync("npm run build", { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });`,
    `  const took = Date.now() - t0;`,
    `  assert.ok(took <= ${limitMs}, "build took " + took + "ms, over the Phase-1 baseline threshold of ${limitMs}ms");`,
  );
  if (bundleLimit != null) {
    body.push(
      `  const dist = path.join(process.cwd(), "dist");`,
      `  if (existsSync(dist)) {`,
      `    let total = 0;`,
      `    const walk = (d) => {`,
      `      for (const e of readdirSync(d, { withFileTypes: true })) {`,
      `        const p = path.join(d, e.name);`,
      `        if (e.isDirectory()) walk(p);`,
      `        else total += statSync(p).size;`,
      `      }`,
      `    };`,
      `    walk(dist);`,
      `    assert.ok(total <= ${bundleLimit}, "dist size " + total + "B over baseline limit ${bundleLimit}B");`,
      `  }`,
    );
  }
  body.push(`});`);

  const file = writeTest(repo, framework, slug, assemble(framework, header, body.join("\n")));
  return { ok: true, file, framework };
}

/* ------------------------------------------------------------------ */
/* 5. ACCESSIBILITY — axe-core assertion against the flagged file       */
/* ------------------------------------------------------------------ */

function a11yRepro(
  repo: string,
  framework: TestFramework,
  finding: ReproFinding,
): ReproOutcome {
  if (!finding.file || !/\.html?$/i.test(finding.file)) {
    return {
      ok: false,
      reason:
        "this accessibility finding is not backed by a runnable HTML file (static JSX lint findings " +
        "cannot be replayed as an axe assertion). Point the scanner at an HTML page to get a runnable repro.",
    };
  }
  if (
    !fs.existsSync(path.join(repo, "node_modules", "axe-core")) ||
    !fs.existsSync(path.join(repo, "node_modules", "jsdom"))
  ) {
    return {
      ok: false,
      reason:
        `an axe-core assertion needs the "axe-core" and "jsdom" dependencies in the repo; ` +
        "add them and re-run, or run the page through axe manually",
    };
  }
  const rel = path.relative(repo, finding.file);
  const slug = reproSlug(finding);
  const header = [
    `// Guardian a11y repro test — finding ${finding.id}`,
    `// Linked from .guardian/scan-latest.json.`,
    `// Axe-core assertion against ${rel}.`,
  ].join("\n");
  const axeReq = requireLine(framework, "axe-core", "axeCore");
  const jsdomReq = requireLine(framework, "jsdom", "jsdom");
  const fsReq = requireLine(framework, "node:fs", "nodefs");
  const body = [
    requireBoilerplate(framework),
    axeReq,
    jsdomReq,
    fsReq,
    ``,
    `test("guardian repro ${finding.id}: axe reports no violations for ${rel}", async () => {`,
    `  const html = nodefs.readFileSync(${JSON.stringify(rel)}, "utf8");`,
    `  const dom = new jsdom.JSDOM(html, { runScripts: "outside-only" });`,
    `  const { window } = dom;`,
    `  // axe-core runs inside the jsdom window, so inject its source there first.`,
    `  window.eval(axeCore.source);`,
    `  const results = await window.axe.run(window.document, {`,
    `    // color-contrast is excluded: it needs real layout/rendering that jsdom`,
    `    // does not provide, so it throws rather than returns a violation.`,
    `    runOnly: { type: "rule", values: ["image-alt", "document-title", "html-has-lang", "link-name", "list"] },`,
    `  });`,
    `  assert.ok(results.violations.length === 0, JSON.stringify(results.violations, null, 2));`,
    `});`,
  ].join("\n");

  const file = writeTest(repo, framework, slug, assemble(framework, header, body));
  return { ok: true, file, framework };
}

/* ------------------------------------------------------------------ */

export function generateRepro(
  repo: string,
  scan: ScanResult,
  finding: ReproFinding,
): ReproOutcome {
  const framework = detectTestFramework(repo) ?? "node-test";
  switch (finding.source) {
    case "ledger":
      return ledgerRepro(repo, framework, finding);
    case "security":
      return securityRepro(repo, framework, finding);
    case "reliability":
      if (finding.type === "race-condition") return raceRepro(repo, framework, finding);
      return {
        ok: false,
        reason:
          "flaky-test findings are observations of the suite, not a bug to replay — " +
          "no genuine repro generator exists for them",
      };
    case "perf":
      return perfRepro(repo, framework, finding, scan);
    case "a11y":
      return a11yRepro(repo, framework, finding);
    default:
      return {
        ok: false,
        reason:
          `findings of source "${finding.source}" (${finding.type}) cannot be replayed as a failing ` +
          "test — they have no genuine repro generator. Fix them and confirm with a fresh scan.",
      };
  }
}

export { preloadPath };
