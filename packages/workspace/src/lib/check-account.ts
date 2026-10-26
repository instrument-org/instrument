import { AIGatewayModelURI, fetchAISDKModel } from "@instrument-org/ai-gateway";
import { APICallError, generateText } from "ai";

import { getWorkspaceServerURL } from "../logic/server/url";
import { type WorkspaceConfig } from "../types";
import { activityTelemetry, connectionFor } from "./activity/record";
import {
  classifyProviderError,
  providerErrorCodes,
} from "./classify-provider-error";
import { PLAN_NOT_ELIGIBLE_CODES } from "./plan-not-eligible-codes";

/**
 * Whether a plan account (a ChatGPT or Claude account) can run a turn right
 * now.
 *
 * - `not-eligible`: signed in, but the account's plan can't be used here (a
 *   free or lapsed plan, or a workspace that turned it off).
 * - `out-of-usage`: the plan works but has no usage left until `resetsAt`, an
 *   ISO time.
 * - `unknown`: nothing conclusive came back (offline, an outage); asking
 *   again may answer.
 */
export type AccountCheck =
  | { message: string; state: "unknown" }
  | { plan?: string; state: "not-eligible" }
  | { plan?: string; state: "ready" }
  | { resetsAt?: string; state: "out-of-usage" }
  | { state: "signed-out" };

/**
 * Asks the account the smallest question there is, on `modelURI`, through
 * the same gateway path a chat takes, and reads the answer: any reply means
 * it works, and a refusal says why it doesn't. It runs once, without the
 * retries a turn gets, and draws on the plan's own usage. `signal` ends the
 * request itself; an aborted check rejects with the signal's reason, so the
 * caller can tell its own cancel from its deadline.
 */
export async function checkAccountWithRequest({
  modelURI,
  signal,
  workspaceConfig,
}: {
  modelURI: AIGatewayModelURI.Type;
  signal?: AbortSignal;
  workspaceConfig: Pick<
    WorkspaceConfig,
    "captureException" | "getAIProviderConfigs" | "modelCache"
  >;
}): Promise<AccountCheck> {
  const model = await fetchAISDKModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  signal?.throwIfAborted();
  if (!model.ok) {
    return readAccountCheckFailure(model.error);
  }
  const parsed = AIGatewayModelURI.parse(modelURI);
  try {
    await generateText({
      abortSignal: signal,
      maxRetries: 0,
      model: model.value,
      prompt: "Reply with OK.",
      telemetry: activityTelemetry({
        connection: parsed.ok
          ? connectionFor(
              workspaceConfig.getAIProviderConfigs(),
              parsed.value.params.providerConfigId,
            )
          : undefined,
        purpose: "account-check",
      }),
    });
    return { state: "ready" };
  } catch (error) {
    signal?.throwIfAborted();
    return readAccountCheckFailure(error);
  }
}

/** What a failed check says about the account, read from the error. */
export function readAccountCheckFailure(error: unknown): AccountCheck {
  const { kind } = classifyProviderError(error);
  const codes = providerErrorCodes(error);
  if (codes.some((code) => PLAN_NOT_ELIGIBLE_CODES.has(code))) {
    return { state: "not-eligible" };
  }
  if (kind === "usage-limit") {
    return { resetsAt: resetsAtOf(error), state: "out-of-usage" };
  }
  if (kind === "auth") {
    return { state: "signed-out" };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    state: "unknown",
  };
}

/**
 * The reset time a usage refusal names in its body, as an ISO time: Claude's
 * `resets_at` in seconds since the epoch, or ChatGPT's `resets_in_seconds`
 * from now.
 */
function resetsAtOf(error: unknown) {
  if (!APICallError.isInstance(error) || !error.responseBody) {
    return undefined;
  }
  let body: unknown;
  try {
    body = JSON.parse(error.responseBody);
  } catch {
    return undefined;
  }
  const inner =
    typeof body === "object" && body !== null && "error" in body
      ? body.error
      : undefined;
  if (typeof inner !== "object" || inner === null) {
    return undefined;
  }
  if ("resets_at" in inner) {
    const at = inner.resets_at;
    if (typeof at === "number") {
      return new Date(at * 1000).toISOString();
    }
    if (typeof at === "string") {
      return at;
    }
  }
  if (
    "resets_in_seconds" in inner &&
    typeof inner.resets_in_seconds === "number"
  ) {
    return new Date(Date.now() + inner.resets_in_seconds * 1000).toISOString();
  }
  return undefined;
}
