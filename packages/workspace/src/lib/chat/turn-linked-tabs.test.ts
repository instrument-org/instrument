import { beforeEach, describe, expect, it, vi } from "vitest";
import { okAsync } from "neverthrow";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { ChatWrites } from "../chat-writes";
import { getWorkspaceConfig } from "../workspace-config";
import { keepTurnLinkedTabs } from "./turn-linked-tabs";

const LIVE = StoreId.newTabId();
const UNLOADED = StoreId.newTabId();
const FILE = StoreId.newTabId();
/** A tab that opened on an HTML file, by its own id, and the page that drew it, now at a site. */
const WENT_ON = StoreId.newTabId();
const WENT_ON_PAGE = StoreId.newTabId();

vi.mock(import("./chat-tabs"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatPageTabs: () =>
    Promise.resolve([
      // Only the fields read here.
      { id: UNLOADED, title: "Orders", url: "https://shop.test/orders" },
      { id: WENT_ON, targetId: WENT_ON_PAGE, title: "", url: "" },
    ] as never),
}));

describe("keepTurnLinkedTabs", () => {
  const chatId = ChatIdSchema.parse("linked-tabs");
  const sessionId = StoreId.newSessionId();
  const save = vi.spyOn(ChatWrites, "savePart");

  beforeEach(() => {
    createMockChatConfig(chatId);
    save.mockReset();
    save.mockImplementation((part) => okAsync(part) as never);
    const { browser } = getWorkspaceConfig();
    vi.spyOn(browser, "getTargetAddress").mockImplementation((id) =>
      id.endsWith(LIVE)
        ? "https://shop.test/contract"
        : id.endsWith(FILE)
          ? "file:///Users/mac-user/page.html"
          : id.endsWith(WENT_ON_PAGE)
            ? "https://shop.test/receipt"
            : undefined,
    );
    vi.spyOn(browser, "listTargets").mockResolvedValue([]);
  });

  const turn = (text: string) =>
    // A stored turn; only the fields read here.
    [
      { id: "user", parts: [], role: "user" },
      {
        id: StoreId.newMessageId(),
        parts: [{ text, type: "text" }],
        role: "assistant",
      },
    ] as unknown as SessionMessage.WithParts[];

  it("keeps the page each linked tab is on, and no file or code", async () => {
    await keepTurnLinkedTabs({
      chatId,
      messages: turn(
        `[Return](instrument://tab/${LIVE}) [again](instrument://tab/${LIVE}) [Orders](instrument://tab/${UNLOADED}) [File](instrument://tab/${FILE}) \`[x](instrument://tab/tab_code)\``,
      ),
      sessionId,
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: {
        tabs: [
          { id: LIVE, url: "https://shop.test/contract" },
          { id: UNLOADED, title: "Orders", url: "https://shop.test/orders" },
        ],
      },
      type: "data-linkedTabs",
    });
  });

  it("keeps the page of a tab its agents name by an id the page does not have", async () => {
    await keepTurnLinkedTabs({
      chatId,
      messages: turn(`[Receipt](instrument://tab/${WENT_ON})`),
      sessionId,
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { tabs: [{ id: WENT_ON, url: "https://shop.test/receipt" }] },
    });
  });

  it("writes nothing for a reply that links no tab", async () => {
    await keepTurnLinkedTabs({
      chatId,
      messages: turn("[Site](https://shop.test/)"),
      sessionId,
    });
    expect(save).not.toHaveBeenCalled();
  });
});
