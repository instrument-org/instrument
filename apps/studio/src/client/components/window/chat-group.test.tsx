import { TabIdSchema } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useShowChatGroup } from "./chat-group";

const CHAT = ChatIdSchema.parse("chat-roofer");
const CLOSED = TabIdSchema.parse("closed-1");

const window = vi.hoisted(() => ({
  /** The group on screen. */
  front: "group-new" as string | undefined,
  /** The group the chat's tab is open in, if it is open. */
  openIn: undefined as string | undefined,
  /** Whether this window closed a group with the chat in it. */
  wasClosed: false,
}));
const reopenClosed = vi.hoisted(() => vi.fn());
const showGroup = vi.hoisted(() => vi.fn());

vi.mock("./shell-context", () => ({
  useShell: () => ({ reopenClosed, showGroup }),
}));
vi.mock("./window-tabs", () => ({
  useWindowTabs: () => ({
    active: window.front === undefined ? undefined : { group: window.front },
    chatTab: () =>
      window.openIn === undefined
        ? undefined
        : { group: window.openIn, id: "tab-chat" },
    select: () => undefined,
  }),
}));
vi.mock("./closed-groups", () => ({
  closedGroupOfChat: () => (window.wasClosed ? { id: CLOSED } : undefined),
}));

beforeEach(() => {
  window.front = "group-new";
  window.openIn = undefined;
  window.wasClosed = false;
  reopenClosed.mockClear();
  showGroup.mockClear();
});

// What the shell does with `from` is its own (`givesWay`): a group holding
// only a new tab nobody wrote in closes behind the pick.
describe("bringing up a chat's tab group", () => {
  it("names the group on screen as the one the pick was made in, for an open group", () => {
    window.openIn = "group-roofer";
    const { result } = renderHook(() => useShowChatGroup());
    expect(result.current(CHAT)).toBe(true);
    expect(showGroup).toHaveBeenCalledWith("group-roofer", {
      from: "group-new",
    });
  });

  it("names it for a closed group coming back", () => {
    window.wasClosed = true;
    const { result } = renderHook(() => useShowChatGroup());
    expect(result.current(CHAT)).toBe(true);
    expect(reopenClosed).toHaveBeenCalledWith(CLOSED, { from: "group-new" });
  });

  it("takes the group a caller names over the one on screen", () => {
    window.openIn = "group-roofer";
    const { result } = renderHook(() => useShowChatGroup());
    result.current(CHAT, { from: "group-chats" });
    expect(showGroup).toHaveBeenCalledWith("group-roofer", {
      from: "group-chats",
    });
  });

  it("does nothing for a chat in no group, open or closed", () => {
    const { result } = renderHook(() => useShowChatGroup());
    expect(result.current(CHAT)).toBe(false);
    expect(showGroup).not.toHaveBeenCalled();
    expect(reopenClosed).not.toHaveBeenCalled();
  });
});
