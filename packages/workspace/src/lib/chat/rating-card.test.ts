import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { addCardIfDue, RATING_CARD_GAP_MS, ratingCardDue } from "./rating-card";

const NOW = new Date("2026-11-05T15:00:00Z");

const now = vi.hoisted(() => ({ current: new Date() }));
vi.mock(import("../get-current-date"), () => ({
  getCurrentDate: () => now.current,
}));

function messageOf(
  sessionId: StoreId.Session,
  role: "assistant" | "user",
  parts: (meta: {
    createdAt: Date;
    id: StoreId.Part;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  }) => SessionMessagePart.Type[],
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const meta = {
    createdAt: NOW,
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  };
  const metadata = { createdAt: NOW, sessionId };
  return {
    id,
    metadata:
      role === "user"
        ? metadata
        : {
            ...metadata,
            aiGatewayModel: undefined,
            finishReason: "stop",
            modelId: "m",
            providerId: "openai",
          },
    parts: parts(meta),
    role,
  } as SessionMessage.WithParts;
}

const said = (sessionId: StoreId.Session) =>
  messageOf(sessionId, "user", (metadata) => [
    { metadata, state: "done", text: "Please do this", type: "text" },
  ]);

/** A task's or a wake's note: from nobody, with no words. */
const wake = (sessionId: StoreId.Session) =>
  messageOf(sessionId, "user", (metadata) => [
    { data: { date: "2026-11-05" }, metadata, type: "data-dateChange" },
  ]);

const replied = (sessionId: StoreId.Session, steps = 0) =>
  messageOf(sessionId, "assistant", (metadata) => [
    ...Array.from(
      { length: steps },
      () =>
        ({
          input: { command: "ls" },
          metadata: { ...metadata, id: StoreId.newPartId() },
          output: { state: "success" },
          state: "output-available",
          toolCallId: StoreId.newPartId(),
          type: "tool-bash",
        }) as unknown as SessionMessagePart.Type,
    ),
    {
      metadata: { ...metadata, id: StoreId.newPartId() },
      state: "done",
      text: "Done",
      type: "text",
    },
  ]);

describe("ratingCardDue", () => {
  const id = StoreId.newSessionId();
  const due = (
    chat: SessionMessage.WithParts[],
    tasks: SessionMessage.WithParts[][] = [],
  ) => ratingCardDue({ chat, sessions: [chat, ...tasks] });

  it.each([
    ["one message and few steps", [said(id), replied(id, 2)], false],
    [
      "two messages and six steps",
      [said(id), replied(id, 3), said(id), replied(id, 3)],
      false,
    ],
    ["one big job with one message", [said(id), replied(id, 40)], false],
    [
      "two messages and ten steps",
      [said(id), replied(id, 5), said(id), replied(id, 5)],
      true,
    ],
    ["a wake that nobody wrote", [said(id), wake(id), replied(id, 12)], false],
  ])("%s", (_name, chat, expected) => {
    expect(due(chat)).toBe(expected);
  });

  it("counts the steps of the chat's tasks", () => {
    const task = StoreId.newSessionId();
    expect(
      due(
        [said(id), replied(id, 2), said(id), replied(id)],
        [[replied(task, 8)]],
      ),
    ).toBe(true);
  });

  it("is due once per chat", () => {
    const chat = [said(id), replied(id, 5), said(id), replied(id, 5)];
    const card = messageOf(id, "assistant", (metadata) => [
      { data: {}, metadata, type: "data-ratingCard" },
    ]);
    expect(due([...chat, card])).toBe(false);
  });
});

describe("addCardIfDue", () => {
  let root: string;
  const original = getWorkspaceConfig();

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rating-card-"));
    setWorkspaceConfig({
      ...original,
      chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
      rootDir: WorkspaceDirSchema.parse(root),
      workspaceMachineDir: AbsolutePathSchema.parse(root),
    });
  });

  beforeEach(() => {
    now.current = NOW;
    fs.rmSync(path.join(root, "rating-cards.json"), { force: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function longChat(): Promise<{
    chatId: ChatId;
    sessionId: StoreId.Session;
  }> {
    const sessionId = StoreId.newSessionId();
    const chatId = await chatFor(sessionId);
    for (const message of [
      said(sessionId),
      replied(sessionId, 5),
      said(sessionId),
      replied(sessionId, 5),
    ]) {
      const saved = await ChatWrites.saveMessageWithParts(message, chatId);
      if (saved.isErr()) {
        throw saved.error;
      }
    }
    return { chatId, sessionId };
  }

  const cards = async ({
    chatId,
    sessionId,
  }: Awaited<ReturnType<typeof longChat>>) =>
    (await ChatReads.transcript({ chatId, sessionId }))
      ._unsafeUnwrap()
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "data-ratingCard").length;

  it("adds one card, after the last reply, and none again", async () => {
    const chat = await longChat();
    await addCardIfDue(chat.chatId, chat.sessionId);
    await addCardIfDue(chat.chatId, chat.sessionId);
    now.current = new Date(NOW.getTime() + 2 * RATING_CARD_GAP_MS);
    await addCardIfDue(chat.chatId, chat.sessionId);
    expect(await cards(chat)).toBe(1);
    const messages = (await ChatReads.transcript(chat))._unsafeUnwrap();
    expect(messages.at(-1)?.parts.at(-1)?.type).toBe("data-ratingCard");
  });

  it("waits out the gap across chats, then adds the next", async () => {
    const [first, second] = [await longChat(), await longChat()];
    await addCardIfDue(first.chatId, first.sessionId);
    await addCardIfDue(second.chatId, second.sessionId);
    expect(await cards(second)).toBe(0);
    now.current = new Date(NOW.getTime() + RATING_CARD_GAP_MS - 1000);
    await addCardIfDue(second.chatId, second.sessionId);
    expect(await cards(second)).toBe(0);
    now.current = new Date(NOW.getTime() + RATING_CARD_GAP_MS);
    await addCardIfDue(second.chatId, second.sessionId);
    expect(await cards(second)).toBe(1);
  });
});
