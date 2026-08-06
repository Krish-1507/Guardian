import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "../util.js";
import { findRoutesInFile, ROUTE_EXTS, type RouteMatch } from "../routes.js";
import type { LedgerEndpoint } from "../types.js";

/** Keywords that mark a route as money-moving. */
const KEYWORDS = [
  "charge",
  "capture",
  "payment",
  "transfer",
  "refund",
  "webhook",
];

/** Payment-SDK imports we watch for. */
const SDK_IMPORTS = ["razorpay", "stripe", "braintree"];

/** SDK package -> well-known gateway host(s). */
const SDK_TO_HOSTS: Record<string, string[]> = {
  razorpay: ["https://api.razorpay.com"],
  stripe: ["https://api.stripe.com"],
  braintree: ["https://api.braintreegateway.com"],
};

export interface LedgerDiscovery {
  endpoints: LedgerEndpoint[];
  /** Payment SDKs imported anywhere in the repo. */
  sdkImports: string[];
  /** Gateway hosts that must be mocked before any traffic fires. */
  gatewayHosts: string[];
}

/**
 * discover.ts — static, read-only phase of ledger mode.
 * Heuristically finds money-moving endpoints (routes whose path/handler match a
 * money keyword, or whose file imports a payment SDK) and the expected payload
 * shape. This NEVER runs the app and never touches the network.
 */
export function discover(repo: string): LedgerDiscovery {
  const repoSdkImports = new Set<string>();
  const endpoints: LedgerEndpoint[] = [];

  for (const file of walkFiles(repo, ROUTE_EXTS)) {
    safeScanFile(repo, file, repoSdkImports, endpoints);
  }

  // Keep only money-moving candidates.
  const money = endpoints.filter((e) =>
    KEYWORDS.some((k) => e.matchedKeyword === k),
  );

  const sdkImports = [...repoSdkImports];
  const gatewayHosts = [
    ...new Set(sdkImports.flatMap((s) => SDK_TO_HOSTS[s] ?? [])),
  ];

  // Surface the repo-level payment-SDK set on every endpoint so the report is
  // accurate even when the SDK is imported transitively (e.g. a routes file
  // requiring a gateway wrapper that imports razorpay).
  for (const ep of money) ep.sdkImports = sdkImports;

  return { endpoints: money, sdkImports, gatewayHosts };
}

function safeScanFile(
  repo: string,
  file: string,
  repoSdkImports: Set<string>,
  out: LedgerEndpoint[],
): void {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }

  const sdkImports = detectSdkImports(content);
  for (const s of sdkImports) repoSdkImports.add(s);

  const routes = findRoutesInFile(content, path.extname(file).toLowerCase());
  for (const r of routes) {
    const kw = KEYWORDS.find((k) => r.path.toLowerCase().includes(k))
      ?? keywordFromContext(content, r);
    if (!kw) continue;
    const rel = path.relative(repo, file);
    out.push(buildEndpoint(r, file, rel, sdkImports, kw, content));
  }
}

function frameworkName(ext: string): string {
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".ts":
    case ".tsx":
    case ".mjs":
    case ".cjs":
      return "express/fastify";
    case ".py":
      return "python";
    default:
      return ext.slice(1);
  }
}

function buildEndpoint(
  r: RouteMatch,
  absFile: string,
  relFile: string,
  sdkImports: string[],
  kw: string,
  content: string,
): LedgerEndpoint {
  const c = content.toLowerCase();
  const idemIn =
    /\bidempotency\b/.test(c) ? "Idempotency-Key" : undefined;
  const amountIn = /\bamounts?\b/.test(c) ? "amount" : undefined;
  const currencyIn = /\bcurrencies?\b/.test(c) ? "currency" : undefined;
  const orderIn = /\border_?id\b|\borderid\b/.test(c) ? "order_id" : undefined;

  return {
    method: r.method,
    path: r.path,
    file: absFile,
    line: r.line,
    framework: frameworkName(path.extname(absFile).toLowerCase()),
    matchedKeyword: kw,
    sdkImports: sdkImports.length ? sdkImports : [],
    expectedPayload: {
      idempotencyKeyHeader: idemIn,
      amountField: amountIn,
      currencyField: currencyIn,
      orderIdField: orderIn,
    },
    webhook: r.path.toLowerCase().includes("webhook"),
  };
}

function keywordFromContext(content: string, r: RouteMatch): string | undefined {
  const before = content.slice(Math.max(0, r.line - 3), r.line).toLowerCase();
  for (const k of KEYWORDS) if (before.includes(k)) return k;
  return undefined;
}

function detectSdkImports(content: string): string[] {
  const found = new Set<string>();
  for (const sdk of SDK_IMPORTS) {
    const re = new RegExp(
      `(?:require\\s*\\(\\s*['"\`]${sdk}|from\\s+['"]${sdk}|import\\s+['"]${sdk})`,
      "i",
    );
    if (re.test(content)) found.add(sdk);
  }
  return [...found];
}