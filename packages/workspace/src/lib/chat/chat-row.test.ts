import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { chatRow } from "./chat-row";
import { type Chat } from "./chats";

const names = (kind: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${kind}-${index}`);

const chat: Chat = {
  archived: false,
  createdAt: 1,
  firstAsk: "x".repeat(5000),
  holds: {
    apps: names("app", 80),
    files: names("file", 80),
    sites: names("site", 80),
  },
  id: ChatIdSchema.parse("chats-row"),
  lastAsk: "and again",
  lastReplyAt: 3,
  lastUserMessageAt: 2,
  ownStep: "Reading",
  ownWorking: true,
  runningTasks: [],
  sessionId: StoreId.newSessionId(),
  starred: false,
  status: "working",
  title: "A pasted document",
  titleByApp: true,
  titled: true,
  unread: false,
  unreadByUser: false,
  updatedAt: 3,
  working: true,
};

describe("a chat's row as a window has it", () => {
  it("leaves out what no window reads", () => {
    expect(Object.keys(chatRow(chat)).toSorted()).toMatchInlineSnapshot(`
      [
        "archived",
        "firstAsk",
        "holds",
        "id",
        "lastUserMessageAt",
        "sessionId",
        "starred",
        "status",
        "title",
        "titleByApp",
        "unread",
        "unreadByUser",
        "working",
      ]
    `);
  });

  it("cuts a long first message and long lists of holds, keeping the newest files and sites and the first apps", () => {
    const { firstAsk, holds } = chatRow(chat);

    expect(firstAsk).toHaveLength(1000);
    expect(holds.apps).toEqual(names("app", 50));
    expect(holds.files).toEqual(names("file", 80).slice(30));
    expect(holds.sites).toEqual(names("site", 80).slice(30));
  });
});
