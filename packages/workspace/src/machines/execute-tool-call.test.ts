import mockFs from "mock-fs";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";

import { UNTITLED_CHAT_TITLE } from "../constants";
import { ChatReads } from "../lib/chat-reads";
import { ChatWrites } from "../lib/chat-writes";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockChatConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-chat-config";
import {
  executeToolCallMachine,
  saveStoppedToolCallPart,
} from "./execute-tool-call";

vi.mock(import("ulid"));
vi.mock(import("../lib/get-current-date"));
vi.mock(import("../lib/execa-node-for-chat"), () => ({
  execaNodeForChat: vi.fn(),
}));

interface MockExecResult {
  all: string;
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * execa returns a subprocess that is both awaitable and able to hand out a
 * second reader of its merged output, and it returns it synchronously.
 * `runPnpmCommand` takes that reader so a background run can follow the output
 * live, so the mock has to be both things -- and must not be wrapped in an extra
 * promise, which would hide `readable`.
 */
function mockSubprocess(outcome: Promise<MockExecResult>, all: string) {
  return Object.assign(outcome, { readable: () => Readable.from([all]) });
}

describe("executeToolCallMachine", () => {
  const model = createMockAIGatewayModel();
  const taskConfig = createMockChatConfig(ChatIdSchema.parse("test"), {
    model,
  });
  // A session of each case's own: the chat's records are folded in memory for
  // the whole file, so a session two cases shared would carry the first
  // case's calls into the second.
  let sessionId = StoreId.newSessionId();
  let messageId = StoreId.newMessageId();
  const mockDate = new Date("2025-01-01T00:00:00.000Z");

  beforeEach(async () => {
    sessionId = StoreId.newSessionId();
    messageId = StoreId.newMessageId();

    // Pin performance.now so the bash tool's `durationMs` is deterministic in
    // snapshots. Returning a constant means `end - start === 0`.
    vi.spyOn(performance, "now").mockReturnValue(0);

    const { execaNodeForChat: execaElectronNode } =
      await import("../lib/execa-node-for-chat");
    const mockResult: MockExecResult = {
      all: "mocked all",
      exitCode: 0,
      stderr: "mocked stderr",
      stdout: "mocked stdout",
    };
    vi.mocked(execaElectronNode).mockImplementation(
      (_taskConfig, file, args, _options) => {
        const command = [file, ...(args ?? [])].join(" ");

        if (command.includes("throw-error")) {
          // A spawn failure surfaces as the subprocess promise rejecting.
          return mockSubprocess(
            Promise.reject(new Error("Shell command failed")),
            "",
          );
        }

        return mockSubprocess(Promise.resolve(mockResult), mockResult.all);
      },
    );

    mockFs({
      [MOCK_WORKSPACE_DIRS.chats]: { [taskConfig]: {} },
      [MOCK_WORKSPACE_DIRS.work]: {
        [taskConfig]: {
          "nonexistent.js": "",
          "test.txt": "Hello, world!",
        },
      },
    });

    await ChatWrites.saveSession(
      {
        createdAt: mockDate,
        id: sessionId,
        title: UNTITLED_CHAT_TITLE,
      },
      taskConfig,
    );

    await ChatWrites.saveMessage(
      {
        id: messageId,
        metadata: {
          createdAt: mockDate,
          finishReason: "stop",
          modelId: "mock-model-id",
          providerId: "mock-provider-id",
          sessionId,
        },
        role: "assistant",
      },
      taskConfig,
    );
  });

  afterEach(() => {
    mockFs.restore();
    vi.clearAllMocks();
  });

  function createTestActor({
    part,
  }: {
    part: SessionMessagePart.ToolPartInputAvailable;
  }) {
    const actor = createActor(executeToolCallMachine, {
      input: {
        model,
        part,
        sessionId,
        chatId: taskConfig,
      },
    });

    return actor;
  }

  async function readStoredPart(partId: StoreId.Part) {
    const session = await ChatReads.sessionWithMessages({
      chatId: taskConfig,
      sessionId,
    });
    return session
      ._unsafeUnwrap()
      .messages.flatMap((message) => message.parts)
      .find((part) => part.metadata.id === partId);
  }

  /** Saves the call, runs it to its end, and reads back what it stored. */
  async function runToStoredPart(
    part: SessionMessagePart.ToolPartInputAvailable,
  ) {
    await ChatWrites.savePart(part, taskConfig);
    const actor = createTestActor({ part });
    actor.start();
    await waitFor(actor, (state) => state.status === "done");
    return readStoredPart(part.metadata.id);
  }

  function createShellCommandPart(
    command: string,
  ): SessionMessagePart.ToolPartInputAvailable {
    return {
      input: {
        command,
        explanation: "Installing packages",
        yieldMs: 1000,
      },
      metadata: {
        createdAt: mockDate,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      state: "input-available",
      toolCallId: StoreId.ToolCallSchema.parse("test_tool_call_1"),
      type: "tool-bash",
    };
  }

  it("stores a shell command's output", async () => {
    const updatedPart = await runToStoredPart(
      createShellCommandPart("pnpm install"),
    );

    expect(updatedPart).toMatchInlineSnapshot(`
      {
        "input": {
          "command": "pnpm install",
          "explanation": "Installing packages",
          "yieldMs": 1000,
        },
        "metadata": {
          "createdAt": 2025-01-01T00:00:00.000Z,
          "endedAt": 2013-08-31T12:00:07.000Z,
          "id": "prt_00000000Z8888888888888888A",
          "messageId": "msg_00000000Z88888888888888889",
          "sessionId": "ses_00000000Z88888888888888888",
          "startedAt": 2013-08-31T12:00:04.000Z,
        },
        "output": {
          "command": "pnpm install",
          "commands": [
            "pnpm",
          ],
          "durationMs": 0,
          "exitCode": 0,
          "omittedBytes": 0,
          "output": "mocked stdout
      mocked stderr",
          "ran": [
            {
              "count": 1,
              "name": "pnpm",
              "source": "bundled",
            },
          ],
        },
        "preliminary": false,
        "state": "output-available",
        "toolCallId": "test_tool_call_1",
        "type": "tool-bash",
      }
    `);
  });

  it("stores a shell command that failed to start as a failed run", async () => {
    const updatedPart = await runToStoredPart(
      createShellCommandPart("pnpm throw-error"),
    );

    expect(updatedPart).toMatchInlineSnapshot(`
      {
        "input": {
          "command": "pnpm throw-error",
          "explanation": "Installing packages",
          "yieldMs": 1000,
        },
        "metadata": {
          "createdAt": 2025-01-01T00:00:00.000Z,
          "endedAt": 2013-08-31T12:00:06.000Z,
          "id": "prt_00000000Z9888888888888888A",
          "messageId": "msg_00000000Z98888888888888889",
          "sessionId": "ses_00000000Z98888888888888888",
          "startedAt": 2013-08-31T12:00:03.000Z,
        },
        "output": {
          "command": "pnpm throw-error",
          "commands": [
            "pnpm",
          ],
          "durationMs": 0,
          "exitCode": 1,
          "omittedBytes": 0,
          "output": "pnpm: Shell command failed
      ",
          "ran": [
            {
              "count": 1,
              "name": "pnpm",
              "source": "bundled",
            },
          ],
        },
        "preliminary": false,
        "state": "output-available",
        "toolCallId": "test_tool_call_1",
        "type": "tool-bash",
      }
    `);
  });

  it("stores a file it read", async () => {
    const updatedPart = await runToStoredPart({
      input: {
        explanation: "Reading test file",
        filePath: "test.txt",
      },
      metadata: {
        createdAt: mockDate,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      state: "input-available",
      toolCallId: StoreId.ToolCallSchema.parse("test_tool_call_2"),
      type: "tool-read_file",
    });

    if (
      updatedPart?.type !== "tool-read_file" ||
      updatedPart.state !== "output-available" ||
      updatedPart.output.state !== "exists"
    ) {
      throw new Error(
        `Expected the file's contents, got ${JSON.stringify(updatedPart)}`,
      );
    }

    const { modifiedAt, ...outputWithoutModifiedAt } = updatedPart.output;
    expect(modifiedAt).toEqual(expect.any(Number));

    expect({
      ...updatedPart,
      output: outputWithoutModifiedAt,
    }).toMatchInlineSnapshot(`
      {
        "input": {
          "explanation": "Reading test file",
          "filePath": "test.txt",
        },
        "metadata": {
          "createdAt": 2025-01-01T00:00:00.000Z,
          "endedAt": 2013-08-31T12:00:05.000Z,
          "id": "prt_00000000ZA888888888888888A",
          "messageId": "msg_00000000ZA8888888888888889",
          "sessionId": "ses_00000000ZA8888888888888888",
          "startedAt": 2013-08-31T12:00:03.000Z,
        },
        "output": {
          "content": "Hello, world!",
          "displayedLines": 1,
          "filePath": "./test.txt",
          "hasMoreLines": false,
          "offset": 1,
          "state": "exists",
          "totalLines": 1,
          "truncatedByBytes": false,
        },
        "preliminary": false,
        "state": "output-available",
        "toolCallId": "test_tool_call_2",
        "type": "tool-read_file",
      }
    `);
  });

  it("stores a file that is not there as not found, with its near names", async () => {
    const updatedPart = await runToStoredPart({
      input: {
        explanation: "Reading nonexistent file",
        filePath: "nonexistent.txt",
      },
      metadata: {
        createdAt: mockDate,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      state: "input-available",
      toolCallId: StoreId.ToolCallSchema.parse("test_tool_call_3"),
      type: "tool-read_file",
    });

    expect(updatedPart).toMatchInlineSnapshot(`
      {
        "input": {
          "explanation": "Reading nonexistent file",
          "filePath": "nonexistent.txt",
        },
        "metadata": {
          "createdAt": 2025-01-01T00:00:00.000Z,
          "endedAt": 2013-08-31T12:00:05.000Z,
          "id": "prt_00000000ZB888888888888888A",
          "messageId": "msg_00000000ZB8888888888888889",
          "sessionId": "ses_00000000ZB8888888888888888",
          "startedAt": 2013-08-31T12:00:03.000Z,
        },
        "output": {
          "filePath": "./nonexistent.txt",
          "state": "does-not-exist",
          "suggestions": [
            "nonexistent.js",
          ],
        },
        "preliminary": false,
        "state": "output-available",
        "toolCallId": "test_tool_call_3",
        "type": "tool-read_file",
      }
    `);
  });

  // The stop record is for a call that will never answer. Two writers can reach
  // one part when a tool finishes as the user stops, or as the finishing sweep
  // scans, and the answer has to win: a real output replaced by an account of
  // the stop is a result the model and the reader both lose.
  describe("saveStoppedToolCallPart", () => {
    it("finalizes a call that never produced output", async () => {
      const part = createShellCommandPart("sleep 30");
      await ChatWrites.savePart(part, taskConfig);

      await saveStoppedToolCallPart({
        part,
        reason: "manual",
        chatId: taskConfig,
      });

      const stored = await readStoredPart(part.metadata.id);
      expect(stored).toMatchObject({
        errorText: "This action was stopped by you.",
        state: "output-error",
      });
      expect(stored?.metadata).not.toHaveProperty("stoppedBy");
    });

    // The person reads the same words either way; the model is told which.
    it("keeps that the chat's `instrument task stop` was what stopped a call", async () => {
      const part = createShellCommandPart("sleep 30");
      await ChatWrites.savePart(part, taskConfig);

      await saveStoppedToolCallPart({
        part,
        reason: "chat",
        chatId: taskConfig,
      });

      const stored = await readStoredPart(part.metadata.id);
      expect(stored).toMatchObject({
        errorText: "This action was stopped by you.",
        state: "output-error",
      });
      expect(stored?.metadata).toMatchObject({ stoppedBy: "agent" });
    });

    it("leaves a call that answered first exactly as it answered", async () => {
      const part = createShellCommandPart("echo hi");
      // The part union is discriminated by tool type as well as by state, so
      // an answered bash call is built here rather than spread from the
      // pending one, whose state this fixture is replacing.
      const answered = {
        ...part,
        output: {
          command: "echo hi",
          commands: ["echo"],
          durationMs: 0,
          exitCode: 0,
          output: "hi",
          spillFilePath: undefined,
        },
        preliminary: false,
        state: "output-available",
      } as SessionMessagePart.ToolPart;
      await ChatWrites.savePart(answered, taskConfig);

      // The stale input-available snapshot a scan would still be holding.
      await saveStoppedToolCallPart({
        part,
        reason: "manual",
        chatId: taskConfig,
      });

      const stored = await readStoredPart(part.metadata.id);
      expect(stored).toMatchObject({ state: "output-available" });
      expect(stored).not.toHaveProperty("errorText");
    });

    // A preliminary output lives only in the turn's memory, so the record
    // under it still waits on an answer the stop says will never come.
    it("finalizes a call that had only offered a preliminary output", async () => {
      const part = createShellCommandPart("sleep 30");
      await ChatWrites.savePart(part, taskConfig);
      (
        await ChatWrites.updatePart(
          {
            chatId: taskConfig,
            messageId: part.metadata.messageId,
            partId: part.metadata.id,
            sessionId,
          },
          () =>
            ({
              ...part,
              output: {
                command: "sleep 30",
                commands: ["sleep"],
                durationMs: 0,
                exitCode: 0,
                output: "",
                spillFilePath: undefined,
              },
              preliminary: true,
              state: "output-available",
            }) as SessionMessagePart.ToolPart,
        )
      )._unsafeUnwrap();

      await saveStoppedToolCallPart({
        part,
        reason: "manual",
        chatId: taskConfig,
      });
      await ChatWrites.landed(taskConfig);

      const stored = await readStoredPart(part.metadata.id);
      expect(stored).toMatchObject({
        errorText: "This action was stopped by you.",
        state: "output-error",
      });
      expect(stored).not.toHaveProperty("output");
      expect(stored).not.toHaveProperty("preliminary", true);
    });
  });
});
