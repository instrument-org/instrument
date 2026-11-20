import { afterEach, expect, it } from "vitest";

import { tabStanding } from "../../src/lib/capabilities/window";
import { askWindow } from "../../src/lib/chat/window-tab";
import { ChatIdSchema } from "../../src/schemas/chat-id";
import { StoreId } from "../../src/schemas/store-id";
import { createStandInWindow } from "./stand-in-window";

const chatId = ChatIdSchema.parse("2026-11-17-stand-in");
let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
});

// What the agent is told about its own pages has to be what the app tells
// it: a new chat is alone in its group, and the page its browser opens lands
// beside it and shows, so a run never hears its page is hidden when the
// app would say it is in view.
it("places a new chat's first page beside it, showing", async () => {
  const window = createStandInWindow();
  window.lay(undefined);
  stop = window.listen();
  const tabId = StoreId.newTabId();
  await askWindow({
    action: { kind: "adopt", tabId, url: "https://example.com/" },
    askedBy: chatId,
    group: chatId,
  });
  expect(await tabStanding(chatId, tabId)).toMatchInlineSnapshot(`
    {
      "place": "showing on the right side, beside you",
      "shown": true,
    }
  `);
});
