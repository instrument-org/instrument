import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { session } from "../../rpc/routes/session";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { chatDir, sessionOfChat } from "../record-folders";
import { foldChatInFolder } from "../records/fold-folder";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { MID_TURN_NOTE } from "./mid-turn";
import { chatById } from "./chats";
import { unansweredMessage } from "./take-back";

/** The sessions whose turn is at work, until a stop reaches them. */
const working = new Set<StoreId.Session>();

// Whether a turn runs is the workspace machine's to say, which a test has
// none of: a session is at work until the Stop's event is sent.
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: () => Promise.resolve({ running: [] }),
  isWorking: (_chatId, id) =>
    id === undefined ? working.size > 0 : working.has(id),
}));

const workspaceRef = {
  send: (event: { type: string }) => {
    if (event.type === "stopSessions") {
      working.clear();
    }
  },
} as unknown as WorkspaceActorRef;
const context = () => ({
  workspaceConfig: getWorkspaceConfig(),
  workspaceRef,
});

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "take-back-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
});

type Part = SessionMessagePart.Type;

function partOf(
  sessionId: StoreId.Session,
  messageId: StoreId.Message,
  part: Record<string, unknown>,
): Part {
  return {
    ...part,
    metadata: {
      createdAt: new Date(),
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
  } as Part;
}

/** A message the person typed, with what went with it, from the draft `fromDraft` unless that is null. */
function typed(
  sessionId: StoreId.Session,
  text: string,
  more: Record<string, unknown>[] = [],
  fromDraft: null | string = "draft-1",
): SessionMessage.UserWithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: new Date(),
      ...(fromDraft === null ? {} : { fromDraft }),
      sessionId,
    },
    parts: [
      partOf(sessionId, id, { state: "done", text, type: "text" }),
      ...more.map((part) => partOf(sessionId, id, part)),
    ],
    role: "user",
  };
}

/** A reply, stopped unless it says otherwise, made of `parts`. */
function reply(
  sessionId: StoreId.Session,
  parts: Record<string, unknown>[],
  finishReason: "aborted" | "stop" = "aborted",
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: new Date(),
      finishReason,
      modelId: "m",
      providerId: "openai",
      sessionId,
    },
    parts: parts.map((part) => partOf(sessionId, id, part)),
    role: "assistant",
  };
}

const words = (text: string) => ({ state: "done", text, type: "text" });
const thought = { state: "done", text: "Thinking it over", type: "reasoning" };
const toolCall = {
  input: { command: "ls" },
  state: "input-available",
  toolCallId: "call_1",
  type: "tool-bash",
};

/** A note the app wrote into the chat, a task finishing. */
function taskNote(sessionId: StoreId.Session): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: { createdAt: new Date(), sessionId },
    parts: [
      partOf(sessionId, id, {
        data: { events: [] },
        type: "data-taskEvent",
      }),
    ],
    role: "user",
  };
}

describe("the message a Stop takes back", () => {
  const sessionId = StoreId.newSessionId();
  const answered = [
    typed(sessionId, "one"),
    reply(sessionId, [words("Here it is.")], "stop"),
  ];

  it.each([
    ["no reply yet", [], true],
    ["a reply with only reasoning", [reply(sessionId, [thought])], true],
    ["a reply of blank words", [reply(sessionId, [words("  \n")])], true],
    ["a reply that said something", [reply(sessionId, [words("Sure")])], false],
    ["a reply that called a tool", [reply(sessionId, [toolCall])], false],
    [
      "a note from the app after the reply began",
      [reply(sessionId, [thought]), taskNote(sessionId)],
      true,
    ],
  ])("after %s: %s", (_name, after, takes) => {
    const message = typed(sessionId, "two");
    const found = unansweredMessage(
      [...answered, message, ...after],
      sessionId,
    );
    expect(found?.message.id).toBe(takes ? message.id : undefined);
  });

  it("takes out the message and the replies under it, and leaves the app's notes", () => {
    const message = typed(sessionId, "two");
    const empty = reply(sessionId, [thought]);
    const note = taskNote(sessionId);

    const found = unansweredMessage(
      [...answered, message, empty, note],
      sessionId,
    );

    expect(found?.takesOut).toEqual([message.id, empty.id]);
  });

  it("takes nothing back when two messages wait unanswered", () => {
    expect(
      unansweredMessage(
        [...answered, typed(sessionId, "two"), typed(sessionId, "three")],
        sessionId,
      ),
    ).toBeUndefined();
  });

  it("takes nothing back of a message that joined a turn at work", () => {
    const joined = typed(sessionId, "and this", [
      { data: { text: MID_TURN_NOTE }, type: "data-intent" },
    ]);
    expect(unansweredMessage([...answered, joined], sessionId)).toBeUndefined();
  });

  it("takes nothing back where no message of the person's waits", () => {
    expect(unansweredMessage(answered, sessionId)).toBeUndefined();
    expect(
      unansweredMessage([...answered, taskNote(sessionId)], sessionId),
    ).toBeUndefined();
  });
});

/** A chat whose turn is at work on `message`, with `after` written under it. */
async function chatAtWork(
  message: (sessionId: StoreId.Session) => SessionMessage.WithParts,
  after: (sessionId: StoreId.Session) => SessionMessage.WithParts[] = () => [],
) {
  const chatId = await chatFor(StoreId.newSessionId());
  const sessionId = sessionOfChat(chatId) ?? StoreId.newSessionId();
  // In the order they were written, which is the order their ids sort in.
  const before = [
    typed(sessionId, "one"),
    reply(sessionId, [words("Here it is.")], "stop"),
  ];
  const sent = message(sessionId);
  for (const each of [...before, sent, ...after(sessionId)]) {
    (await ChatWrites.saveMessageWithParts(each, chatId))._unsafeUnwrap();
  }
  working.add(sessionId);
  return { chatId, sent, sessionId };
}

async function wordsIn(chatId: ChatId, sessionId: StoreId.Session) {
  const history = (
    await ChatReads.history({ chatId, sessionId })
  )._unsafeUnwrap();
  return history.flatMap(({ parts }) =>
    parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
  );
}

describe("session.stop with takeBack", () => {
  it("takes back a message the model had not answered, for every device", async () => {
    const { chatId, sessionId } = await chatAtWork(
      (id) => typed(id, "two, with a typo"),
      (id) => [reply(id, [thought])],
    );

    const stopped = await call(
      session.stop,
      { id: chatId, takeBack: true },
      { context: context() },
    );

    expect(stopped.takenBack).toEqual({ draftId: "draft-1" });
    expect(await wordsIn(chatId, sessionId)).toEqual(["one", "Here it is."]);
    // Another device reads the chat from its files.
    const folded = await foldChatInFolder(chatDir(chatId));
    const own = folded.sessions.find(({ id }) => id === sessionId);
    expect(own?.messages.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
    ]);
    // What it stopped is gone, so the chat does not say it was stopped.
    expect((await chatById(chatId))?.status).not.toBe("stopped");
  });

  it("takes nothing back of a message no draft sent, which has nothing to give back", async () => {
    const { chatId, sessionId } = await chatAtWork((id) =>
      typed(id, "two", [], null),
    );

    const stopped = await call(
      session.stop,
      { id: chatId, takeBack: true },
      { context: context() },
    );

    expect(stopped.takenBack).toBeUndefined();
    expect(await wordsIn(chatId, sessionId)).toContain("two");
    expect((await chatById(chatId))?.status).toBe("stopped");
  });

  it.each([
    ["words", [words("Sure, looking")]],
    ["a tool call", [toolCall]],
  ])(
    "stops as ever once the reply has %s",
    async (_name, parts: Record<string, unknown>[]) => {
      const { chatId, sessionId } = await chatAtWork(
        (id) => typed(id, "two"),
        (id) => [reply(id, parts)],
      );

      const stopped = await call(
        session.stop,
        { id: chatId, takeBack: true },
        { context: context() },
      );

      expect(stopped.takenBack).toBeUndefined();
      expect(await wordsIn(chatId, sessionId)).toContain("two");
      expect((await chatById(chatId))?.status).toBe("stopped");
    },
  );

  it("takes nothing back unless asked to", async () => {
    const { chatId, sessionId } = await chatAtWork((id) => typed(id, "two"));

    const stopped = await call(
      session.stop,
      { id: chatId },
      { context: context() },
    );

    expect(stopped.takenBack).toBeUndefined();
    expect(await wordsIn(chatId, sessionId)).toContain("two");
  });

  it("takes nothing back when no turn of the chat's was at work", async () => {
    const { chatId, sessionId } = await chatAtWork((id) => typed(id, "two"));
    working.clear();

    const stopped = await call(
      session.stop,
      { id: chatId, takeBack: true },
      { context: context() },
    );

    expect(stopped.takenBack).toBeUndefined();
    expect(await wordsIn(chatId, sessionId)).toContain("two");
  });
});
