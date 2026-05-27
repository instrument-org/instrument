import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { type ProviderMetadata } from "ai";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { isToolPart } from "./is-tool-part";

export function removeCrossModelReasoningDetails({
  messages,
  model,
}: {
  messages: SessionMessage.WithParts[];
  model: AIGatewayModel.Type;
}): {
  messages: SessionMessage.WithParts[];
  redactedMessageCount: number;
  redactedReasoningDetailsCount: number;
  sourceModelIds: string[];
  sourceProviderIds: string[];
} {
  let redactedMessageCount = 0;
  let redactedReasoningDetailsCount = 0;
  const sourceModelIds = new Set<string>();
  const sourceProviderIds = new Set<string>();

  const sanitizedMessages = messages.map((message) => {
    if (
      message.role !== "assistant" ||
      message.metadata.aiGatewayModel?.uri === model.uri
    ) {
      return message;
    }

    // OpenRouter encrypted reasoning is provider-private continuation state.
    // It is only safe to replay for the exact same stored model URI.
    const sanitizedParts = message.parts.map((part) => {
      const result = removeOpenRouterReasoningDetailsFromPart(part);
      redactedReasoningDetailsCount += result.redactedReasoningDetailsCount;
      return result.part;
    });

    if (sanitizedParts.some((part, index) => part !== message.parts[index])) {
      redactedMessageCount += 1;
      sourceModelIds.add(message.metadata.modelId);
      sourceProviderIds.add(message.metadata.providerId);
    }

    return {
      ...message,
      parts: sanitizedParts,
    };
  });

  return {
    messages: sanitizedMessages,
    redactedMessageCount,
    redactedReasoningDetailsCount,
    sourceModelIds: [...sourceModelIds],
    sourceProviderIds: [...sourceProviderIds],
  };
}

function hasDefinedValues(record: Record<string, unknown>) {
  return Object.values(record).some((value) => value !== undefined);
}

function removeOpenRouterReasoningDetails(
  metadata: ProviderMetadata | undefined,
): {
  metadata: ProviderMetadata | undefined;
  redactedReasoningDetailsCount: number;
} {
  const openrouterMetadata = metadata?.openrouter;

  if (!openrouterMetadata || !("reasoning_details" in openrouterMetadata)) {
    return { metadata, redactedReasoningDetailsCount: 0 };
  }

  const { reasoning_details: reasoningDetails, ...remainingOpenRouter } =
    openrouterMetadata;
  const redactedReasoningDetailsCount = Array.isArray(reasoningDetails)
    ? reasoningDetails.length
    : 1;

  const remainingMetadata: ProviderMetadata = { ...metadata };

  if (hasDefinedValues(remainingOpenRouter)) {
    remainingMetadata.openrouter = remainingOpenRouter;
  } else {
    delete remainingMetadata.openrouter;
  }

  return {
    metadata: hasDefinedValues(remainingMetadata)
      ? remainingMetadata
      : undefined,
    redactedReasoningDetailsCount,
  };
}

function removeOpenRouterReasoningDetailsFromPart(
  part: SessionMessagePart.Type,
): {
  part: SessionMessagePart.Type;
  redactedReasoningDetailsCount: number;
} {
  let result = part;
  let redactedReasoningDetailsCount = 0;

  if ("providerMetadata" in result) {
    const removeResult = removeOpenRouterReasoningDetails(
      result.providerMetadata,
    );
    redactedReasoningDetailsCount += removeResult.redactedReasoningDetailsCount;

    if (removeResult.redactedReasoningDetailsCount > 0) {
      result = { ...result, providerMetadata: removeResult.metadata };
    }
  }

  if (isToolPart(result)) {
    const removeResult = removeOpenRouterReasoningDetails(
      result.callProviderMetadata,
    );
    redactedReasoningDetailsCount += removeResult.redactedReasoningDetailsCount;

    if (removeResult.redactedReasoningDetailsCount > 0) {
      result = { ...result, callProviderMetadata: removeResult.metadata };
    }
  }

  return { part: result, redactedReasoningDetailsCount };
}
