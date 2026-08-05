import { execa, type Subprocess } from "execa";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import net from "node:net";
import { detectLanguage } from "../util.js";
import type { Harness, HarnessResult, StartCommand } from "./types.js";

const STARTUP_TIMEOUT_MS = 25_000;

const NODE_BASED = new Set([
  "node",
  "node.exe",
  "nodejs",
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
  "yarn",
  "yarn.cmd",
  "pnpm",
  "pnpm.cmd",
  "tsx",
  "ts-node",
  "babel-node",
  "ojs",
  "vitest",
  "jest",
]);

/** Absolute path of the nock sandbox preload that ships with the package. */
function preloadPath(): string {
  return fileURLToPath(
    new URL("../../../templates/ledger/preload.cjs", import.meta.url),
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

function resolveStart(repo: string): StartCommand {
  const pkgPath = path.join(repo, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error("no package.json — a start script is required for --ledger");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const start = (pkg.scripts && pkg.scripts.start) || "";
  if (!start) {
    throw new Error("no `start` script in package.json — --ledger needs one");
  }
  const tokens = start.trim().split(/\s+/);
  const cmd = tokens[0] || "";
  if (!NODE_BASED.has(cmd)) {
    throw new Error(
      `start script runs "${cmd}", which is not a Node-based runtime — ` +
        "outbound HTTP from it cannot be guaranteed to be intercepted; refusing to run ledger mode",
    );
  }
  return { cmd, args: tokens.slice(1) };
}

async function waitForServer(
  baseUrl: string,
  exited: () => boolean,
  controlPath: string,
  timeoutMs: number,
): Promise<{ up: boolean; aborted: boolean }> {
  const deadline = Date.now() + timeoutMs;
  const armed = async () => {
    if (!fs.existsSync(controlPath)) return false;
    try {
      return fs
        .readFileSync(controlPath, "utf8")
        .split(/\r?\n/)
        .some((l) => l.includes('"event":"armed"'));
    } catch {
      return false;
    }
  };
  while (Date.now() < deadline) {
    const aborted = controlAborted(controlPath);
    if (aborted) return { up: false, aborted: true };
    if (exited()) {
      return { up: false, aborted: controlAborted(controlPath) };
    }
    if ((await armed()) && baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/__guardian_ledger_probe__`);
        if (res) return { up: true, aborted: false };
      } catch {
        /* not up yet */
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { up: false, aborted: controlAborted(controlPath) };
}

function controlAborted(controlPath: string): boolean {
  if (!fs.existsSync(controlPath)) return false;
  try {
    return fs
      .readFileSync(controlPath, "utf8")
      .split(/\r?\n/)
      .some((l) => l.includes('"event":"abort"'));
  } catch {
    return false;
  }
}

export async function startHarness(
  repo: string,
  gatewayHosts: string[],
): Promise<HarnessResult> {
  if (detectLanguage(repo) !== "js") {
    return {
      harness: null,
      aborted: true,
      abortReason:
        "--ledger currently supports Node/JS apps only. For another language, " +
        "outbound HTTP cannot be guaranteed to be intercepted; refusing to run.",
    };
  }

  let start: StartCommand;
  try {
    start = resolveStart(repo);
  } catch (e) {
    return {
      harness: null,
      aborted: false,
      abortReason: (e as Error).message,
    };
  }

  const workDir = path.join(repo, ".guardian", "ledger");
  fs.mkdirSync(workDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(workDir, `run-${ts}`);
  fs.mkdirSync(runDir, { recursive: true });

  const gatewayLogPath = path.join(runDir, "gateway.log.jsonl");
  const controlPath = path.join(runDir, "control.jsonl");
  const appOut = path.join(runDir, "app.out.log");

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const preload = preloadPath();
  if (!fs.existsSync(preload)) {
    return {
      harness: null,
      aborted: true,
      abortReason: `ledger preload missing at ${preload}; cannot guarantee interception`,
    };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preload}`]
      .filter(Boolean)
      .join(" "),
    PORT: String(port),
    GUARDIAN_LEDGER_CONTROL: controlPath,
    GUARDIAN_LEDGER_GATEWAY_LOG: gatewayLogPath,
    GUARDIAN_LEDGER_GATEWAY_HOSTS: gatewayHosts.join(","),
    // Fake credentials — requests are intercepted before they reach a real gateway.
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "rzp_test_guardian000000",
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "guardian_fake_secret",
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_guardian_fake",
    NODE_ENV: process.env.NODE_ENV || "test",
  };

  const child = execa(start.cmd, start.args, {
    cwd: repo,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    reject: false,
    maxBuffer: 50 * 1024 * 1024,
  });

  // execa's subprocess is a promise (never rejects with `reject: false`);
  // track completion so the poll loop can detect an early exit.
  let exited = false;
  child
    .then(() => {
      exited = true;
    })
    .catch(() => {
      exited = true;
    });

  const outFd = fs.openSync(appOut, "a");
  const pump = (chunk: Buffer | string) =>
    fs.writeSync(outFd, typeof chunk === "string" ? chunk : chunk.toString());
  child.stdout?.on("data", pump);
  child.stderr?.on("data", pump);

  const { up, aborted } = await waitForServer(
    baseUrl,
    () => exited,
    controlPath,
    STARTUP_TIMEOUT_MS,
  );

  if (!up) {
    const reason =
      (controlAborted(controlPath) ? readAbortReason(controlPath) : null) ??
      `app did not come up within ${STARTUP_TIMEOUT_MS / 1000}s (start: "${start.cmd} ${start.args.join(" ")}")`;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return { harness: null, aborted, abortReason: reason };
  }

  const harness: Harness = {
    port,
    baseUrl,
    gatewayLogPath,
    controlPath,
    close: () =>
      new Promise<void>((resolve) => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        fs.closeSync(outFd);
        resolve();
      }),
  };
  return { harness, aborted: false };
}

export function newEvidencePath(repo: string, ts: string): string {
  return path.join(repo, ".guardian", `ledger-evidence-${ts}.json`);
}

export function readAbortReason(controlPath: string): string | null {
  try {
    for (const line of fs.readFileSync(controlPath, "utf8").split(/\r?\n/)) {
      try {
        const e = JSON.parse(line);
        if (e.event === "abort" && e.reason) return e.reason;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}