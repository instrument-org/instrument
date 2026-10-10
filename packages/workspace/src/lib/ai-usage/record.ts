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

import { type TaskId } from "../../schemas/task-id";
import { chatOf, resolveChat } from "../record-folders";
import {
  type AIUsageEntry,
  type AIUsageKind,
  type AIUsagePurpose,
  type AIUsageSurface,
} from "./schema";
import { insertAIUsage } from "./store";

/** What a call site knows about a request that the request itself does not carry. */
export interface AIUsageCall {
  /** The connection the request goes through; never its key. */
  connection?: { displayName?: string; id: string; type: string };
  /** Language unless said otherwise: an image made by a language model is still an image. */
  kind?: AIUsageKind;
  purpose: AIUsagePurpose;
  /** Where the request came from when no chat or task asked for it. */
  surface?: AIUsageSurface;
  /** The chat or task the request was for. */
  taskId?: TaskId;
}

/** The connection a model runs through, by the provider config its URI names. */
export function connectionFor(
  configs: AIGatewayProviderConfig.Type[],
  providerConfigId: string,
): AIUsageCall["connection"] {
  const config = configs.find((candidate) => candidate.id === providerConfigId);
  return (
    config && {
      displayName: config.displayName,
      id: config.id,
      type: config.type,
    }
  );
}

/** A turn's purpose: where it ran, in the chat's own turn or in a task's. */
export function turnPurpose(taskId: TaskId): AIUsagePurpose {
  return resolveChat(taskId) === undefined ? "task" : "chat";
}

/**
 * Records one request after the current tick, so the caller is never held up
 * by the write and a failure to write never reaches it.
 */
export function recordAIUsage(
  call: AIUsageCall,
  entry: Omit<AIUsageEntry, "kind" | "purpose">,
): void {
  setImmediate(() => {
    try {
      insertAIUsage({
        chatId: call.taskId ? (chatOf(call.taskId) ?? null) : null,
        connectionId: call.connection?.id ?? null,
        connectionName: call.connection?.displayName ?? null,
        connectionType: call.connection?.type ?? null,
        kind: call.kind ?? "language",
        purpose: call.purpose,
        surface: call.surface ?? null,
        taskId: call.taskId ?? null,
        ...entry,
      });
    } catch {
      // insertAIUsage reports its own failures; resolving the chat is all that is left to fail.
    }
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
function usageRecorder(call: AIUsageCall): Telemetry {
  const pending = new Map<string, { modelId: string; startedAt: number }>();
  const settle = (
    callId: string,
    entry: Omit<AIUsageEntry, "kind" | "purpose" | "startedAt">,
  ) => {
    const started = pending.get(callId);
    if (!started) {
      return;
    }
    pending.delete(callId);
    recordAIUsage(call, {
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
        status: "failed",
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
export function aiUsageTelemetry(call: AIUsageCall): TelemetryOptions {
  return {
    functionId: call.purpose,
    integrations: [usageRecorder(call)],
    recordInputs: false,
    recordOutputs: false,
  };
}

let registered = false;

/**
 * Records every AI SDK call that passes no telemetry of its own, as Other.
 * A call that passes {@link aiUsageTelemetry} replaces this one, so nothing
 * is counted twice.
 */
export function registerAIUsageTelemetry() {
  if (registered) {
    return;
  }
  registered = true;
  registerTelemetry(usageRecorder({ purpose: "other" }));
}
