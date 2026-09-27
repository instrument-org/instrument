import {
  type AIGatewayModel,
  namesSameModel,
} from "@instrument-org/ai-gateway";
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
    if (message.role !== "assistant" || answeredBySameModel(message, model)) {
      return message;
    }

    // Encrypted reasoning, OpenRouter's or OpenAI's, is provider-private
    // continuation state. It is only safe to replay to the model that wrote
    // it.
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

  if ("providerMetadata" in result) {
    const removeResult = removeOpenRouterReasoningDetails(
      result.providerMetadata,
    );
    redactedReasoningDetailsCount += removeResult.redactedReasoningDetailsCount;

    if (removeResult.redactedReasoningDetailsCount > 0) {
      result = { ...result, providerMetadata: removeResult.metadata };
    }
  }

  if (result.type === "reasoning") {
    const removeResult = removeOpenAIEncryptedReasoning(
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
