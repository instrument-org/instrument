import {
  fetchAISDKModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway";
import { APICallError, generateText } from "ai";

import { getWorkspaceServerURL } from "../logic/server/url";
import { type WorkspaceConfig } from "../types";
import {
  classifyProviderError,
  providerErrorCodes,
} from "./classify-provider-error";

/**
 * Whether a subscription account (a ChatGPT or Claude account) can run a
 * turn right now.
 *
 * - `not-eligible`: signed in, but the account's plan can't be used here (a
 *   free or lapsed plan, or a workspace that turned it off).
 * - `out-of-usage`: the plan works but has no usage left until `resetsAt`.
 * - `unknown`: nothing conclusive came back (offline, an outage); asking
 *   again may answer.
 */
export type AccountCheck =
  | { plan?: string; state: "not-eligible" }
  | { plan?: string; state: "ready" }
  | { resetsAt?: string; state: "out-of-usage" }
  | { message: string; state: "unknown" }
  | { state: "signed-out" };

/** Codes for an account that is signed in but whose plan can't be used. */
const NOT_ELIGIBLE_CODES = new Set([
  "chatpass_v2_scope_not_authorized",
  "subscription_sharing_invalid_user",
  "subscription_sharing_user_not_eligible",
]);

/**
 * Asks the account the smallest question there is, on `modelURI`, through
 * the same gateway path a chat takes, and reads the answer: any reply means
 * it works, and a refusal says why it doesn't. It runs once, without the
 * retries a turn gets, and draws on the plan's own usage.
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
  if (!model.ok) {
    return readAccountCheckFailure(model.error);
  }
  try {
    await generateText({
      abortSignal: signal,
      maxRetries: 0,
      model: model.value,
      prompt: "Reply with OK.",
    });
    return { state: "ready" };
  } catch (error) {
    return readAccountCheckFailure(error);
  }
}

/** What a failed check says about the account, read from the error. */
export function readAccountCheckFailure(error: unknown): AccountCheck {
  const { kind } = classifyProviderError(error);
  const codes = providerErrorCodes(error);
  if (kind === "usage-limit") {
    return { resetsAt: resetsAtOf(error), state: "out-of-usage" };
  }
  if (kind === "auth") {
    return codes.some((code) => NOT_ELIGIBLE_CODES.has(code))
      ? { state: "not-eligible" }
      : { state: "signed-out" };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    state: "unknown",
  };
}

/** The reset time a usage refusal names in its body, when it names one. */
function resetsAtOf(error: unknown) {
  if (!APICallError.isInstance(error) || !error.responseBody) {
    return undefined;
  }
  try {
    const body: unknown = JSON.parse(error.responseBody);
    const inner =
      typeof body === "object" && body !== null && "error" in body
        ? body.error
        : undefined;
    const resetsAt =
      typeof inner === "object" && inner !== null && "resets_at" in inner
        ? inner.resets_at
        : undefined;
    return typeof resetsAt === "string" ? resetsAt : undefined;
  } catch {
    return undefined;
  }
}
