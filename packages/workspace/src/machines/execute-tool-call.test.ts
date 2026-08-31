import mockFs from "mock-fs";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";

import { Store } from "../lib/store";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockTaskConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-task-config";
import { executeToolCallMachine } from "./execute-tool-call";

vi.mock(import("ulid"));
vi.mock(import("../lib/session-store-storage"));
vi.mock(import("../lib/get-current-date"));
vi.mock(import("../lib/execa-node-for-task"), () => ({
  execaNodeForTask: vi.fn(),
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
  const taskConfig = createMockTaskConfig(TaskIdSchema.parse("test"), {
    model,
  });
  const sessionId = StoreId.newSessionId();
  const messageId = StoreId.newMessageId();
  const mockDate = new Date("2025-01-01T00:00:00.000Z");

  beforeEach(async () => {
    // Pin performance.now so the bash tool's `durationMs` is deterministic in
    // snapshots. Returning a constant means `end - start === 0`.
    vi.spyOn(performance, "now").mockReturnValue(0);

    const { execaNodeForTask: execaElectronNode } =
      await import("../lib/execa-node-for-task");
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

        if (command.includes("hang-command")) {
          return mockSubprocess(
            new Promise((resolve) => {
              setTimeout(() => {
                resolve(mockResult);
              }, 100);
            }),
            mockResult.all,
          );
        }

        return mockSubprocess(Promise.resolve(mockResult), mockResult.all);
      },
    );

    mockFs({
      [MOCK_WORKSPACE_DIRS.tasks]: {
        [taskConfig]: {
          "nonexistent.js": "",
          "package.json": "{}",
          "test.txt": "Hello, world!",
        },
      },
    });

    await Store.saveSession(
      {
        createdAt: mockDate,
        id: sessionId,
        title: "Test session",
      },
      taskConfig,
    );

    await Store.saveMessage(
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
        agentName: "main",
        model,
        part,
        sessionId,
        spawnAgent: vi.fn(),
        taskId: taskConfig,
      },
    });

    return actor;
  }

  async function runTestMachine(actor: ReturnType<typeof createTestActor>) {
    actor.start();
    await waitFor(actor, (state) => state.status === "done");
    const sessionResult = await Store.getSessionWithMessagesAndParts(
      sessionId,
      taskConfig,
    );
    return sessionResult._unsafeUnwrap();
  }

  function createShellCommandPart(
    command: string,
    yieldMs = 1000,
  ): SessionMessagePart.ToolPartInputAvailable {
    return {
      input: {
        command,
        explanation: "Installing packages",
        yieldMs,
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

  describe("with successful shell command", () => {
    it("should execute shell command successfully", async () => {
      const part = createShellCommandPart("pnpm install");
      await Store.savePart(part, taskConfig);

      const actor = createTestActor({ part });
      await runTestMachine(actor);

      // Verify the part was updated with output
      const updatedSession = await Store.getSessionWithMessagesAndParts(
        sessionId,
        taskConfig,
      );
      const session = updatedSession._unsafeUnwrap();
      const updatedPart = session.messages
        .flatMap((m) => m.parts)
        .find(
          (p) => p.type === "tool-bash" && p.toolCallId === "test_tool_call_1",
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
            "endedAt": 2013-08-31T12:00:02.000Z,
            "id": "prt_00000000Z88888888888888888",
            "messageId": "msg_00000000018888888888888889",
            "sessionId": "ses_00000000018888888888888888",
            "startedAt": 2013-08-31T12:00:00.000Z,
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
            "spillFilePath": undefined,
          },
          "preliminary": false,
          "state": "output-available",
          "toolCallId": "test_tool_call_1",
          "type": "tool-bash",
        }
      `);
    });
  });

  describe("with shell command that throws", () => {
    it("should handle shell command errors", async () => {
      const part = createShellCommandPart("pnpm throw-error");
      await Store.savePart(part, taskConfig);

      const actor = createTestActor({ part });
      await runTestMachine(actor);

      // Verify the part was updated with error
      const updatedSession = await Store.getSessionWithMessagesAndParts(
        sessionId,
        taskConfig,
      );
      const session = updatedSession._unsafeUnwrap();
      const updatedPart = session.messages
        .flatMap((m) => m.parts)
        .find(
          (p) => p.type === "tool-bash" && p.toolCallId === "test_tool_call_1",
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
            "endedAt": 2013-08-31T12:00:02.000Z,
            "id": "prt_00000000Z98888888888888888",
            "messageId": "msg_00000000018888888888888889",
            "sessionId": "ses_00000000018888888888888888",
            "startedAt": 2013-08-31T12:00:00.000Z,
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
            "spillFilePath": undefined,
          },
          "preliminary": false,
          "state": "output-available",
          "toolCallId": "test_tool_call_1",
          "type": "tool-bash",
        }
      `);
    });
  });

  describe("with hanging shell command", () => {
    it("should handle hanging shell command", async () => {
      const part = createShellCommandPart("pnpm hang-command", 10); // Very short timeout to trigger cancellation
      await Store.savePart(part, taskConfig);

      const actor = createTestActor({ part });
      await runTestMachine(actor);

      // Verify the part was updated with cancellation
      const updatedSession = await Store.getSessionWithMessagesAndParts(
        sessionId,
        taskConfig,
      );
      const session = updatedSession._unsafeUnwrap();
      const updatedPart = session.messages
        .flatMap((m) => m.parts)
        .find(
          (p) => p.type === "tool-bash" && p.toolCallId === "test_tool_call_1",
        );

      expect(updatedPart).toMatchInlineSnapshot(`
        {
          "input": {
            "command": "pnpm hang-command",
            "explanation": "Installing packages",
            "yieldMs": 10,
          },
          "metadata": {
            "createdAt": 2025-01-01T00:00:00.000Z,
            "endedAt": 2013-08-31T12:00:02.000Z,
            "id": "prt_00000000ZA8888888888888888",
            "messageId": "msg_00000000018888888888888889",
            "sessionId": "ses_00000000018888888888888888",
            "startedAt": 2013-08-31T12:00:00.000Z,
          },
          "output": {
            "command": "pnpm hang-command",
            "commands": [
              "pnpm",
            ],
            "durationMs": 0,
            "exitCode": 0,
            "omittedBytes": 0,
            "output": "mocked stdout
        mocked stderr",
            "spillFilePath": undefined,
          },
          "preliminary": false,
          "state": "output-available",
          "toolCallId": "test_tool_call_1",
          "type": "tool-bash",
        }
      `);
    });
  });

  describe("with read file tool", () => {
    it("should execute read file successfully", async () => {
      const part: SessionMessagePart.ToolPartInputAvailable = {
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
      };

      await Store.savePart(part, taskConfig);

      const actor = createTestActor({ part });
      await runTestMachine(actor);

      // Verify the part was updated with output
      const updatedSession = await Store.getSessionWithMessagesAndParts(
        sessionId,
        taskConfig,
      );
      const session = updatedSession._unsafeUnwrap();
      const updatedPart = session.messages
        .flatMap((m) => m.parts)
        .find(
          (p) =>
            p.type === "tool-read_file" && p.toolCallId === "test_tool_call_2",
        );

      expect(updatedPart?.type).toBe("tool-read_file");
      if (
        updatedPart?.type !== "tool-read_file" ||
        updatedPart.state !== "output-available" ||
        updatedPart.output.state !== "exists"
      ) {
        return;
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
            "endedAt": 2013-08-31T12:00:01.000Z,
            "id": "prt_00000000ZB8888888888888888",
            "messageId": "msg_00000000018888888888888889",
            "sessionId": "ses_00000000018888888888888888",
            "startedAt": 2013-08-31T12:00:00.000Z,
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

    it("should handle file not found", async () => {
      const part: SessionMessagePart.ToolPartInputAvailable = {
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
      };

      await Store.savePart(part, taskConfig);

      const actor = createTestActor({ part });
      await runTestMachine(actor);

      // Verify the part was updated with "not found" output (not error)
      const updatedSession = await Store.getSessionWithMessagesAndParts(
        sessionId,
        taskConfig,
      );
      const session = updatedSession._unsafeUnwrap();
      const updatedPart = session.messages
        .flatMap((m) => m.parts)
        .find(
          (p) =>
            p.type === "tool-read_file" && p.toolCallId === "test_tool_call_3",
        );

      expect(updatedPart).toMatchInlineSnapshot(`
        {
          "input": {
            "explanation": "Reading nonexistent file",
            "filePath": "nonexistent.txt",
          },
          "metadata": {
            "createdAt": 2025-01-01T00:00:00.000Z,
            "endedAt": 2013-08-31T12:00:01.000Z,
            "id": "prt_00000000ZC8888888888888888",
            "messageId": "msg_00000000018888888888888889",
            "sessionId": "ses_00000000018888888888888888",
            "startedAt": 2013-08-31T12:00:00.000Z,
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
  });

  describe("with pnpm dev and start", () => {
    async function runShellCommand(command: string) {
      const requestPart = createShellCommandPart(command);
      await Store.savePart(requestPart, taskConfig);
      const actor = createTestActor({ part: requestPart });
      await runTestMachine(actor);
      const sessionResult = await Store.getSessionWithMessagesAndParts(
        sessionId,
        taskConfig,
      );
      const session = sessionResult._unsafeUnwrap();
      const part = session.messages
        .flatMap((m) => m.parts)
        .find(
          (p) => p.type === "tool-bash" && p.toolCallId === "test_tool_call_1",
        );
      if (part?.type !== "tool-bash") {
        throw new Error(`No bash part recorded for "${command}"`);
      }
      return part;
    }

    // These were refused while the runtime was the only thing allowed to serve an
    // app. A long-running command is now a background process instead, so there
    // is nothing to refuse.
    it.each(["pnpm dev", "pnpm run dev", "pnpm start", "pnpm run start"])(
      "runs %s instead of refusing it",
      async (command) => {
        const part = await runShellCommand(command);
        if (part.state !== "output-available") {
          throw new Error(`Expected output, got state "${part.state}"`);
        }
        expect(part.output).toMatchObject({
          exitCode: 0,
          output: "mocked stdout\nmocked stderr",
        });
      },
    );
  });
});
