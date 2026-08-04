import type { LedgerEndpoint, LedgerScenario } from "../types.js";

export type { LedgerEndpoint, LedgerScenario };

/** A single scenario run against one endpoint. */
export interface ScenarioRun {
  scenario: LedgerScenario;
  endpointIndex: number;
  orderId: string;
  idempotencyKey: string | null;
  /** Every identifier that could surface on the wire (order id, idem key, payment id). */
  identifiers: string[];
}

export interface AttackReport {
  runs: ScenarioRun[];
}

export interface Harness {
  port: number;
  baseUrl: string;
  /** Absolute path of the gateway receipt log (JSONL) written by the preload. */
  gatewayLogPath: string;
  /** Absolute path of the control stream (JSONL) written by the preload. */
  controlPath: string;
  /** Cleanup: kill the app, remove temp files. */
  close(): Promise<void>;
}

export interface HarnessResult {
  harness: Harness | null;
  /** When the harness could not be armed safely. */
  abortReason?: string;
  /** True when the app reported a safety abort (uninterceptable traffic detected). */
  aborted: boolean;
}

/** Normalized command for a repo's start script. */
export interface StartCommand {
  cmd: string;
  args: string[];
}
