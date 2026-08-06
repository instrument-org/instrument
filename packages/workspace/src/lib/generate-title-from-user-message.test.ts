import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import {
  generateTitleFromUserMessage,
  MAX_TITLE_WORDS,
} from "./generate-title-from-user-message";
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
    const { generate } = setupTest("");

    const result = await generate(createMockMessage("hey"));

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"Failed to generate title: No title generated"`,
    );
  });

  describe("what the model is shown", () => {
    function folderAttachment(
      name: string,
      source: FolderAttachment.Source,
    ): FolderAttachment.Type {
      return {
        access: "read-write",
        createdAt: 0,
        id: FolderAttachment.IdSchema.parse(name),
        mountName: `Home-${name}`,
        path: AbsolutePathSchema.parse(`${os.homedir()}/Downloads/${name}`),
        source,
      };
    }

    function messageWithFolders(
      folders: FolderAttachment.Type[] = [
        folderAttachment("Screenshots", "user"),
      ],
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
    it("locates an attached folder under a bare home directory", async () => {
      const prompt = await promptFor(messageWithFolders());

      expect(prompt).toContain(
        "Folders attached by user: ~/Downloads/Screenshots",
      );
    });

    // The mount name is the agent's handle for the folder and the real path
    // names the machine's user; a title is stored, listed, and exported.
    it("shows neither the mount name nor the host path", async () => {
      const prompt = await promptFor(messageWithFolders());

      expect(prompt).not.toContain("Home-Screenshots");
      expect(prompt).not.toContain(os.homedir());
    });

    // A project's folders arrive on the first message of every task in the
    // project, so they name the neighbors rather than this one.
    it("shows the user's folders and not the project's", async () => {
      const prompt = await promptFor(
        messageWithFolders([
          folderAttachment("Screenshots", "user"),
          folderAttachment("Brand Assets", "project"),
        ]),
      );

      expect(prompt).toContain(
        "Folders attached by user: ~/Downloads/Screenshots",
      );
      expect(prompt).not.toContain("Brand Assets");
    });

    // Every folder on the message can be the project's, leaving a heading with
    // nothing under it.
    it("omits the folder line when only the project's folders are attached", async () => {
      const prompt = await promptFor(
        messageWithFolders([folderAttachment("Brand Assets", "project")]),
      );

      expect(prompt).not.toContain("Folders attached by user");
    });
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
