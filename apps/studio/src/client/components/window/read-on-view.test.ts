import { describe, expect, it } from "vitest";

import { READ_DWELL_MS, readDelay } from "./read-on-view";

const SITTING: Parameters<typeof readDelay>[0] = {
  chatId: "lisbon",
  isUnread: true,
  isUnreadByUser: false,
  isUp: true,
  previousChatId: "lisbon",
  wasUp: true,
};

describe("readDelay", () => {
  it.each<[string, Partial<Parameters<typeof readDelay>[0]>, null | number]>([
    ["a chat with nothing unread", { isUnread: false }, null],
    ["a chat that is not up", { isUp: false }, null],
    [
      "the first look at a chat",
      { previousChatId: null, wasUp: null },
      READ_DWELL_MS,
    ],
    ["a chat coming up in its tab", { wasUp: false }, READ_DWELL_MS],
    [
      "another chat taking the same screen",
      { previousChatId: "porto" },
      READ_DWELL_MS,
    ],
    ["a mark landing while the user is on the chat", {}, 0],
    ["a mark the user set while on the chat", { isUnreadByUser: true }, null],
    [
      "coming back to a chat the user marked",
      { isUnreadByUser: true, wasUp: false },
      READ_DWELL_MS,
    ],
  ])("waits as it should for %s", (_, view, delay) => {
    expect(readDelay({ ...SITTING, ...view })).toBe(delay);
  });
});
