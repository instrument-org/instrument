import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../../schemas/chat-id";
import { StoreId } from "../../../schemas/store-id";
import { browserTargetOf } from "../../../types";
import { resolveTabs } from "./tab-choice";

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const OWN = browserTargetOf(StoreId.newTabId());
const FILE = browserTargetOf(StoreId.newTabId());
const THEIRS = browserTargetOf(StoreId.newTabId());

// The window: the chat's tabs, whichever have a guest up.
vi.mock(import("../../chat/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  askWindow: () =>
    Promise.resolve({
      requestId: "r",
      tabs: [
        { id: OWN, kind: "page", title: "", url: "https://example.com/" },
        {
          id: FILE,
          kind: "page",
          title: "",
          url: "file:///Users/casey/notes.html",
        },
        { id: "screen-1", kind: "screen" },
      ],
    }),
}));
vi.mock(import("../../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveChat: (id: string) => ChatIdSchema.parse(id),
}));

describe("resolveTabs", () => {
  it("hands over a page of the chat's own, whether or not its guest is up", async () => {
    await expect(resolveTabs([OWN], { chatId: CHAT })).resolves.toEqual([OWN]);
  });

  it.each([
    [THEIRS, "is not one of this chat's tabs"],
    ["screen-1", "not a page"],
    [FILE, "shows a file on this computer"],
  ])("refuses %s", async (tab, why) => {
    await expect(resolveTabs([tab], { chatId: CHAT })).rejects.toThrow(why);
  });
});
