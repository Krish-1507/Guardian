import fs from "node:fs";
import path from "node:path";
import type {
  LedgerChargeCall,
  LedgerEndpoint,
  LedgerEvidence,
  LedgerScenario,
} from "../types.js";
import type { AttackReport } from "./types.js";

export interface EvidenceInput {
  repo: string;
  discovery: { endpoints: LedgerEndpoint[] };
  attacks: AttackReport;
  gatewayLogPath: string;
}

export interface EvidenceOutput {
  evidence: LedgerEvidence[];
  note?: string;
}

const SCENARIO_LABEL: Record<LedgerScenario, string> = {
  "duplicate-webhook": "webhook replay",
  "concurrent-double-submit": "concurrent double-submit",
  "delayed-retry": "delayed retry (client timeout)",
};

const CHARGE_GROUPS_TO_REPORT = 20;

/**
 * evidence.ts — counts how many times the mocked gateway actually received a
 * "charge" call for each idempotency key. Any key with >1 charge call is a
 * PROVEN double-charge. Reads the gateway's own receipt log (written by the
 * nock preload), so nothing here is simulated or fabricated.
 */
export function analyzeEvidence(input: EvidenceInput): EvidenceOutput {
  const entries = readGatewayLog(input.gatewayLogPath);
  if (entries.length === 0) {
    return {
      evidence: [],
      note:
        "no gateway calls were recorded — the app may not have reached the payment " +
        "gateway, or an outbound call may have been blocked. Check the ledger run logs.",
    };
  }

  const chargeCalls = entries.filter((e) => e.charge);
  const byKey = new Map<string, LedgerChargeCall[]>();
  for (const e of chargeCalls) {
    const k = e.key || "(no-key)";
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(e);
  }

  const evidence: LedgerEvidence[] = [];
  for (const [key, calls] of byKey) {
    if (calls.length < 2) continue; // single charge — idempotency held
    const run = matchRun(input.attacks, key, calls);
    const endpoint = run
      ? input.discovery.endpoints[run.endpointIndex]
      : undefined;

    const scenarioLabel = run ? SCENARIO_LABEL[run.scenario] : "gateway replay";
    const orderId = (run && run.orderId) || String(calls[0].orderId || key);
    const idemKey = (run && run.idempotencyKey) || key;
    const scenario: LedgerScenario = (run && run.scenario) || "duplicate-webhook";
    const gapMs = calls.length > 1 ? msBetween(calls[0], calls[1]) : null;

    const keyFrag = run && run.idempotencyKey ? ` (idempotency key "${idemKey}")` : "";
    const summary =
      `order ${orderId} charged ${calls.length} times via ${scenarioLabel}` +
      `${keyFrag}, ${gapMs}ms apart`;

    evidence.push({
      orderId,
      idempotencyKey: idemKey,
      scenario,
      endpoint: endpoint ? endpoint.path : "(unknown endpoint)",
      endpointFile: endpoint && endpoint.file ? path.relative(input.repo, endpoint.file) : undefined,
      doubleCharged: true,
      chargeCalls: calls,
      summary,
    });
  }

  const doubleCharges = evidence.length;
  const keyNote =
    doubleCharges > 0
      ? `${doubleCharges} proven double-charge(s) observed at the mocked gateway`
      : undefined;
  evidence.sort((a, b) => b.chargeCalls.length - a.chargeCalls.length);
  const trimmed = evidence.slice(0, CHARGE_GROUPS_TO_REPORT);
  return { evidence: trimmed, note: keyNote };
}

function readGatewayLog(p: string): LedgerChargeCall[] {
  const out: LedgerChargeCall[] = [];
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as LedgerChargeCall);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function matchRun(
  attacks: AttackReport,
  key: string,
  calls: LedgerChargeCall[],
): AttackReport["runs"][number] | undefined {
  // Prefer an exact identifier match, then a substring match, across the runs.
  const ids = new Set<string>();
  for (const c of calls) {
    if (c.orderId) ids.add(c.orderId);
    if (c.key) ids.add(c.key);
  }
  ids.add(key);
  let exact: AttackReport["runs"][number] | undefined;
  let sub: AttackReport["runs"][number] | undefined;
  for (const run of attacks.runs) {
    for (const id of run.identifiers) {
      if (ids.has(id)) {
        if (!exact) exact = run;
      } else if (key.length && (key.includes(id) || id.includes(key))) {
        if (!sub) sub = run;
      }
    }
  }
  return exact || sub;
}

function msBetween(a: LedgerChargeCall, b: LedgerChargeCall): number {
  const ta = new Date(a.at).getTime();
  const tb = new Date(b.at).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Math.round(Math.abs(tb - ta));
  return Math.round(tb - ta);
}

export function writeEvidenceFile(
  filePath: string,
  evidence: LedgerEvidence[],
  gatewayLogPath: string,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const doc = {
    generatedAt: new Date().toISOString(),
    gatewayLogPath,
    doubleCharges: evidence.length,
    evidence,
  };
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2));
}