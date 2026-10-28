import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "../../constants";
import { ChatWrites } from "../chat-writes";
import { touchTask } from "./children";
import { taskStanding } from "./standing";

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
    input: {
      choices: ["Desktop", "Documents"],
      explanation,
      question: "Where?",
    },
    metadata: { ...partMetadata(ids), endedAt: new Date() },
    output: { declined: true, note: undefined },
    state: "output-available",
    toolCallId: `call_${explanation}`,
    type: "tool-choose",
  });

async function withSession(chatId: ReturnType<typeof freshChat>) {
  const sessionId = StoreId.newSessionId();
  await ChatWrites.saveSession(
    { createdAt: new Date(), id: sessionId, title: "task" },
    chatId,
  );
  return sessionId;
}

describe("taskStanding", () => {
  it("says what a finished task said, in one line", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await ChatWrites.saveMessageWithParts(
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
    await ChatWrites.saveMessageWithParts(
      assistant(sessionId, [
        (ids) => ({
          metadata: partMetadata(ids),
          text: "```files\n/Users/sam/Instrument/quotes/compared.html\n```",
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
    await ChatWrites.saveMessageWithParts(
      assistant(sessionId, [
        (ids) => ({
          metadata: partMetadata(ids),
          text: `\`\`\`files\n/Users/sam/Instrument/quotes/compared.html\n\`\`\`\n\n${words}`,
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

  it("says what a task stopped in the middle of when the stop cut its reply off", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await ChatWrites.saveMessageWithParts(
      assistant(sessionId, [activity("Locating any bundled QuickJS runtime")], {
        finishReason: "tool-calls",
      }),
      chatId,
    );
    // The message the model was streaming when the stop landed: a step and
    // nothing after it.
    await ChatWrites.saveMessageWithParts(
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

  it("reads a task whose request timed out as failed, saying it timed out", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await ChatWrites.saveMessageWithParts(
      assistant(sessionId, [activity("Reading the vault")], {
        finishReason: "tool-calls",
      }),
      chatId,
    );
    await ChatWrites.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            metadata: { ...partMetadata(ids), stepCount: 3 },
            type: "step-start",
          }),
        ],
        {
          error: { kind: "aborted", message: "Aborted", reason: "timeout" },
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
      kind: "failed",
      line: "Timed out while reading the vault",
    });
  });

  it("says what a task stopped in the middle of when the stop landed on a tool call", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await ChatWrites.saveMessageWithParts(
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

  it("says the app's closing cut a task off, rather than calling it done", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    // An earlier step said something, then the turn went on to the call the
    // quit landed on.
    await ChatWrites.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            metadata: partMetadata(ids),
            text: "Starting the count now.",
            type: "text",
          }),
        ],
        { finishReason: "tool-calls" },
      ),
      chatId,
    );
    await ChatWrites.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
            input: {
              activity: "Counting to a million",
              command: "python count.py",
              yieldMs: 30_000,
              explanation: "Run the count",
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
    await touchTask(chatId, sessionId, { stoppedBy: "app" });

    const standing = await taskStanding({
      isRunning: false,
      sessionId,
      chatId,
    });

    expect(standing).toMatchInlineSnapshot(`
      {
        "kind": "failed",
        "line": "The app closed while counting to a million",
      }
    `);
  });

  it("says the app's closing cut a task off when only the next launch's sweep saw it", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await ChatWrites.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
            input: {
              command: "curl -s https://example.com/page/7",
              yieldMs: 30_000,
              explanation: "Fetching page 7 of 20",
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

    expect(standing).toMatchInlineSnapshot(`
      {
        "kind": "failed",
        "line": "The app closed while fetching page 7 of 20",
      }
    `);
  });

  it("keeps the case of a step that opens on an acronym", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await ChatWrites.saveMessageWithParts(
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
    await ChatWrites.saveMessageWithParts(
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
    await ChatWrites.saveMessageWithParts(
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
    await ChatWrites.saveMessageWithParts(
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

  it("does not call a task that ran out of room to write a failure", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);
    await ChatWrites.saveMessageWithParts(
      assistant(
        sessionId,
        [
          (ids) => ({
            data: { continuations: 1 },
            metadata: partMetadata(ids),
            type: "data-outputLimit",
          }),
        ],
        {
          finishReason: "length",
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
      line: "Cut off at the output limit",
    });
  });

  it("says the step while it runs", async () => {
    const chatId = freshChat();
    const sessionId = await withSession(chatId);

    const standing = await taskStanding({ isRunning: true, sessionId, chatId });

    expect(standing.kind).toBe("running");
    expect(standing.line).toBe("Working");
  });

  // A card is kept in the state of the computer that raised it, which no
  // other computer reads; the record they share shows only the call.
  describe("a turn that ended on a permission card none of this computer's", () => {
    const asked = (
      ids: PartIds,
    ): SessionMessage.WithParts["parts"][number] => ({
      input: {
        explanation: "Asking for the Pantry folder",
        kind: "folder",
        reason: "So I can read your pantry notes.",
        target: "/Users/sam/Documents/Pantry",
      },
      metadata: { ...partMetadata(ids), endedAt: new Date() },
      output: {
        kind: "folder",
        state: "asked",
        target: "/Users/sam/Documents/Pantry",
      },
      state: "output-available",
      toolCallId: "call_ask",
      type: "tool-ask_permission",
    });

    async function endedOnTheCard() {
      const chatId = freshChat();
      const sessionId = await withSession(chatId);
      await ChatWrites.saveMessageWithParts(
        assistant(
          sessionId,
          [
            (ids) => ({
              metadata: partMetadata(ids),
              text: "The Pantry folder needs your OK first.",
              type: "text",
            }),
            asked,
          ],
          { finishReason: "tool-calls" },
        ),
        chatId,
      );
      return { chatId, sessionId };
    }

    it("reads as waiting on the computer the task runs on", async () => {
      const ref = await endedOnTheCard();

      expect(await taskStanding({ ...ref, isRunning: false })).toEqual({
        kind: "waiting",
        line: "Waiting for your permission on the computer it runs on",
      });
    });

    it("reads as what the task said once the answer woke it and it went on", async () => {
      const ref = await endedOnTheCard();
      await ChatWrites.saveMessageWithParts(
        assistant(ref.sessionId, [
          (ids) => ({
            metadata: partMetadata(ids),
            text: "Wrote the shopping list.",
            type: "text",
          }),
        ]),
        ref.chatId,
      );

      expect(await taskStanding({ ...ref, isRunning: false })).toEqual({
        kind: "done",
        line: "Wrote the shopping list.",
      });
    });

    it("reads as stopped, not waiting, once the person stopped it", async () => {
      const ref = await endedOnTheCard();
      await touchTask(ref.chatId, ref.sessionId, { stoppedBy: "person" });

      expect((await taskStanding({ ...ref, isRunning: false })).kind).not.toBe(
        "waiting",
      );
    });
  });
});
