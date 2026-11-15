import { type WindowTab } from "@/client/atoms/window";
import { describe, expect, it } from "vitest";

import { drivenTabOf } from "./driven-tab";

const page = (id: string, group: string): WindowTab => ({
  group,
  id,
  kind: "page",
  openedAt: 0,
  url: "https://example.com/",
});

describe("drivenTabOf", () => {
  it("finds the page the session acted in, whatever group holds it", () => {
    const tabs: WindowTab[] = [
      {
        group: "group:a",
        href: "/chats/chat-1",
        id: "chat-tab",
        kind: "screen",
      },
      page("p1", "group:a"),
    ];
    expect(drivenTabOf(tabs, (tab) => (tab.id === "p1" ? 5 : 0))?.id).toBe(
      "p1",
    );
  });

  it("keeps the original page after its group is duplicated", () => {
    // The copy is a tab of its own, in a group of its own, that no session has acted in.
    const tabs: WindowTab[] = [
      page("p1", "group:a"),
      page("p1-copy", "group:b"),
    ];
    const lastAt: Record<string, number> = { p1: 7 };
    expect(drivenTabOf(tabs, (tab) => lastAt[tab.id] ?? 0)?.id).toBe("p1");
  });

  it("follows the session to the tab it acted in last", () => {
    const tabs = [page("p1", "group:a"), page("p2", "group:b")];
    const lastAt: Record<string, number> = { p1: 3, p2: 9 };
    expect(drivenTabOf(tabs, (tab) => lastAt[tab.id] ?? 0)?.id).toBe("p2");
  });

  it("finds none before the session has acted in a page", () => {
    expect(drivenTabOf([page("p1", "group:a")], () => 0)).toBeUndefined();
  });
});
