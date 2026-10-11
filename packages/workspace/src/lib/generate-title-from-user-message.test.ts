import { MAX_TITLE_WORDS } from "@instrument-org/shared";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { generateTitleFromUserMessage } from "./generate-title-from-user-message";
import { TASK_NAME_MAX_OUTPUT_TOKENS } from "./llm-token-limits";
import { getWorkspaceConfig } from "./workspace-config";

function createMockLanguageModel(
  text: string,
  options: { finishReason?: "length" | "stop"; reasoningTokens?: number } = {},
) {
  const finishReason = options.finishReason ?? "stop";
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ text, type: "text" }],
        finishReason: { raw: finishReason, unified: finishReason },
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: undefined,
            total: 10,
          },
          outputTokens: {
            reasoning: options.reasoningTokens,
            text: undefined,
            total: options.reasoningTokens ?? 15,
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
  return new MockLanguageModelV4({
    doGenerate: () => Promise.reject(error),
  });
}

function setupTest(
  generatedText: string,
  options: {
    captureException?: (...args: unknown[]) => void;
    finishReason?: "length" | "stop";
    reasoningTokens?: number;
  } = {},
) {
  const mockLanguageModel = createMockLanguageModel(generatedText, options);
  const model = createMockAIGatewayModel();
  createMockChatConfig(ChatIdSchema.parse("mock"), {
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
    generate: (message: SessionMessage.UserWithParts = mockMessage) =>
      generateTitleFromUserMessage({
        message,
        model,
        workspaceConfig,
      }),
    mockLanguageModel,
  };
}

function setupTestWithModel(
  languageModel: MockLanguageModelV4,
  options: { captureException?: (...args: unknown[]) => void } = {},
) {
  const model = createMockAIGatewayModel();
  createMockChatConfig(ChatIdSchema.parse("mock"), {
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
    generate: (message: SessionMessage.UserWithParts = mockMessage) =>
      generateTitleFromUserMessage({
        message,
        model,
        workspaceConfig,
      }),
  };
}

describe("generateTitleFromUserMessage", () => {
  it("should limit a generated title to the word cap", async () => {
    const { generate } = setupTest(
      "Very Long Task Title That Exceeds The Word Limit By Some Margin",
    );

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(MAX_TITLE_WORDS);
    expect(title).toBe("Very Long Task Title That Exceeds The Word");
  });

  it("should preserve titles within the word cap", async () => {
    const { generate } = setupTest("Todo List Manager");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(3);
    expect(title).toBe("Todo List Manager");
  });

  it("should handle exactly the word cap", async () => {
    const { generate } = setupTest(
      "Chat With File Upload System For Everyone Here",
    );

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(MAX_TITLE_WORDS);
    expect(title).toBe("Chat With File Upload System For Everyone Here");
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

  // The model is told to answer nothing for a message with no subject ("hey",
  // "test"). Failing here is what leaves the placeholder standing, so a task
  // keeps the user's own words instead of an invented title.
  it("fails rather than inventing a title for an unnameable message", async () => {
    const captureException = vi.fn();
    const { generate } = setupTest("", { captureException });

    const result = await generate(createMockMessage("hey"));

    expect(result.isErr()).toBe(true);
    // Typing "hi" to open a task is not an incident. This is the whole reason
    // the outcome is typed rather than thrown as a bare Error.
    expect(captureException).not.toHaveBeenCalled();
    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"Failed to generate title: No title generated"`,
    );
  });

  // Reasoning shares the output budget with the title, and a model that spends
  // all of it thinking returns nothing at all. That reads identically to the
  // case above unless the failure says which one it was.
  it("says the budget ran out when the turn was cut off before any text", async () => {
    const captureException = vi.fn();
    const { generate } = setupTest("", {
      captureException,
      finishReason: "length",
      reasoningTokens: TASK_NAME_MAX_OUTPUT_TOKENS,
    });

    const result = await generate();

    expect(result.isErr()).toBe(true);
    // Unlike the case above, a cut-off turn is a fault worth reporting.
    expect(captureException).toHaveBeenCalledOnce();
    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"Failed to generate title: Output budget spent before any title text"`,
    );
  });

  describe("what the model is shown", () => {
    function messageWithFolders(
      folders = [{ path: `${os.homedir()}/Downloads/Screenshots` }],
    ) {
      const message = createMockMessage("wat images are in here");
      return {
        ...message,
        parts: [
          ...message.parts,
          {
            data: {
              files: [],
              folders,
            },
            metadata: {
              createdAt: new Date(),
              id: StoreId.newPartId(),
              messageId: StoreId.newMessageId(),
              sessionId: StoreId.newSessionId(),
            },
            type: "data-attachments" as const,
          },
        ],
      };
    }

    // The message the model is asked to name, without the system prompt, whose
    // examples are written in the very format these assertions look for.
    async function promptFor(message: SessionMessage.UserWithParts) {
      const { generate, mockLanguageModel } = setupTest("Screenshots");
      await generate(message);
      return JSON.stringify(
        mockLanguageModel.doGenerateCalls[0]?.prompt.filter(
          (entry) => entry.role === "user",
        ),
      );
    }

    // Where a folder lives is what tells two folders of the same name apart, so
    // the path is the useful signal here.
    it("locates a folder mount under a bare home directory", async () => {
      const prompt = await promptFor(messageWithFolders());

      expect(prompt).toContain(
        "Folders attached by user: ~/Downloads/Screenshots",
      );
    });

    // The real path names the machine's user; a title is stored, listed, and
    // exported.
    it("does not show the host path", async () => {
      const prompt = await promptFor(messageWithFolders());

      expect(prompt).not.toContain(os.homedir());
    });
  });

  // A model that thinks in the text rather than in a reasoning part otherwise
  // gets the opening line of its own deliberation stored as the title.
  it.each([
    ["<think>The user attached a folder</think>\nImages in Downloads"],
    ["<thinking>The user attached a folder</thinking>Images in Downloads"],
  ])("drops an inline think block: %s", async (generated) => {
    const { generate } = setupTest(generated);

    const result = await generate();

    expect(result._unsafeUnwrap()).toBe("Images in Downloads");
  });

  // The same block cut off by the output budget leaves no closing tag, and
  // everything after the opening one is thinking.
  it("fails rather than titling a task with unterminated thinking", async () => {
    const { generate } = setupTest("<think>The user attached a folder of");

    const result = await generate();

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain(
      "Nothing left after cleaning",
    );
  });

  it("should trim whitespace from generated title", async () => {
    const { generate } = setupTest("  Todo Manager  ");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title).toBe("Todo Manager");
  });

  it("should handle non-English characters", async () => {
    const { generate } = setupTest("تطبيق المهام اليومية");

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title).toBe("تطبيق المهام اليومية");
  });

  it("should limit non-English titles to the word cap", async () => {
    const { generate } = setupTest(
      "システム 管理 アプリケーション データベース 設定 追加 画面 一覧 更新",
    );

    const result = await generate();
    const title = result._unsafeUnwrap();

    expect(title.split(" ")).toHaveLength(MAX_TITLE_WORDS);
    expect(title).toBe(
      "システム 管理 アプリケーション データベース 設定 追加 画面 一覧",
    );
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

describe("generateTitleFromUserMessage with a current title", () => {
  async function callWith(currentTitle?: string) {
    const mockLanguageModel = createMockLanguageModel("Lentil soup for dinner");
    const model = createMockAIGatewayModel();
    createMockChatConfig(ChatIdSchema.parse("mock"), {
      aiSDKModel: mockLanguageModel,
      model,
    });
    await generateTitleFromUserMessage({
      currentTitle,
      message: createMockMessage("what should I make for dinner"),
      model,
      reply: "Here is a lentil soup recipe.",
      workspaceConfig: getWorkspaceConfig(),
    });
    const prompt = mockLanguageModel.doGenerateCalls[0]?.prompt ?? [];
    const system = prompt.find((entry) => entry.role === "system");
    return {
      system: system?.role === "system" ? system.content : "",
      user: JSON.stringify(prompt.filter((entry) => entry.role === "user")),
    };
  }

  // Each call words the same subject its own way, so a chat renamed from
  // scratch on every call would never hold a name.
  it("hands the model the title and asks it to keep it", async () => {
    const { system, user } = await callWith("Dinner ideas with lentils");

    expect(user).toContain("Current title: Dinner ideas with lentils");
    expect(system).toContain("<current_title>");
  });

  it("says nothing about keeping a title when there is none", async () => {
    const { system, user } = await callWith();

    expect(user).not.toContain("Current title:");
    expect(system).not.toContain("<current_title>");
  });
});
