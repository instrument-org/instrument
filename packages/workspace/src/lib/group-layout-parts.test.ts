import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { type LayoutRead, type LayoutTab } from "../schemas/group-layout";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import { ensureChatSession } from "./create-session";
import { layoutParts } from "./group-layout-parts";

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

const read = (
  tabs: LayoutTab[],
  group = "group_a",
  moves: Pick<LayoutRead, "movedIn" | "movedOut"> = {
    movedIn: {},
    movedOut: {},
  },
): LayoutRead => ({
  layout: { focused: 0, group: { id: group }, sides: [{ tabs }] },
  ...moves,
});

async function setup(name = "layout-parts") {
  const chatId = createMockChatConfig(ChatIdSchema.parse(name));
  const sessionId = (await ensureChatSession(chatId))._unsafeUnwrap().id;
  /** Asks for the parts of a message and writes it, as a send or a wake does. */
  const send = async (given?: LayoutRead) => {
    const createdAt = new Date();
    const messageId = StoreId.newMessageId();
    const parts = layoutParts({
      history: (await ChatReads.history({ chatId, sessionId }))._unsafeUnwrap(),
      chatId,
      createdAt,
      messageId,
      read: given,
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
  return { chatId, send, sessionId };
}

describe("layoutParts", () => {
  it("says nothing of a chat alone, then the group once it has more, then only what changed", async () => {
    const { send } = await setup();
    expect(await send(read([CHAT]))).toEqual([]);
    expect(await send(read([CHAT, PAGE]))).toEqual(["data-groupLayout"]);
    expect(await send(read([CHAT, PAGE]))).toEqual([]);
    // A wake no window answered writes nothing.
    expect(await send()).toEqual([]);
    expect(
      await send(
        read([CHAT], "group_a", {
          movedIn: {},
          movedOut: { tab_page: "group_c" },
        }),
      ),
    ).toEqual(["data-groupLayout", ["movedOut"]]);
    expect(await send(read([CHAT], "group_b"))).toEqual([
      "data-groupLayout",
      ["chatMoved"],
    ]);
  });

  it("keeps only the layout in the log, never where other tabs are", async () => {
    const { chatId, send, sessionId } = await setup("layout-parts-kept");
    await send(
      read([CHAT, PAGE], "group_a", {
        movedIn: { tab_page: "group_b" },
        movedOut: { tab_x: "group_c" },
      }),
    );
    const history = await ChatReads.history({ chatId, sessionId });
    const kept = history
      ._unsafeUnwrap()
      .flatMap((message) => message.parts)
      .find((part) => part.type === "data-groupLayout");
    expect(
      kept?.type === "data-groupLayout" && Object.keys(kept.data).toSorted(),
    ).toEqual(["focused", "group", "sides"]);
  });

  it("writes a layout only when its tabs or what shows changed", async () => {
    const { send } = await setup("layout-parts-said");
    // The first message goes from the new tab the chat starts in.
    expect(
      await send(
        read([
          { ...CHAT, address: "instrument://new-chat", kind: "newChat" },
          PAGE,
        ]),
      ),
    ).toEqual(["data-groupLayout"]);
    expect(await send(read([CHAT, PAGE]))).toEqual([]);
    expect(await send(read([CHAT, { ...PAGE, title: "Renamed" }]))).toEqual([]);
    expect(
      await send(read([{ ...CHAT, title: "Retitled chat" }, PAGE])),
    ).toEqual([]);
    expect(
      await send(
        read([
          { ...CHAT, isUp: false },
          { ...PAGE, isUp: true },
        ]),
      ),
    ).toEqual(["data-groupLayout", ["shown"]]);
  });
});
