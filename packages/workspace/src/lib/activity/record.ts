import {
  type AIGatewayProviderConfig,
  namesSameModel,
} from "@instrument-org/ai-gateway";
import {
  type LanguageModelUsage,
  registerTelemetry,
  type Telemetry,
  type TelemetryOptions,
} from "ai";
import { APP_NAME, OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { sessionRole } from "../chat/children";
import { classifyProviderError } from "../classify-provider-error";
import {
  type ActivityEntry,
  type ActivityKind,
  type ActivityPurpose,
  type ActivitySurface,
} from "./schema";
import { insertActivity } from "./store";

/**
 * The activity log is the person's own record of what the app asked AI models
 * to do, for Settings > Activity. Its rows go to the workspace's device files
 * (`log-file.ts`) and this computer's `workspace.db` (`store.ts`), and nowhere
 * else: nothing here sends them to Instrument's API or any other service, and
 * they never hold what was said. "Telemetry" below is only the AI SDK's name
 * for the per-call hook the rows are read from.
 */

/** What a call site knows about a request that the request itself does not carry. */
export interface ActivityCall {
  /** The chat the request was for. */
  chatId?: ChatId;
  /** The connection the request goes through; never its key. */
  connection?: { displayName?: string; id: string; type: string };
  /** Language unless said otherwise: an image made by a language model is still an image. */
  kind?: ActivityKind;
  purpose: ActivityPurpose;
  /** The session in the chat that asked: the chat's own, or one of its tasks. */
  sessionId?: StoreId.Session;
  /** Where the request came from when no chat or task asked for it. */
  surface?: ActivitySurface;
}

/** The connection a model runs through, by the provider config its URI names. */
export function connectionFor(
  configs: AIGatewayProviderConfig.Type[],
  providerConfigId: string,
): ActivityCall["connection"] {
  const config = configs.find((candidate) => candidate.id === providerConfigId);
  return (
    config && {
      displayName: config.displayName,
      id: config.id,
      type: config.type,
    }
  );
}

/** A turn's purpose: where it ran, in the chat's own session or in a task's. */
export function turnPurpose(
  chatId: ChatId,
  sessionId: StoreId.Session,
): ActivityPurpose {
  return sessionRole(chatId, sessionId) ?? "other";
}

/**
 * Records one request after the current tick, so the caller is never held up
 * by the write and a failure to write never reaches it.
 */
export function recordActivity(
  call: ActivityCall,
  entry: Omit<ActivityEntry, "kind" | "purpose">,
): void {
  setImmediate(() => {
    insertActivity({
      chatId: call.chatId ?? null,
      // Our own connection carries no name, so it goes by the app's.
      connectionName:
        call.connection?.displayName ??
        (call.connection?.type === OUR_PROVIDER_CONFIG.type ? APP_NAME : null),
      connectionType: call.connection?.type ?? null,
      kind: call.kind ?? "language",
      purpose: call.purpose,
      sessionId: call.sessionId ?? null,
      surface: call.surface ?? null,
      ...entry,
    });
  });
}

/** The token columns for what the AI SDK reports, each absent when the provider did not say. */
function usageColumns(usage: LanguageModelUsage | undefined) {
  return {
    cacheReadTokens: usage?.inputTokenDetails.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.inputTokenDetails.cacheWriteTokens ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    reasoningTokens: usage?.outputTokenDetails.reasoningTokens ?? null,
  };
}

/**
 * A telemetry integration that writes one row per model call: each step of
 * a generation is its own request. It reads timing, usage and ids, and never
 * the prompt or the output.
 */
function activityRecorder(call: ActivityCall): Telemetry {
  const pending = new Map<string, { modelId: string; startedAt: number }>();
  const settle = (
    callId: string,
    entry: Omit<ActivityEntry, "kind" | "purpose" | "startedAt">,
  ) => {
    const started = pending.get(callId);
    if (!started) {
      return;
    }
    pending.delete(callId);
    recordActivity(call, {
      durationMs: Date.now() - started.startedAt,
      modelRequested: started.modelId,
      startedAt: started.startedAt,
      ...entry,
    });
  };
  return {
    onAbort: ({ callId }) => {
      settle(callId, { status: "stopped" });
    },
    onError: (event) => {
      const { callId, error } = event as { callId: string; error: unknown }; // the dispatcher passes this shape, typed unknown upstream
      settle(callId, {
        error: error instanceof Error ? error.message : String(error),
        status:
          classifyProviderError(error).kind === "usage-limit"
            ? "limited"
            : "failed",
      });
    },
    onLanguageModelCallStart: ({ callId, modelId }) => {
      pending.set(callId, { modelId, startedAt: Date.now() });
    },
    onStepEnd: (step) => {
      const requested = pending.get(step.callId)?.modelId ?? step.model.modelId;
      settle(step.callId, {
        finishReason: step.finishReason,
        // The SDK seeds this with the id it was given and only overwrites it
        // when the provider names one, so only a difference is evidence.
        modelServed: namesSameModel(requested, step.response.modelId)
          ? null
          : step.response.modelId,
        responseId: step.response.id,
        status: "finished",
        ...usageColumns(step.usage),
      });
    },
  };
}

/** Telemetry options for one AI SDK call, recording each of its model calls under `call`. */
export function activityTelemetry(call: ActivityCall): TelemetryOptions {
  return {
    functionId: call.purpose,
    integrations: [activityRecorder(call)],
    recordInputs: false,
    recordOutputs: false,
  };
}

let registered = false;

/**
 * Records every AI SDK call that passes no telemetry of its own, as Other.
 * A call that passes {@link activityTelemetry} replaces this one, so nothing
 * is counted twice.
 */
export function registerActivityTelemetry() {
  if (registered) {
    return;
  }
  registered = true;
  registerTelemetry(activityRecorder({ purpose: "other" }));
}
