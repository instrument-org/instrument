import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { Store } from "../store";
import { taskStanding } from "./standing";

vi.mock(import("../session-store-storage"));

let counter = 0;
const freshChat = () =>
  createMockChatConfig(
    ChatIdSchema.parse(`standing-${Date.now()}-${(counter += 1)}`),
  );

interface PartIds {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}

function assistant(
  sessionId: StoreId.Session,
  parts: ((ids: PartIds) => SessionMessage.WithParts["parts"][number])[],
  metadata: Partial<SessionMessage.Assistant["metadata"]> = {},
): SessionMessage.AssistantWithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: {
      createdAt: new Date(),
      finishReason: "stop",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
      ...metadata,
    },
    parts: parts.map((part) => part({ messageId, sessionId })),
    role: "assistant",
  };
}

const partMetadata = (ids: PartIds) => ({
  createdAt: new Date(),
  id: StoreId.newPartId(),
  ...ids,
});

/** A finished call labeled with the work the agent was in the middle of. */
const activity =
  (explanation: string) =>
  (ids: PartIds): SessionMessage.WithParts["parts"][number] => ({
    input: { explanation, reason: "Your Desktop." },
    metadata: { ...partMetadata(ids), endedAt: new Date() },
    output: { status: "declined" },
    state: "output-available",
    toolCallId: `call_${explanation}`,
    type: "tool-request_folder",
  });

async function withSession(chatId: ReturnType<typeof freshChat>) {
  const sessionId = StoreId.newSessionId();
  await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title: "task" },
    chatId,
  );
  return sessionId;
}

describe("taskStanding", () => {
  it("says what a finished task said, in one line", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(sessionId, [
        (ids) => ({
          metadata: partMetadata(ids),
          text: "Done: 52 posts, ads skipped.\nThe file is in your folder.",
          type: "text",
        }),
      ]),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toEqual({
      kind: "done",
      line: "Done: 52 posts, ads skipped.",
    });
  });

  it("names what a finished task wrote when its reply was only the files it handed over", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(sessionId, [
        (ids) => ({
          metadata: partMetadata(ids),
          text: "```files\n/mnt/Instrument/quotes/compared.html\n```",
          type: "text",
        }),
      ]),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toEqual({ kind: "done", line: "Wrote compared.html" });
  });

  it("reads a reply past the files it opens with, and cuts the line after that", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    const words = "The second quote is cheaper once delivery is in.".repeat(3);
    await Store.saveMessageWithParts(
      assistant(sessionId, [
        (ids) => ({
          metadata: partMetadata(ids),
          text: `\`\`\`files\n/mnt/Instrument/quotes/compared.html\n\`\`\`\n\n${words}`,
          type: "text",
        }),
      ]),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing.line).toBe(`${words.slice(0, 90)}…`);
  });

  it("says what a task is waiting for when its turn ended on an ask", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(sessionId, [
        (ids) => ({
          input: { reason: "So I can read your issues.", slug: "linear" },
          metadata: partMetadata(ids),
          state: "input-available",
          toolCallId: "call_1",
          type: "tool-connect_app",
        }),
      ]),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toEqual({
      kind: "waiting",
      line: "Waiting for you to sign in",
    });
  });

  it("says what a task stopped in the middle of when the stop cut its reply off", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(sessionId, [activity("Locating any bundled QuickJS runtime")], {
        finishReason: "tool-calls",
      }),
      chatId,
    );
    // The message the model was streaming when the stop landed: a step and
    // nothing after it.
    await Store.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            metadata: { ...partMetadata(ids), stepCount: 12 },
            type: "step-start",
          }),
        ],
        {
          error: { kind: "aborted", message: "Aborted" },
          finishReason: "aborted",
        },
      ),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toEqual({
      kind: "done",
      line: "Stopped while locating any bundled QuickJS runtime",
    });
  });

  it("says what a task stopped in the middle of when the stop landed on a tool call", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            errorText: "This action was stopped by you.",
            input: {
              command: "cp -R repo copy",
              explanation: "Completing repository copy",
              yieldMs: 30_000,
            },
            metadata: { ...partMetadata(ids), endedAt: new Date() },
            state: "output-error",
            toolCallId: "call_1",
            type: "tool-bash",
          }),
        ],
        { finishReason: "tool-calls" },
      ),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing.line).toBe("Stopped while completing repository copy");
  });

  it("keeps the case of a step that opens on an acronym", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(sessionId, [activity("PDF export of the report")], {
        error: { kind: "aborted", message: "Aborted" },
        finishReason: "aborted",
      }),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing.line).toBe("Stopped while PDF export of the report");
  });

  it("says a task stopped when nothing says what it was doing", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(sessionId, [], {
        error: { kind: "aborted", message: "Aborted" },
        finishReason: "aborted",
      }),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toEqual({ kind: "done", line: "Stopped" });
  });

  it("names a model error in the words the transcript uses", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(sessionId, [activity("Reading the brief")], {
        error: {
          classification: "rate-limit",
          kind: "unknown",
          message: "429 upstream rate limit",
        },
        finishReason: "error",
      }),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toEqual({ kind: "failed", line: "Model is busy" });
  });

  it("names the step limit a task ran into", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            data: { maxStepCount: 200 },
            metadata: partMetadata(ids),
            type: "data-maxSteps",
          }),
        ],
        {
          finishReason: "max-steps",
          modelId: "synthetic",
          providerId: "system",
          synthetic: true,
        },
      ),
      chatId,
    );

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toEqual({
      kind: "done",
      line: "Stopped at the 200-step limit",
    });
  });

  it("says the step while it runs", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);

    const standing = await taskStanding({ isRunning: true, sessionId, chatId });

    expect(standing.kind).toBe("running");
    expect(standing.line).toBe("Working");
  });

  it("says what a task at work has stopped to ask, rather than its step", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await Store.saveMessageWithParts(
      assistant(
        sessionId,
        [
          activity("Picking a store"),
          (ids) => ({
            input: { choices: ["Costco", "Trader Joe's"], question: "Which?" },
            metadata: partMetadata(ids),
            state: "input-available",
            toolCallId: "call_choose",
            type: "tool-choose",
          }),
        ],
        { finishReason: "tool-calls" },
      ),
      chatId,
    );

    const standing = await taskStanding({ isRunning: true, sessionId, chatId });

    expect(standing).toEqual({
      kind: "waiting",
      line: "Which?",
    });
  });
});
