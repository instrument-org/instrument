import { describe, expect, it } from "vitest";

import { workingTabOf } from "./working-tab";

const CHAT = "2026-10-01-roofer";

/** A chat's tab in a group, sent from at `promptedAt` when given. */
const chatTab = (id: string, group: string, promptedAt?: number) => ({
  group,
  href: `/chats/${CHAT}`,
  id,
  ...(promptedAt === undefined ? {} : { promptedAt }),
});

const TABS = [
  { group: "g:open", id: "page", url: "https://roofer.test/" },
  { group: "g:open", href: "/chats/2026-10-02-other", id: "other" },
  chatTab("first", "g:open"),
  chatTab("second", "g:open"),
  chatTab("closed", "g:closed", 9),
];

const isOpen = (group: string) => group === "g:open";

describe("workingTabOf", () => {
  it("is the chat's first tab in an open group while none was sent from", () => {
    expect(workingTabOf(TABS, CHAT, isOpen)?.id).toBe("first");
  });

  it("is the chat's tab last sent from, counting only groups an open window lists", () => {
    const sent = [...TABS, chatTab("sent", "g:open", 3)];
    expect(workingTabOf(sent, CHAT, isOpen)).toMatchObject({
      group: "g:open",
      id: "sent",
    });
    expect(workingTabOf(sent, CHAT, () => true)?.id).toBe("closed");
  });

  it("is nothing for a chat whose tabs are all in groups no open window lists", () => {
    expect(workingTabOf(TABS, CHAT, () => false)).toBeUndefined();
    expect(workingTabOf([{ id: "loose", href: `/chats/${CHAT}` }], CHAT, () => true)).toBeUndefined();
  });
});
