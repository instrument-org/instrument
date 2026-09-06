import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { shouldContinueAfterHandingOff } from "./instrument";

const sessionId = StoreId.newSessionId();
const createdAt = new Date("2026-01-01T00:00:00.000Z");

function assistant(
  ...parts: ((messageId: StoreId.Message) => SessionMessagePart.Type)[]
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt,
      finishReason: "stop",
      modelId: "mock-model",
      providerId: "instrument",
      sessionId,
    },
    parts: parts.map((part) => part(id)),
    role: "assistant",
  };
}

function partMetadata(messageId: StoreId.Message) {
  return { createdAt, id: StoreId.newPartId(), messageId, sessionId };
}

function user(
  ...parts: ((messageId: StoreId.Message) => SessionMessagePart.Type)[]
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: { createdAt, sessionId },
    parts: parts.map((part) => part(id)),
    role: "user",
  };
}

const text =
  (value: string) =>
  (messageId: StoreId.Message): SessionMessagePart.Type => ({
    metadata: partMetadata(messageId),
    state: "done",
    text: value,
    type: "text",
  });

const bash =
  (command: string, output: string) =>
  (messageId: StoreId.Message): SessionMessagePart.Type => ({
    input: { command, explanation: "Running", yieldMs: 1000 },
    metadata: { ...partMetadata(messageId), endedAt: createdAt },
    output: {
      command,
      commands: [command.split(" ")[0] ?? command],
      durationMs: 0,
      exitCode: 0,
      omittedBytes: 0,
      output,
    },
    state: "output-available",
    toolCallId: `call-${messageId}`,
    type: "tool-bash",
  });

const wake = (messageId: StoreId.Message): SessionMessagePart.Type => ({
  data: {
    events: [
      {
        status: "done",
        taskId: TaskIdSchema.parse("lisbon-hotel"),
        title: "Lisbon hotel",
      },
    ],
  },
  metadata: partMetadata(messageId),
  type: "data-taskEvent",
});

const taskNew = bash(
  "task new --name 'Lisbon' <<'EOF'\nFind a hotel.\nEOF",
  'Created lisbon-hotel ("Lisbon"). It is running now.\n',
);

describe("shouldContinueAfterHandingOff", () => {
  it("ends the turn once a task was made and a line was said", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("find me a hotel in lisbon")),
          assistant(text("Looking for one."), taskNew),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("gives a hand-off that said nothing one more step, for the line", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [user(text("find me a hotel in lisbon")), assistant(taskNew)],
      }),
    ).resolves.toBe(true);
  });

  it("treats a task send the same as a task new", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("make it about a submarine")),
          assistant(
            text("Steering it."),
            bash(
              "task send lisbon-hotel <<'EOF'\nA submarine.\nEOF",
              "Sent to lisbon-hotel. It is busy and will hear this at its next step.\n",
            ),
          ),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("gives a first step that only promised a task one more step, so the task gets made", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("find me a hotel in lisbon")),
          assistant(text("I'll hand this to a task.")),
        ],
      }),
    ).resolves.toBe(true);
  });

  it("does not read a mention of tasks as a promise", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("what are you working on?")),
          assistant(text("One task is looking for a hotel; nothing else.")),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("does not give a wake's one-line reply a second step for naming the task", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("find me a hotel in lisbon")),
          assistant(text("Looking for one."), taskNew),
          user(wake),
          assistant(
            text(
              "The task found the Hotel Avenida; I'll send a task for the booking next.",
            ),
          ),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("carries on as any agent would when nothing was handed off", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("what is in my downloads?")),
          assistant(bash("ls /mnt/Home/Downloads", "a.pdf\nb.pdf\n")),
        ],
      }),
    ).resolves.toBe(true);
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("what is in my downloads?")),
          assistant(bash("ls /mnt/Home/Downloads", "a.pdf\nb.pdf\n")),
          assistant(text("Two PDFs.")),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("only counts a hand-off that the command reported", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("find me a hotel in lisbon")),
          assistant(
            text("On it."),
            bash("task new", "task: new: a brief is required"),
          ),
        ],
      }),
    ).resolves.toBe(true);
  });
});
