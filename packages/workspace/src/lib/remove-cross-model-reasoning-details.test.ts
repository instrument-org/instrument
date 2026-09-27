import { AIGatewayModel, AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { describe, expect, it } from "vitest";

import { RelativePathSchema } from "../schemas/paths";
import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { removeCrossModelReasoningDetails } from "./remove-cross-model-reasoning-details";

const mockDate = new Date("2026-05-27T16:45:28.214Z");

function createAssistantMessage({
  aiGatewayModel,
  modelId,
  modelIdServed,
  providerId,
}: {
  aiGatewayModel?: AIGatewayModel.Type;
  modelId: string;
  modelIdServed?: string;
  providerId: string;
}): SessionMessage.AssistantWithParts {
  const sessionId = StoreId.newSessionId();
  const messageId = StoreId.newMessageId();

  return {
    id: messageId,
    metadata: {
      aiGatewayModel,
      createdAt: mockDate,
      finishReason: "tool-calls",
      modelId,
      modelIdServed,
      providerId,
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: mockDate,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        providerMetadata: {
          openrouter: {
            provider: "xAI",
            reasoning_details: [
              {
                data: "encrypted-payload",
                format: "xai-responses-v1",
                id: "rs_source",
                type: "reasoning.encrypted",
              },
            ],
          },
        },
        state: "done",
        text: "Reasoning summary",
        type: "reasoning",
      },
      {
        callProviderMetadata: {
          openrouter: {
            reasoning_details: [
              {
                data: "tool-encrypted-payload",
                format: "xai-responses-v1",
                id: "rs_tool",
                type: "reasoning.encrypted",
              },
            ],
          },
        },
        input: { filePath: "test.txt" },
        metadata: {
          createdAt: mockDate,
          endedAt: mockDate,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
          toolName: "read_file",
        },
        output: {
          content: "file contents",
          displayedLines: 1,
          filePath: RelativePathSchema.parse("test.txt"),
          hasMoreLines: false,
          modifiedAt: 1_234_567_890,
          offset: 0,
          state: "exists",
          totalLines: 1,
          truncatedByBytes: false,
        },
        providerExecuted: true,
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse("call_read_file"),
        type: "tool-read_file",
      },
    ],
    role: "assistant",
  };
}

describe("removeCrossModelReasoningDetails", () => {
  it("removes OpenRouter reasoning details when the previous assistant turn has no exact model identity", async () => {
    const targetModel = createMockAIGatewayModel({ provider: "openrouter" });
    const sourceMessage = createAssistantMessage({
      modelId: "auto",
      providerId: "instrument",
    });

    const result = removeCrossModelReasoningDetails({
      messages: [sourceMessage],
      model: targetModel,
    });

    expect(result.redactedMessageCount).toBe(1);
    expect(result.redactedReasoningDetailsCount).toBe(2);
    expect(result.sourceModelIds).toEqual(["auto"]);
    expect(result.sourceProviderIds).toEqual(["instrument"]);

    const [message] = result.messages;
    if (!message) {
      throw new Error("Expected sanitized message");
    }

    const [reasoningPart, toolPart] = message.parts;
    if (!reasoningPart || !toolPart || !("providerMetadata" in reasoningPart)) {
      throw new Error("Expected reasoning and tool parts");
    }

    expect(reasoningPart.providerMetadata).toEqual({
      openrouter: { provider: "xAI" },
    });

    if (!("callProviderMetadata" in toolPart)) {
      throw new Error("Expected tool part");
    }

    expect(toolPart.callProviderMetadata).toBeUndefined();

    const modelMessages = await SessionMessage.toModelMessages(
      result.messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(hasOpenRouterReasoningDetails(modelMessages)).toBe(false);
  });

  it("removes OpenRouter reasoning details when the canonical model matches but the model URI differs", async () => {
    const targetModel = createMockAIGatewayModel({ provider: "openrouter" });
    const sourceModel = AIGatewayModel.Schema.parse({
      ...targetModel,
      uri: AIGatewayModelURI.Schema.parse(
        `${targetModel.author}/${targetModel.canonicalId}?provider=openrouter&providerConfigId=different-provider-config-id`,
      ),
    });

    const sourceMessage = createAssistantMessage({
      aiGatewayModel: sourceModel,
      modelId: targetModel.canonicalId,
      providerId: targetModel.params.provider,
    });

    const result = removeCrossModelReasoningDetails({
      messages: [sourceMessage],
      model: targetModel,
    });

    expect(result.redactedMessageCount).toBe(1);
    expect(result.redactedReasoningDetailsCount).toBe(2);
    expect(result.sourceModelIds).toEqual([targetModel.canonicalId]);
    expect(result.sourceProviderIds).toEqual([targetModel.params.provider]);

    const [message] = result.messages;
    expect(message).not.toBe(sourceMessage);

    const modelMessages = await SessionMessage.toModelMessages(
      result.messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(hasOpenRouterReasoningDetails(modelMessages)).toBe(false);
  });

  it("removes OpenAI encrypted reasoning, and keeps a reply's phase, when the model URI differs", () => {
    const targetModel = createMockAIGatewayModel({ provider: "openrouter" });
    const sourceMessage = createAssistantMessage({
      modelId: "auto",
      providerId: "instrument",
    });
    const [reasoningPart] = sourceMessage.parts;
    if (reasoningPart?.type !== "reasoning") {
      throw new Error("Expected a reasoning part");
    }
    const message: SessionMessage.AssistantWithParts = {
      ...sourceMessage,
      parts: [
        {
          ...reasoningPart,
          providerMetadata: {
            openai: {
              itemId: "rs_source",
              reasoningEncryptedContent: "encrypted-payload",
            },
          },
        },
        {
          metadata: reasoningPart.metadata,
          providerMetadata: {
            openai: { itemId: "msg_source", phase: "final_answer" },
          },
          state: "done",
          text: "The answer",
          type: "text",
        },
      ],
    };

    const result = removeCrossModelReasoningDetails({
      messages: [message],
      model: targetModel,
    });

    expect(result.redactedMessageCount).toBe(1);
    expect(result.redactedReasoningDetailsCount).toBe(1);

    const [sanitized] = result.messages;
    const [sanitizedReasoning, sanitizedText] = sanitized?.parts ?? [];
    if (
      sanitizedReasoning?.type !== "reasoning" ||
      sanitizedText?.type !== "text"
    ) {
      throw new Error("Expected reasoning and text parts");
    }
    expect(sanitizedReasoning.providerMetadata).toBeUndefined();
    expect(sanitizedText.providerMetadata).toEqual({
      openai: { itemId: "msg_source", phase: "final_answer" },
    });
  });

  it("keeps reasoning details when the previous assistant turn has the exact target model URI", () => {
    const targetModel = createMockAIGatewayModel({ provider: "openrouter" });
    const sourceMessage = createAssistantMessage({
      aiGatewayModel: targetModel,
      modelId: targetModel.canonicalId,
      providerId: targetModel.params.provider,
    });

    const result = removeCrossModelReasoningDetails({
      messages: [sourceMessage],
      model: targetModel,
    });

    expect(result.redactedMessageCount).toBe(0);
    expect(result.redactedReasoningDetailsCount).toBe(0);
    expect(result.sourceModelIds).toEqual([]);
    expect(result.sourceProviderIds).toEqual([]);

    const [message] = result.messages;
    expect(message).toBe(sourceMessage);
  });

  describe("on a model that stands for another", () => {
    const auto = (sourceModelId: string | undefined) => ({
      ...createMockAIGatewayModel({
        canonicalId: "auto",
        provider: "instrument",
        providerId: "instrument/auto",
      }),
      sourceModelId,
    });
    const answeredBy = (modelIdServed: string | undefined) =>
      createAssistantMessage({
        aiGatewayModel: auto(undefined),
        modelId: "auto",
        modelIdServed,
        providerId: "instrument",
      });

    it.each([
      {
        case: "keeps reasoning while the alias resolves to the model that answered",
        modelIdServed: "openai/gpt-6-luna",
        redacted: 0,
        sourceModelId: "openai/gpt-6-luna",
      },
      {
        case: "keeps reasoning from a dated build of the model it resolves to",
        modelIdServed: "openai/gpt-6-luna-2026-09-14",
        redacted: 0,
        sourceModelId: "openai/gpt-6-luna",
      },
      {
        case: "strips reasoning once the alias resolves to another model",
        modelIdServed: "openai/gpt-6-luna",
        redacted: 1,
        sourceModelId: "anthropic/claude-sonnet-5",
      },
      {
        case: "keeps reasoning when the gateway reports no resolution, as before",
        modelIdServed: "openai/gpt-6-luna",
        redacted: 0,
        sourceModelId: undefined,
      },
      {
        case: "keeps reasoning when the turn does not record who answered, as before",
        modelIdServed: undefined,
        redacted: 0,
        sourceModelId: "anthropic/claude-sonnet-5",
      },
    ])("$case", ({ modelIdServed, redacted, sourceModelId }) => {
      const result = removeCrossModelReasoningDetails({
        messages: [answeredBy(modelIdServed)],
        model: auto(sourceModelId),
      });

      expect(result.redactedMessageCount).toBe(redacted);
    });
  });
});

function hasOpenRouterReasoningDetails(value: unknown) {
  return JSON.stringify(value).includes("reasoning_details");
}
