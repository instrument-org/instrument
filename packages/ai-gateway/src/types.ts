import { type CaptureExceptionFunction } from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "./schemas/provider-config";

export interface AIGatewayEnv {
  Variables: {
    captureException: CaptureExceptionFunction;
    clientInfo: ClientInfo;
    getAIProviderConfigs: GetProviderConfigs;
    /** Told about each request our own platform refused; see `PlatformRefusal`. */
    reportPlatformRefusal?: ReportPlatformRefusal;
  };
}

// Non-identifying desktop-client metadata the host injects at mount time. Only
// forwarded to our own provider (see set-client-headers), never to third-party
// providers reached with a user-supplied key.
export interface ClientInfo {
  clientArch: string;
  clientName: string;
  clientPlatform: string;
  clientVersion: string;
}

export type GetProviderConfigs = () => AIGatewayProviderConfig.Type[];

/**
 * A hosted request our own platform refused before running it: no plan (402
 * `subscription-required`), a spent window (429 `usage-limit-exceeded`, with
 * `Retry-After` until it resets), too many at once (429 `concurrency-limit`),
 * or the usage meter out of reach (503 `meter-unavailable`). Keyed by the
 * body's `error.code`, since two of them share a status.
 */
export interface PlatformRefusal {
  at: number;
  code: string;
  message?: string;
  path: string;
  /** The body's `error` fields beyond code and message (`reason`, `window`, `resetsAt`). */
  details: Record<string, unknown>;
  /** Seconds, from the `Retry-After` header. */
  retryAfterSeconds?: number;
  status: number;
}

export type ReportPlatformRefusal = (refusal: PlatformRefusal) => void;
