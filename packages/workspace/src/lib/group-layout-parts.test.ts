import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { type LayoutRead, type LayoutTab } from "../schemas/group-layout";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { ChatWrites } from "./chat-writes";
import { ensureChatSession } from "./create-session";
import { layoutParts, noteLayoutRead } from "./group-layout-parts";

const CHAT: LayoutTab = {
  address: "instrument://chat/this",
  id: "tab_chat",
  isThisChat: true,
  isUp: true,
  kind: "chat",
  title: "Prices",
};
const PAGE: LayoutTab = {
  address: "https://example.com/",
  byAgent: true,
  id: "tab_page",
  kind: "website",
  title: "Example",
};

const read = (tabs: LayoutTab[], group = "group_a"): LayoutRead => ({
  elsewhere: {},
  layout: { focused: 0, group: { id: group }, sides: [{ tabs }] },
});

async function setup(name = "layout-parts") {
  const chatId = createMockChatConfig(ChatIdSchema.parse(name));
  const sessionId = (await ensureChatSession(chatId))._unsafeUnwrap().id;
  /** Asks for the parts of a message and writes it, as a send or a wake does. */
  const send = async (given?: LayoutRead) => {
    const createdAt = new Date();
    const messageId = StoreId.newMessageId();
    const parts = await layoutParts({
      chatId,
      createdAt,
      messageId,
      ...(given ? { read: given } : {}),
      sessionId,
    });
    await ChatWrites.saveMessageWithParts(
      {
        id: messageId,
        metadata: { createdAt, sessionId },
        parts,
        role: "user",
      } satisfies SessionMessage.UserWithParts,
      chatId,
    );
    return parts.map((part) =>
      part.type === "data-layoutChanges"
        ? part.data.changes.map(
            (one) =>
              `${one.change}${"byAgent" in one && one.byAgent ? " by an agent" : ""}`,
          )
        : part.type,
    );
  };
  return { chatId, send };
}

describe("layoutParts", () => {
  it("says nothing of a chat alone, then the group once it has more, then only what changed", async () => {
    const { chatId, send } = await setup();
    expect(await send(read([CHAT]))).toEqual([]);
    expect(await send(read([CHAT, PAGE]))).toEqual(["data-groupLayout"]);
    expect(await send(read([CHAT, PAGE]))).toEqual([]);
    // A wake carries the latest the window handed over.
    noteLayoutRead(chatId, read([CHAT]));
    expect(await send()).toEqual(["data-groupLayout", ["closed by an agent"]]);
    expect(await send(read([CHAT], "group_b"))).toEqual([
      "data-groupLayout",
      ["chatMoved"],
    ]);
  });

  it("writes a layout only when what it says changed", async () => {
    const { send } = await setup("layout-parts-said");
    expect(await send(read([CHAT, PAGE]))).toEqual(["data-groupLayout"]);
    expect(await send(read([CHAT, { ...PAGE, title: "Renamed" }]))).toEqual(
      [],
    );
    expect(
      await send(read([{ ...CHAT, isUp: false }, { ...PAGE, isUp: true }])),
    ).toEqual(["data-groupLayout"]);
  });
});
