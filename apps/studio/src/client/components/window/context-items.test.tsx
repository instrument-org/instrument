import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { chatContextItems } from "./context-items";

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const OTHER = ChatIdSchema.parse("2026-10-02-porto");

describe("a chat's next message", () => {
  it("carries the chat's own tab up beside it", () => {
    const items = chatContextItems({
      finderOf: () => null,
      group: CHAT,
      up: {
        group: CHAT,
        id: "own",
        kind: "page",
        openedAt: 1,
        title: "Example",
        url: "https://example.com/",
      },
    });
    expect(
      items.map((item) => [item.key, item.kind === "tab" && item.owned]),
    ).toEqual([["tab:own", true]]);
  });

  it.each([
    ["another chat beside it names nothing", `/chats/${OTHER}`, undefined],
    ["a new chat beside it names nothing", "/chats?draft=d1", undefined],
    ["the same chat beside it names nothing", `/chats/${CHAT}`, undefined],
  ])("%s", (_, href, kind) => {
    const items = chatContextItems({
      finderOf: () => null,
      group: "group:1",
      up: { group: "group:1", href, id: "beside", kind: "screen" },
    });
    expect(items[0]?.kind).toBe(kind);
  });
});
