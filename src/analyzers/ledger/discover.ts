import fs from "node:fs";
import path from "node:path";
import { walkFiles, lineOf } from "../util.js";
import type { LedgerEndpoint } from "../types.js";

const JS_EXTS = [".js", ".jsx", ".ts", ".tsx"];
const PY_EXTS = [".py"];

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

interface RouteMatch {
  method: string;
  path: string;
  line: number;
}

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
  const jsFiles = walkFiles(repo, JS_EXTS);
  const pyFiles = walkFiles(repo, PY_EXTS);

  const repoSdkImports = new Set<string>();
  const endpoints: LedgerEndpoint[] = [];

  for (const file of jsFiles) safeScanFile(repo, file, false, repoSdkImports, endpoints);
  for (const file of pyFiles) safeScanFile(repo, file, true, repoSdkImports, endpoints);

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
  isPython: boolean,
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

  const routes = isPython ? findPythonRoutes(content) : findJsRoutes(content);
  for (const r of routes) {
    const kw = KEYWORDS.find((k) => r.path.toLowerCase().includes(k))
      ?? keywordFromContext(content, r);
    if (!kw) continue;
    const rel = path.relative(repo, file);
    out.push(buildEndpoint(r, file, rel, sdkImports, kw, isPython, content));
  }
}

function buildEndpoint(
  r: RouteMatch,
  absFile: string,
  relFile: string,
  sdkImports: string[],
  kw: string,
  isPython: boolean,
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
    framework: isPython ? "python" : "express/fastify",
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

/** Express / Fastify route registration. */
const JS_ROUTE_RE =
  /(?:^|\s)(?:app|router|route|fastify|server|instance|application)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2/g;

function findJsRoutes(content: string): RouteMatch[] {
  const routes: RouteMatch[] = [];
  let m: RegExpExecArray | null;
  JS_ROUTE_RE.lastIndex = 0;
  while ((m = JS_ROUTE_RE.exec(content)) !== null) {
    routes.push({
      method: m[1].toUpperCase(),
      path: m[3],
      line: lineOf(content, m.index),
    });
  }
  return routes;
}

/** Flask / Django route registration. */
const PY_ROUTE_RE =
  /@\s*[\w.]*\.\s*(route|get|post|put|patch|delete)\s*\(\s*(['"])([^'"]+)\2|\b(?:path|re_path)\s*\(\s*(['"])([^'"]+)\4\s*,\s*\s*views\.([\w]+)/g;

function findPythonRoutes(content: string): RouteMatch[] {
  const routes: RouteMatch[] = [];
  let m: RegExpExecArray | null;
  PY_ROUTE_RE.lastIndex = 0;
  while ((m = PY_ROUTE_RE.exec(content)) !== null) {
    if (m[3]) {
      routes.push({
        method: m[1] === "route" ? "POST" : m[1].toUpperCase(),
        path: m[3],
        line: lineOf(content, m.index),
      });
    } else if (m[5]) {
      routes.push({ method: "POST", path: m[5], line: lineOf(content, m.index) });
    }
  }
  return routes;
}