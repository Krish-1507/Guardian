import type { LedgerEndpoint, LedgerScenario } from "../types.js";
import type { AttackReport, ScenarioRun } from "./types.js";

const AMOUNT = 1000;
const CURRENCY = "INR";
const WEBHOOK_DELAY_MS = 300;
const RETRY_DELAY_MS = 2000;

export interface AttackOptions {
  baseUrl: string;
  endpoints: LedgerEndpoint[];
}

/**
 * attacks.ts — fires the ledger attack scenarios against each discovered
 * endpoint, always with a fake idempotency key / order id, targeting only the
 * locally-running app (whose outbound HTTP is sandboxed by the preload).
 *
 *   (a) duplicate-webhook     — same payload fired twice, 300ms apart.
 *   (b) concurrent-double-submit — two identical requests fired simultaneously.
 *   (c) delayed-retry         — request 1 succeeds, same key arrives 2s later.
 */
export async function runAttacks(opts: AttackOptions): Promise<AttackReport> {
  const runs: ScenarioRun[] = [];
  let idx = 0;

  for (let i = 0; i < opts.endpoints.length; i++) {
    const ep = opts.endpoints[i];

    if (ep.webhook) {
      idx += 1;
      const run = await runDuplicateWebhook(opts.baseUrl, ep, i, idx);
      if (run) runs.push(run);
      continue;
    }

    idx += 1;
    const conc = await runConcurrent(opts.baseUrl, ep, i, idx);
    if (conc) runs.push(conc);

    idx += 1;
    const retry = await runDelayedRetry(opts.baseUrl, ep, i, idx);
    if (retry) runs.push(retry);
  }

  return { runs };
}

/* ------------------------------------------------------------------ */

interface ReqResult {
  status: number;
  body: unknown;
  ok: boolean;
}

async function postRaw(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<ReqResult> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    return { status: res.status, body: parsed, ok: res.ok };
  } catch {
    return { status: 0, body: null, ok: false };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** (a) duplicate webhook — same payload twice, 300ms apart. */
async function runDuplicateWebhook(
  baseUrl: string,
  ep: LedgerEndpoint,
  epIndex: number,
  n: number,
): Promise<ScenarioRun | null> {
  const orderId = `ord_webhook_${n}`;
  const paymentId = `pay_webhook_${n}`;
  const key = `idem_webhook_${n}`;
  const payload = {
    event: "payment.captured",
    id: `${orderId}_evt`,
    payload: {
      payment: { entity: { id: paymentId, amount: AMOUNT, currency: CURRENCY, order_id: orderId } },
    },
  };
  const r1 = await postRaw(baseUrl, ep.path, payload, {});
  await sleep(WEBHOOK_DELAY_MS);
  const r2 = await postRaw(baseUrl, ep.path, payload, {});
  void r1;
  void r2;
  return {
    scenario: "duplicate-webhook",
    endpointIndex: epIndex,
    orderId,
    idempotencyKey: key,
    identifiers: [orderId, paymentId, key],
  };
}

/** (b) concurrent double-submit — two identical requests at once. */
async function runConcurrent(
  baseUrl: string,
  ep: LedgerEndpoint,
  epIndex: number,
  n: number,
): Promise<ScenarioRun | null> {
  const orderId = `ord_conc_${n}`;
  const key = `idem_conc_${n}`;
  const body = { amount: AMOUNT, currency: CURRENCY };
  const headers = { ["Idempotency-Key"]: key };
  const [r1, r2] = await Promise.all([
    postRaw(baseUrl, resolvePath(ep.path, orderId), body, headers),
    postRaw(baseUrl, resolvePath(ep.path, orderId), body, headers),
  ]);
  void r1;
  void r2;
  return {
    scenario: "concurrent-double-submit",
    endpointIndex: epIndex,
    orderId,
    idempotencyKey: key,
    identifiers: [orderId, key],
  };
}

/** (c) delayed retry — request 1 succeeds, same key arrives 2s later. */
async function runDelayedRetry(
  baseUrl: string,
  ep: LedgerEndpoint,
  epIndex: number,
  n: number,
): Promise<ScenarioRun | null> {
  const orderId = `ord_retry_${n}`;
  const key = `idem_retry_${n}`;
  const body = { amount: AMOUNT, currency: CURRENCY };
  const headers = { ["Idempotency-Key"]: key };
  const p = resolvePath(ep.path, orderId);
  await postRaw(baseUrl, p, body, headers);
  await sleep(RETRY_DELAY_MS);
  await postRaw(baseUrl, p, body, headers);
  return {
    scenario: "delayed-retry",
    endpointIndex: epIndex,
    orderId,
    idempotencyKey: key,
    identifiers: [orderId, key],
  };
}

/** Substitute a fake order id into a path route param (`:id`, `{id}`, `<id>`). */
function resolvePath(route: string, orderId: string): string {
  return route
    .replace(/:([A-Za-z_][\w-]*)/g, (_, name) =>
      /id|order/i.test(name) ? orderId : name,
    )
    .replace(/\{([A-Za-z_][\w-]*)\}/g, (_, name) =>
      /id|order/i.test(name) ? orderId : name,
    )
    .replace(/<([A-Za-z_][\w-]*)>/g, (_, name) =>
      /id|order/i.test(name) ? orderId : name,
    );
}

export type { LedgerScenario, ScenarioRun };