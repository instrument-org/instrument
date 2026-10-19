import {
  type AIGatewayModel,
  namesSameModel,
} from "@instrument-org/ai-gateway";
import { type ProviderMetadata } from "ai";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";

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
    if (message.role !== "assistant" || answeredBySameModel(message, model)) {
      return message;
    }

    // OpenAI's encrypted reasoning is provider-private continuation state,
    // only safe to replay to the model that wrote it. OpenRouter's
    // `reasoning_details` stay: it accepts another model's, tool calls
    // included.
    const sanitizedParts = message.parts.map((part) => {
      const result = removeEncryptedReasoningFromPart(part);
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

/**
 * Whether the model that answered `message` is the one about to be asked.
 *
 * The stored model URI has to match. For a model that stands for another,
 * such as `instrument/auto`, the URI can stay the same while the model behind
 * it changes, so the model that actually answered has to be the one the alias
 * resolves to now. Without a current resolution (a gateway that does not
 * report one) or a record of who answered, the URI is all there is to go on.
 */
function answeredBySameModel(
  message: SessionMessage.AssistantWithParts,
  model: AIGatewayModel.Type,
): boolean {
  if (message.metadata.aiGatewayModel?.uri !== model.uri) {
    return false;
  }
  const served = message.metadata.modelIdServed;
  if (model.sourceModelId === undefined || served === undefined) {
    return true;
  }
  return namesSameModel(model.sourceModelId, served);
}

function hasDefinedValues(record: Record<string, unknown>) {
  return Object.values(record).some((value) => value !== undefined);
}

function removeEncryptedReasoningFromPart(part: SessionMessagePart.Type): {
  part: SessionMessagePart.Type;
  redactedReasoningDetailsCount: number;
} {
  let result = part;
  let redactedReasoningDetailsCount = 0;

  if (result.type === "reasoning") {
    const removeResult = removeOpenAIEncryptedReasoning(
      result.providerMetadata,
    );
    redactedReasoningDetailsCount += removeResult.redactedReasoningDetailsCount;

    if (removeResult.redactedReasoningDetailsCount > 0) {
      result = { ...result, providerMetadata: removeResult.metadata };
    }
  }

  return { part: result, redactedReasoningDetailsCount };
}

// OpenAI's Responses API returns a reasoning item's content encrypted, keyed
// by the item id it goes back under; a reasoning part carries nothing else in
// its `openai` namespace, so the namespace goes whole.
function removeOpenAIEncryptedReasoning(
  metadata: ProviderMetadata | undefined,
): {
  metadata: ProviderMetadata | undefined;
  redactedReasoningDetailsCount: number;
} {
  const openaiMetadata = metadata?.openai;

  if (!openaiMetadata || !("reasoningEncryptedContent" in openaiMetadata)) {
    return { metadata, redactedReasoningDetailsCount: 0 };
  }

  const { openai: _openai, ...remainingMetadata } = metadata;

  return {
    metadata: hasDefinedValues(remainingMetadata)
      ? remainingMetadata
      : undefined,
    redactedReasoningDetailsCount: 1,
  };
}
