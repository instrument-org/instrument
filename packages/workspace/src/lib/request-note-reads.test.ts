import { isDeepStrictEqual } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AnyAgent } from "../agents/types";
import { ChatIdSchema } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { movedPastOf } from "./chat/ask-states";
import { chatById } from "./chat/chats";
import { sessionDeveloperNotes } from "./chat/session-developer-notes";
import { stepInFlightIn } from "./chat/in-flight";
import { lastAssistantTextIn } from "./chat/latest-session";
import { sessionSteps } from "./chat/steps";
import { taskStanding } from "./chat/task-standing";
import { isStopNote } from "./chat/wake-event";
import { renderChatMarkdown } from "./chat-folders/chat-markdown";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import {
  dropRetriedFailedMessages,
  dropTrailingFailedMessages,
} from "./drop-trailing-failed-messages";
import { endOfTurnNote } from "./end-of-turn-checks";
import { prepareModelMessages } from "./prepare-model-messages";
import { writingChatRecords } from "./records/chat-records";
import { SESSION_CONTEXT_VERSION } from "./session-baseline";
import { transcriptMessage } from "./transcript/transcript-message";
import { turnsOf } from "./transcript/turns-of";
import { cutOffAtOutputLimit, opensTypedTurn, turnNoteFor } from "./turn-note";

// No session is alive in a test, which the chat's row reads from the machine.
vi.mock(import("./workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByChatId: { get: () => [] } },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

const model = createMockAIGatewayModel({ author: "anthropic" });

type Step = {
  /** What the message is, leaving out its parts. */
  error?: SessionMessage.Assistant["metadata"]["error"];
  finishReason?: SessionMessage.Assistant["metadata"]["finishReason"];
  finished?: boolean;
  /** The kind of hidden part it carries when the note is present. */
  hidden: "data-requestFailure" | "data-requestNote" | "none";
  role: "assistant" | "user";
  /** Task news stopped by the person, for a message that is a stop note. */
  stopNote?: boolean;
  words?: string;
};

const FAILED: SessionMessage.Assistant["metadata"]["error"] = {
  kind: "unknown",
  message: "The provider gave up",
};

const typed: Step = { hidden: "none", role: "user", words: "Do the work" };
const failed: Step = {
  error: FAILED,
  finished: true,
  hidden: "data-requestNote",
  role: "assistant",
};

/** Each shape a turn takes where an attempt holds nothing else. */
const CASES: [string, Step[]][] = [
  ["a failed attempt", [typed, failed]],
  [
    "an attempt that finished with nothing",
    [
      typed,
      {
        finishReason: "stop",
        finished: true,
        hidden: "data-requestNote",
        role: "assistant",
      },
    ],
  ],
  [
    "an attempt still going",
    [typed, { hidden: "data-requestNote", role: "assistant" }],
  ],
  [
    "an attempt the person stopped",
    [
      typed,
      {
        error: { kind: "aborted", message: "Aborted", reason: "manual" },
        finishReason: "aborted",
        finished: true,
        hidden: "data-requestNote",
        role: "assistant",
      },
    ],
  ],
  [
    "a retry under way after a failure",
    [typed, failed, { hidden: "data-requestNote", role: "assistant" }],
  ],
  [
    "a failure a retry finished",
    [
      typed,
      failed,
      {
        finishReason: "stop",
        finished: true,
        hidden: "data-requestNote",
        role: "assistant",
        words: "Done",
      },
    ],
  ],
  [
    "a step the output limit cut off before any words",
    [
      typed,
      {
        finishReason: "length",
        finished: true,
        hidden: "data-requestNote",
        role: "assistant",
      },
    ],
  ],
  [
    "a failure the person wrote after",
    [typed, failed, { hidden: "none", role: "user", words: "Try again" }],
  ],
  [
    "a request that failed being built, on the person's message",
    [{ ...typed, hidden: "data-requestFailure" }],
  ],
  [
    "a request that failed being built, on a stop note",
    [
      typed,
      {
        finishReason: "stop",
        finished: true,
        hidden: "none",
        role: "assistant",
        words: "Started",
      },
      { hidden: "data-requestFailure", role: "user", stopNote: true },
    ],
  ],
];

describe("a message whose only other part is a request's note", () => {
  let chatId: ReturnType<typeof ChatIdSchema.parse>;
  let sessionId: StoreId.Session;
  let clock: number;
  const tick = () => new Date((clock += 1000));

  const agent = (): AnyAgent => {
    const id = StoreId.newMessageId();
    const createdAt = new Date(0);
    const context: SessionMessage.ContextWithParts = {
      id,
      metadata: {
        agentName: "main",
        contextVersion: SESSION_CONTEXT_VERSION,
        createdAt,
        realRole: "system",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId: id,
            sessionId,
          },
          text: "A prompt.",
          type: "text",
        },
      ],
      role: "session-context",
    };
    return {
      agentTools: {},
      getMessages: () => Promise.resolve([context]),
      getTools: () => Promise.resolve([]),
      name: "instrument",
      onFinish: () => Promise.resolve(),
      onStart: () => Promise.resolve(),
      shouldContinue: () => Promise.resolve(true),
      systemPrompt: () => "A prompt.",
    };
  };

  const metaOf = (messageId: StoreId.Message) => ({
    createdAt: tick(),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  });

  /** Writes the turn as a request writes it, and gives back where each hidden part goes. */
  async function write(steps: Step[]) {
    const owed: { hidden: Step["hidden"]; messageId: StoreId.Message }[] = [];
    for (const step of steps) {
      const id = StoreId.newMessageId();
      const createdAt = tick();
      await ChatWrites.saveMessage(
        step.role === "user"
          ? { id, metadata: { createdAt, sessionId }, role: "user" }
          : {
              id,
              metadata: {
                aiGatewayModel: model,
                createdAt,
                ...(step.error && { error: step.error }),
                finishReason: step.finishReason ?? "unknown",
                ...(step.finished && { finishedAt: tick() }),
                modelId: "mock-model-id",
                providerId: "mock-provider-id",
                sessionId,
              },
              role: "assistant",
            },
        chatId,
      );
      owed.push({ hidden: step.hidden, messageId: id });
      if (step.words !== undefined) {
        await ChatWrites.savePart(
          {
            metadata: metaOf(id),
            state: "done",
            text: step.words,
            type: "text",
          },
          chatId,
        );
      }
      if (step.stopNote) {
        await ChatWrites.savePart(
          {
            data: {
              events: [
                {
                  sessionId: StoreId.newSessionId(),
                  status: "done",
                  stoppedBy: "person",
                  title: "A task",
                },
              ],
            },
            metadata: metaOf(id),
            type: "data-taskEvent",
          } as SessionMessagePart.Type,
          chatId,
        );
      }
    }
    return owed;
  }

  async function saveHidden(
    owed: Awaited<ReturnType<typeof write>>,
  ): Promise<number> {
    let saved = 0;
    for (const { hidden, messageId } of owed) {
      if (hidden === "data-requestNote") {
        saved += 1;
        await ChatWrites.savePart(
          {
            data: { kind: "turn", text: "A note for one request." },
            metadata: metaOf(messageId),
            type: "data-requestNote",
          },
          chatId,
        );
      }
      if (hidden === "data-requestFailure") {
        saved += 1;
        await ChatWrites.savePart(
          {
            data: { error: "It failed being built." },
            metadata: metaOf(messageId),
            type: "data-requestFailure",
          },
          chatId,
        );
      }
    }
    return saved;
  }

  /** Every reading of the session a request, the chat view or the app makes. */
  async function everyReading(sent: AnyAgent) {
    const ref = { chatId, sessionId };
    const modelHistory = (await ChatReads.modelHistory(ref))._unsafeUnwrap();
    const transcript = (await ChatReads.transcript(ref))._unsafeUnwrap();
    const light = transcript.flatMap((one) => transcriptMessage(one) ?? []);
    const folded = await writingChatRecords()?.read(chatId);
    const own = folded?.chat.sessions.find(({ id }) => id === sessionId);
    return {
      chat: await chatById(chatId),
      cutOff: cutOffAtOutputLimit(modelHistory),
      endOfTurn: await endOfTurnNote({
        chatId,
        messages: modelHistory,
        sessionId,
      }),
      history: (await ChatReads.history(ref))._unsafeUnwrap(),
      inFlight: stepInFlightIn(transcript, new Date("2026-11-05T13:00:00Z")),
      lastWords: lastAssistantTextIn(transcript),
      light,
      markdown:
        folded &&
        renderChatMarkdown({
          chat: folded.chat,
          id: chatId,
          rootDir: "/workspace",
        }),
      modelHistory,
      movedPast: own && movedPastOf(own.messages, own.stopped),
      opens: opensTypedTurn(modelHistory),
      request: JSON.stringify(
        (
          await prepareModelMessages({
            agent: sent,
            chatId,
            model,
            sessionId,
            signal: AbortSignal.timeout(30_000),
          })
        )._unsafeUnwrap(),
      ),
      retriedDropped: dropRetriedFailedMessages(modelHistory).map(
        ({ id }) => id,
      ),
      rowsAtRest: turnsOf(light, { isRunning: false, sessionId }),
      rowsRunning: turnsOf(light, { isRunning: true, sessionId }),
      standing: await taskStanding({ ...ref, isRunning: false }),
      steps: await sessionSteps(ref),
      transcript,
      stopNotes: transcript.filter(isStopNote).map(({ id }) => id),
      trailingDropped: dropTrailingFailedMessages(modelHistory).map(
        ({ id }) => id,
      ),
      turnNote: await turnNoteFor(ref),
      whole: (await ChatReads.sessionWithMessages(ref))._unsafeUnwrap(),
    };
  }

  beforeEach(async () => {
    clock = Date.parse("2026-11-05T12:00:00Z");
    sessionId = StoreId.newSessionId();
    createMockChatConfig(ChatIdSchema.parse("mock"), { model });
    chatId = await chatFor(sessionId);
    await ChatWrites.saveSession(
      { createdAt: new Date(clock), id: sessionId, title: "A chat" },
      chatId,
    );
  });

  it.each(CASES)(
    "reads the same with and without it: %s",
    async (_name, steps) => {
      const sent = agent();
      const owed = await write(steps);
      // The session's baseline is written by its first request, so the first
      // reading made here is not the one compared.
      await everyReading(sent);
      const without = await everyReading(sent);
      expect(await saveHidden(owed)).toBeGreaterThan(0);
      const withNote = await everyReading(sent);
      const changed = Object.entries(without)
        .filter(
          ([reading, value]) =>
            !isDeepStrictEqual(
              withNote[reading as keyof typeof withNote],
              value,
            ),
        )
        .map(([reading]) => reading);
      expect(changed).toEqual([]);
      expect(withNote.chat?.id).toBe(chatId);
      expect(withNote.stopNotes).toHaveLength(
        steps.filter((step) => step.stopNote).length,
      );
      // And a developer still reads it.
      const { notes } = (
        await sessionDeveloperNotes({ chatId, sessionId })
      )._unsafeUnwrap();
      expect(notes.length).toBeGreaterThan(0);
    },
  );
});
