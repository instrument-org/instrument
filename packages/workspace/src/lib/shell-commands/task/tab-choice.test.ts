import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../../schemas/chat-id";
import { StoreId } from "../../../schemas/store-id";
import { browserTargetOf } from "../../../types";
import { resolveTabs } from "./tab-choice";

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const OWN = browserTargetOf(StoreId.newSessionId());
const THEIRS = browserTargetOf(StoreId.newSessionId());

// The window: the chat's tabs, and every guest live, another chat's too.
vi.mock(import("../../chat/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  askWindow: () => Promise.resolve({ requestId: "r", tabIds: [OWN] }),
}));
vi.mock(import("../../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveChat: (id) => id,
}));
vi.mock(import("../../workspace-config"), () => ({
  getWorkspaceConfig: () =>
    ({
      browser: {
        getTargetMeta: () => ({ partitionDir: "/tmp/profile" }),
        listTargets: () => Promise.resolve([]),
      },
    }) as never,
}));

describe("resolveTabs", () => {
  it("hands over a tab of the chat's own", async () => {
    await expect(resolveTabs([OWN], { chatId: CHAT })).resolves.toEqual([OWN]);
  });

  it("refuses a live tab that is not the chat's, whatever id it was given", async () => {
    await expect(resolveTabs([THEIRS], { chatId: CHAT })).rejects.toThrow(
      "is not one of this chat's tabs",
    );
  });
});
