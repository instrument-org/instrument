import { type AIGatewayModel } from "@instrument-org/ai-gateway";
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
          openai: {
            itemId: "rs_source",
            reasoningEncryptedContent: "encrypted-payload",
          },
        },
        state: "done",
        text: "Reasoning summary",
        type: "reasoning",
      },
      {
        metadata: {
          createdAt: mockDate,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        providerMetadata: {
          openai: { itemId: "msg_source", phase: "final_answer" },
        },
        state: "done",
        text: "The answer",
        type: "text",
      },
      {
        callProviderMetadata: {
          openrouter: {
            reasoning_details: [
              {
                data: "tool-encrypted-payload",
                format: "google-gemini-v1",
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
  const targetModel = createMockAIGatewayModel({ provider: "openrouter" });

  it.each([
    { aiGatewayModel: undefined, case: "records no model" },
    {
      aiGatewayModel: createMockAIGatewayModel({
        provider: "openrouter",
        providerConfigId: "different-provider-config-id",
      }),
      case: "ran on the same model through another provider config",
    },
  ])(
    "strips only OpenAI's encrypted reasoning from a turn that $case",
    async ({ aiGatewayModel }) => {
      const sourceMessage = createAssistantMessage({
        aiGatewayModel,
        modelId: "auto",
        providerId: "instrument",
      });

      const result = removeCrossModelReasoningDetails({
        messages: [sourceMessage],
        model: targetModel,
      });

      expect(result).toMatchObject({
        redactedMessageCount: 1,
        redactedReasoningDetailsCount: 1,
        sourceModelIds: ["auto"],
        sourceProviderIds: ["instrument"],
      });
      const [reasoning, text, tool] = result.messages[0]?.parts ?? [];
      expect(reasoning).toMatchObject({ type: "reasoning" });
      expect(reasoning).not.toHaveProperty("providerMetadata.openai");
      // A reply's phase and OpenRouter's reasoning details, which accepts
      // another model's, stay.
      expect(text).toBe(sourceMessage.parts[1]);
      expect(tool).toBe(sourceMessage.parts[2]);

      const modelMessages = await SessionMessage.toModelMessages(
        result.messages,
        TOOLS_FOR_MODEL_OUTPUT,
      );
      expect(JSON.stringify(modelMessages)).not.toContain(
        "reasoningEncryptedContent",
      );
    },
  );

  it("keeps a turn from the exact target model URI as it is", () => {
    const sourceMessage = createAssistantMessage({
      aiGatewayModel: targetModel,
      modelId: targetModel.canonicalId,
      providerId: targetModel.params.provider,
    });

    const result = removeCrossModelReasoningDetails({
      messages: [sourceMessage],
      model: targetModel,
    });

    expect(result).toMatchObject({
      redactedMessageCount: 0,
      redactedReasoningDetailsCount: 0,
      sourceModelIds: [],
      sourceProviderIds: [],
    });
    expect(result.messages[0]).toBe(sourceMessage);
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
        case: "keeps reasoning when the gateway reports no resolution",
        modelIdServed: "openai/gpt-6-luna",
        redacted: 0,
        sourceModelId: undefined,
      },
      {
        case: "keeps reasoning when the turn does not record who answered",
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
