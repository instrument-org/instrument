import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { generateTitleFromUserMessage } from "./generate-title-from-user-message";
import { TASK_NAME_MAX_OUTPUT_TOKENS } from "./llm-token-limits";
import { getWorkspaceConfig } from "./workspace-config";

function createMockLanguageModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: () =>
      Promise.resolve({
        content: [{ text, type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: undefined,
            total: 10,
          },
          outputTokens: {
            reasoning: undefined,
            text: undefined,
            total: 15,
          },
        },
        warnings: [],
      }),
  });
}

function createMockMessage(text: string) {
  return {
    id: StoreId.newMessageId(),
    metadata: {
      createdAt: new Date(),
      sessionId: StoreId.newSessionId(),
    },
    parts: [
      {
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: StoreId.newMessageId(),
          sessionId: StoreId.newSessionId(),
        },
        text,
        type: "text" as const,
      },
    ],
    role: "user" as const,
  };
}

const mockMessage = createMockMessage("Build a todo app");

function createMockLanguageModelThatThrows(error: Error) {
  return new MockLanguageModelV3({
    doGenerate: () => Promise.reject(error),
  });
}

function setupTest(
  generatedText: string,
  options: { captureException?: (...args: unknown[]) => void } = {},
) {
  const mockLanguageModel = createMockLanguageModel(generatedText);
  const model = createMockAIGatewayModel();
  createMockTaskConfig(TaskIdSchema.parse("mock"), {
    aiSDKModel: mockLanguageModel,
    model,
  });

  const workspaceConfig = options.captureException
    ? {
        ...getWorkspaceConfig(),
        captureException: options.captureException,
      }
    : getWorkspaceConfig();

  return {
    generate: (message = mockMessage) =>
      generateTitleFromUserMessage({
        message,
        model,
        workspaceConfig,
      }),
    mockLanguageModel,
  };
}

function setupTestWithModel(
  languageModel: MockLanguageModelV3,
  options: { captureException?: (...args: unknown[]) => void } = {},
) {
  const model = createMockAIGatewayModel();
  createMockTaskConfig(TaskIdSchema.parse("mock"), {
    aiSDKModel: languageModel,
    model,
  });

  const workspaceConfig = options.captureException
    ? {
        ...getWorkspaceConfig(),
        captureException: options.captureException,
      }
    : getWorkspaceConfig();

  return {
    generate: (message = mockMessage) =>
      generateTitleFromUserMessage({
        message,
        model,
        workspaceConfig,
      }),
  };
}

describe("generateTitleFromUserMessage", () => {
  it("should limit generated title to 5 words maximum", async () => {
    const { generate } = setupTest(
      "Very Long Task Title That Exceeds The Five Word Limit",
    );

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(5);
    expect(title).toBe("Very Long Task Title That");
  });

  it("should preserve titles with 5 words or fewer", async () => {
    const { generate } = setupTest("Todo List Manager");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(3);
    expect(title).toBe("Todo List Manager");
  });

  it("should handle exactly 5 words", async () => {
    const { generate } = setupTest("Chat With File Upload System");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(5);
    expect(title).toBe("Chat With File Upload System");
  });

  it("should handle single word titles", async () => {
    const { generate } = setupTest("Todos");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(1);
    expect(title).toBe("Todos");
  });

  it("should cap max output tokens for task-name generation", async () => {
    const { generate, mockLanguageModel } = setupTest("Todo List Manager");

    const result = await generate();

    expect(result.isOk()).toBe(true);
    expect(mockLanguageModel.doGenerateCalls).toHaveLength(1);
    expect(mockLanguageModel.doGenerateCalls[0]?.maxOutputTokens).toBe(
      TASK_NAME_MAX_OUTPUT_TOKENS,
    );
  });

  it("should handle empty message gracefully", async () => {
    const { generate } = setupTest("Default Title");
    const emptyMessage = createMockMessage("");

    const result = await generate(emptyMessage);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"Failed to generate title: No user message"`,
    );
  });

  it("should trim whitespace from generated title", async () => {
    const { generate } = setupTest("  Todo Manager  ");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title).toBe("Todo Manager");
  });

  it("should handle non-English characters", async () => {
    // cspell:ignore تطبيق المهام اليومية
    const { generate } = setupTest("تطبيق المهام اليومية");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title).toBe("تطبيق المهام اليومية");
  });

  it("should limit non-English titles to 5 words", async () => {
    const { generate } = setupTest(
      "システム 管理 アプリケーション データベース 設定 追加",
    );

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(5);
    expect(title).toBe("システム 管理 アプリケーション データベース 設定");
  });

  it("should handle mixed language titles", async () => {
    const { generate } = setupTest("Chat アプリ with ファイル upload");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(5);
    expect(title).toBe("Chat アプリ with ファイル upload");
  });

  describe("captureException behavior", () => {
    it("calls captureException for unexpected errors", async () => {
      const captureException = vi.fn();
      const unknownError = new Error("Something unexpected");
      const { generate } = setupTestWithModel(
        createMockLanguageModelThatThrows(unknownError),
        { captureException },
      );

      const result = await generate();

      expect(result.isErr()).toBe(true);
      expect(captureException).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledWith(unknownError);
    });

    it("does not call captureException for non-retryable gateway errors", async () => {
      const captureException = vi.fn();
      const gatewayError = new APICallError({
        isRetryable: false,
        message: "Insufficient credits.",
        requestBodyValues: {},
        responseBody: JSON.stringify({
          error: {
            code: "insufficient-credits",
            message: "Insufficient credits.",
            retryable: false,
          },
        }),
        statusCode: 403,
        url: "https://example.com",
      });
      const { generate } = setupTestWithModel(
        createMockLanguageModelThatThrows(gatewayError),
        { captureException },
      );

      const result = await generate();

      expect(result.isErr()).toBe(true);
      expect(captureException).not.toHaveBeenCalled();
    });

    it("calls captureException for retryable gateway errors", async () => {
      const captureException = vi.fn();
      const gatewayError = new APICallError({
        isRetryable: false, // prevents AI SDK from retrying in test
        message: "Internal server error.",
        requestBodyValues: {},
        responseBody: JSON.stringify({
          error: {
            code: "internal-server-error",
            message: "Internal server error.",
            retryable: true,
          },
        }),
        statusCode: 500,
        url: "https://example.com",
      });
      const { generate } = setupTestWithModel(
        createMockLanguageModelThatThrows(gatewayError),
        { captureException },
      );

      const result = await generate();

      expect(result.isErr()).toBe(true);
      expect(captureException).toHaveBeenCalledOnce();
    });
  });
});
