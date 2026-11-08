import { draftGroupOf } from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { siteGroupOf } from "./app-tabs";
import { shownPaneTab } from "./draft-context";
import { closeTab, type WindowTabs } from "./tab-model";

// The window's RPC client opens a port to main as it loads, which a test has no main for.
vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const OTHER_CHAT = ChatIdSchema.parse("2026-10-02-plumber");

function page(id: string, group: string): WindowTab {
  return { group, id, kind: "page", openedAt: 0, url: "https://example.com/" };
}

function windowOf(
  tabs: WindowTab[],
  activeByGroup: Record<string, string>,
): WindowTabs {
  return { activeByGroup, tabs };
}

describe("shownPaneTab", () => {
  const state = windowOf(
    [
      page("a", CHAT),
      page("b", CHAT),
      page("c", OTHER_CHAT),
      page("d", draftGroupOf("d1")),
      page("e", siteGroupOf("t1")),
    ],
    {
      [CHAT]: "b",
      [OTHER_CHAT]: "c",
      [draftGroupOf("d1")]: "d",
      [siteGroupOf("t1")]: "e",
    },
  );

  it.each([
    ["the chat on screen's tab up, pane open", CHAT, {}, "b"],
    ["nothing for the chat's hidden pane", CHAT, { [CHAT]: false }, undefined],
    [
      "the chat on screen's, never another chat's",
      OTHER_CHAT,
      { [CHAT]: false },
      "c",
    ],
    ["nothing for a draft", draftGroupOf("d1"), {}, undefined],
    [
      "nothing for a site on the window's tab",
      siteGroupOf("t1"),
      {},
      undefined,
    ],
    ["nothing for a screen of its own", undefined, {}, undefined],
  ])("%s", (_case, group, paneOpenByGroup, expected) => {
    expect(shownPaneTab(state, group, paneOpenByGroup)?.id).toBe(expected);
  });

  it("drains the pane one tab a press, then leaves nothing for the next", () => {
    let current = windowOf([page("a", CHAT), page("b", CHAT)], { [CHAT]: "b" });
    const closed: string[] = [];
    for (let press = 0; press < 3; press++) {
      const tab = shownPaneTab(current, CHAT, {});
      if (tab === undefined) {
        closed.push("window's tab");
        break;
      }
      closed.push(tab.id);
      current = closeTab(current, tab.id, { homeId: "home" });
    }
    expect(closed).toEqual(["b", "a", "window's tab"]);
  });
});
