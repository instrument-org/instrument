import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { type SessionMessageRelaxedPart } from "../../schemas/session/message-relaxed-part";
import { type StoreId } from "../../schemas/store-id";
import { withTestRecords } from "../../test/helpers/with-test-records";
import { type ToolName } from "../../tools/types";
import { isToolPart } from "../is-tool-part";
import { type ChatRecords } from "./chat-records";
import {
  assistantMessage,
  at,
  CHAT,
  messageId,
  partId,
  sessionId,
  textPart,
  userMessage,
} from "./test-records";
import {
  conversationView,
  listView,
  liveView,
  mergeViews,
  modelHistoryView,
  stepsView,
} from "./views";

const records = withTestRecords();

const NOW = at(100);
const chatSession = sessionId(1);
const taskSession = sessionId(2);

/** A one-pixel PNG, as `read_file` returns an image. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A part's own fields, before its metadata places it. */
type Fields<R = SessionMessageRelaxedPart.Type> = R extends unknown
  ? Omit<R, "metadata">
  : never;

function part(
  session: StoreId.Session,
  message: number,
  n: number,
  fields: Fields,
): SessionMessagePart.Type {
  return SessionMessagePart.coerce({
    ...fields,
    metadata: {
      createdAt: at(n),
      id: partId(n),
      messageId: messageId(message),
      sessionId: session,
    },
  });
}

function call(
  session: StoreId.Session,
  message: number,
  n: number,
  tool: ToolName,
  input: unknown,
  output: unknown,
): SessionMessagePart.Type {
  const relaxed: SessionMessageRelaxedPart.ToolPart = {
    input,
    metadata: {
      createdAt: at(n),
      endedAt: at(n),
      id: partId(n),
      messageId: messageId(message),
      sessionId: session,
    },
    output,
    state: "output-available",
    toolCallId: `call-${n}`,
    type: `tool-${tool}`,
  };
  return SessionMessagePart.coerce(relaxed);
}

function text(
  session: StoreId.Session,
  message: number,
  n: number,
  words: string,
) {
  return textPart(session, messageId(message), partId(n), words, at(n));
}

function finished(session: StoreId.Session, n: number, ended: number) {
  return assistantMessage(session, messageId(n), at(n), {
    finishedAt: at(ended),
  });
}

const s = chatSession;

/** The chat's conversation: its context, two turns, a rollover after the second, and a reply under way. */
const CHAT_MESSAGES: SessionMessage.WithParts[] = [
  {
    id: messageId(1),
    metadata: {
      agentName: "instrument",
      contextVersion: 41,
      createdAt: at(1),
      realRole: "system",
      sessionId: s,
    },
    parts: [text(s, 1, 10, "You are Instrument.")],
    role: "session-context",
  },
  {
    ...userMessage(s, messageId(2), at(2)),
    parts: [
      text(s, 2, 20, "Total the sales"),
      part(s, 2, 21, {
        data: { files: [], folders: [{ path: "/Users/someone/Sales" }] },
        type: "data-attachments",
      }),
    ],
  },
  {
    ...finished(s, 3, 4),
    parts: [
      part(s, 3, 30, { type: "step-start" }),
      part(s, 3, 31, { state: "done", text: "Adding up", type: "reasoning" }),
      call(s, 3, 32, "bash", { command: "ls" }, { stdout: "sales.csv" }),
      call(
        s,
        3,
        33,
        "read_file",
        { path: "/chart.png" },
        {
          base64Data: PNG,
          filePath: "/chart.png",
          mimeType: "image/png",
          modifiedAt: 1,
          state: "image",
        },
      ),
      text(s, 3, 34, "Here is the total."),
    ],
  },
  {
    ...userMessage(s, messageId(5), at(5)),
    parts: [text(s, 5, 50, "Now the regions")],
  },
  {
    ...finished(s, 6, 7),
    parts: [
      call(
        s,
        6,
        60,
        "choose",
        { choices: ["North"], question: "Which?" },
        { selectedChoice: "North" },
      ),
      text(s, 6, 61, "Done"),
      part(s, 6, 62, {
        data: { droppedMessages: 3, retainedUserMessages: 2 },
        type: "data-contextRollover",
      }),
    ],
  },
  {
    ...userMessage(s, messageId(8), at(8)),
    parts: [text(s, 8, 80, "Continue")],
  },
  {
    ...assistantMessage(s, messageId(9), at(9), { finishReason: "unknown" }),
    parts: [part(s, 9, 90, { type: "step-start" })],
  },
];

/** What the reply under way has streamed so far, which only memory holds. */
const STREAMING: SessionMessagePart.TextPart = {
  metadata: {
    createdAt: at(91),
    id: partId(91),
    messageId: messageId(9),
    sessionId: s,
  },
  state: "streaming",
  text: "Partial",
  type: "text",
};

const t = taskSession;

/** A task forked from the chat's first reply, which the chat stopped. */
const TASK_MESSAGES: SessionMessage.WithParts[] = [
  {
    ...userMessage(t, messageId(11), at(11)),
    parts: [
      part(t, 11, 110, {
        data: { kind: "assignment", text: "Look into the regions" },
        type: "data-fromChat",
      }),
    ],
  },
  {
    ...finished(t, 12, 13),
    parts: [
      call(t, 12, 120, "bash", { command: "cat north.csv" }, { stdout: "up" }),
      text(t, 12, 121, "North is up"),
    ],
  },
];

/** The same fixture, written as records. */
async function throughRecords(service: ChatRecords) {
  await service.startSession(CHAT, { createdAt: at(0), id: chatSession });
  await service.setting(CHAT, chatSession, {
    field: "title",
    value: { auto: false, text: "Quarterly numbers" },
  });
  await service.setting(CHAT, chatSession, { field: "starred", value: true });
  await service.setting(CHAT, chatSession, {
    field: "unread",
    value: "new",
  });
  for (const message of CHAT_MESSAGES) {
    await service.appendMessageWithParts(CHAT, message);
  }
  // Decided for two models: held for the one it was drawn under, lifted for
  // one with room for everything.
  await service.rollover(CHAT, chatSession, messageId(6), 1000, {
    roomy: { lifted: true, usableTokens: 2000 },
    small: { lifted: false, usableTokens: 1000 },
  });
  service.live(CHAT, chatSession).setPart(STREAMING);
  await service.startSession(CHAT, {
    createdAt: at(10),
    forkedAt: messageId(3),
    handle: "t1",
    id: taskSession,
    parent: chatSession,
    startedAs: "Regions",
  });
  for (const message of TASK_MESSAGES) {
    await service.appendMessageWithParts(CHAT, message);
  }
  await service.stopped(CHAT, taskSession, "agent");
  return service.read(CHAT);
}

function withoutStreaming(messages: SessionMessage.WithParts[]) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter(
      (each) => each.metadata.id !== STREAMING.metadata.id,
    ),
  }));
}

function partTypes(messages: SessionMessage.WithParts[]) {
  return messages.map((message) => [
    message.id,
    message.parts.map((each) => each.type),
  ]);
}

describe("views", () => {
  it("give a chat with a task and a rollover as it was written", async () => {
    const read = await throughRecords(records.service);
    const streaming = CHAT_MESSAGES.map((message) =>
      message.id === messageId(9)
        ? { ...message, parts: [...message.parts, STREAMING] }
        : message,
    );

    expect(listView(read)).toMatchObject([
      {
        id: chatSession,
        rolledOverAfterMessageId: messageId(6),
        rolledOverUnderUsableTokens: 1000,
        rolloverWindows: {
          roomy: { lifted: true, usableTokens: 2000 },
          small: { lifted: false, usableTokens: 1000 },
        },
        starredAt: NOW,
        title: "Quarterly numbers",
        titleSettledAt: NOW,
        unreadAt: NOW,
      },
      {
        forkedAtMessageId: messageId(3),
        handle: "t1",
        id: taskSession,
        parentId: chatSession,
        stoppedBy: "agent",
        title: "Regions",
      },
    ]);

    const chat = mergeViews(
      conversationView(read, chatSession),
      await stepsView(read, chatSession),
      liveView(read, chatSession),
    );
    expect(chat).toEqual(streaming);
    // The bytes a call returned come back from the blob that holds them.
    const image = chat[2]?.parts[3];
    expect(image && isToolPart(image) && image.output).toMatchObject({
      base64Data: PNG,
    });

    // A task reads the chat's messages up to the fork, then its own.
    expect(
      mergeViews(
        conversationView(read, taskSession),
        await stepsView(read, taskSession),
        liveView(read, taskSession),
      ),
    ).toEqual([...CHAT_MESSAGES.slice(0, 3), ...TASK_MESSAGES]);

    // A model with room for what the rollover dropped is sent all of it, and
    // never the part still arriving.
    expect(
      await modelHistoryView(read, chatSession, { model: "roomy" }),
    ).toEqual(CHAT_MESSAGES);
    expect(await modelHistoryView(read, taskSession)).toEqual([
      ...CHAT_MESSAGES.slice(0, 3),
      ...TASK_MESSAGES,
    ]);
  });

  it("split a transcript into what the chat view draws and the steps behind it", async () => {
    const read = await throughRecords(records.service);

    expect(partTypes(conversationView(read, chatSession))).toEqual([
      [messageId(2), ["text", "data-attachments"]],
      [messageId(3), ["text"]],
      [messageId(5), ["text"]],
      [messageId(6), ["tool-choose", "text"]],
      [messageId(8), ["text"]],
      [messageId(9), []],
    ]);
    expect(partTypes(await stepsView(read, chatSession))).toEqual([
      [messageId(1), ["text"]],
      [
        messageId(3),
        ["step-start", "reasoning", "tool-bash", "tool-read_file"],
      ],
      [messageId(6), ["data-contextRollover"]],
      [messageId(9), ["step-start"]],
    ]);
    expect(partTypes(liveView(read, chatSession))).toEqual([
      [messageId(9), ["text"]],
    ]);
    expect(
      partTypes(conversationView(read, taskSession, { inherited: false })),
    ).toEqual([
      [messageId(11), ["data-fromChat"]],
      [messageId(12), ["text"]],
    ]);
  });

  // A reply stopped before it said anything changes only its metadata, so a
  // reader that shared the request's object saw no change and never drew the
  // stop.
  it("hand a reader a copy of the running reply, which the request goes on changing", async () => {
    await throughRecords(records.service);
    const running = assistantMessage(chatSession, messageId(9), at(9), {
      finishReason: "unknown",
    });
    records.service.live(CHAT, chatSession).setMessage(running);
    const [shown] = liveView(await records.service.read(CHAT), chatSession);

    Object.assign(running.metadata, { finishReason: "aborted" });

    expect(shown?.metadata).toMatchObject({ finishReason: "unknown" });
  });

  it("send the model the bytes a call returned only past the rollover that holds", async () => {
    const read = await throughRecords(records.service);
    const readFile = (messages: SessionMessage.WithParts[]) => {
      const found = messages
        .find(({ id }) => id === messageId(3))
        ?.parts.find((each) => each.type === "tool-read_file");
      return found && isToolPart(found) ? found : undefined;
    };

    const narrowed = await modelHistoryView(read, chatSession, {
      model: "small",
    });
    expect(readFile(narrowed)?.output).toMatchObject({
      blob: expect.stringMatching(/^sha256-[0-9a-f]{64}\.png$/),
      mediaType: "image/png",
    });
    expect(narrowed.slice(5)).toEqual(withoutStreaming(CHAT_MESSAGES.slice(5)));

    const blobs = path.join(records.dirOf(CHAT), "blobs");
    for (const name of await fs.readdir(blobs)) {
      await fs.rm(path.join(blobs, name));
    }
    const lifted = readFile(
      await modelHistoryView(read, chatSession, { model: "roomy" }),
    );
    expect(lifted).toMatchObject({
      errorText:
        "The file this call returned is no longer in the chat's records.",
      state: "output-error",
    });
  });
});
