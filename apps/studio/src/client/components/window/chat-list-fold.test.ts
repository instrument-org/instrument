import { type ChatId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { type ChatListState, takeChatListEvent } from "./chat-list-fold";
import { type Chat } from "./chats";

/** A row with what the fold reads; the rest of a wire row never reaches it. */
function row(id: string, sessionId: string, overrides: Partial<Chat> = {}) {
  // A partial row stands in for the whole: the fold reads its id and session.
  return {
    holds: { apps: [], files: [], sites: [] },
    id,
    sessionId,
    title: id,
    ...overrides,
  } as unknown as Chat;
}

const ids = (rows: Chat[] | undefined) => rows?.map((chat) => chat.id);

function snapshot(epoch: string, rev: number, rows: Chat[]) {
  return { epoch, kind: "snapshot" as const, rev, rows };
}

function patch(
  from: number,
  upserts: Chat[],
  removed: string[] = [],
  epoch = "one",
) {
  return {
    epoch,
    from,
    kind: "patch" as const,
    removed: removed as ChatId[],
    rev: from + 1,
    upserts,
  };
}

describe("folding the chat list", () => {
  it("takes a snapshot, then patches, in the list's order", () => {
    const state: ChatListState = {};
    takeChatListEvent(
      state,
      snapshot("one", 4, [row("a", "ses_1"), row("c", "ses_3")]),
    );

    const shown = takeChatListEvent(
      state,
      patch(4, [row("b", "ses_2"), row("d", "ses_0")], ["c"]),
    );

    expect(ids(shown)).toEqual(["d", "a", "b"]);
    expect(state.held).toMatchObject({ epoch: "one", rev: 5 });
  });

  it("keeps the object of a row that did not change, and of one sent again the same", () => {
    const state: ChatListState = {};
    const [a, b] =
      takeChatListEvent(
        state,
        snapshot("one", 0, [row("a", "ses_1"), row("b", "ses_2")]),
      ) ?? [];

    const resent = takeChatListEvent(state, patch(0, [row("b", "ses_2")]));
    expect(resent?.[0]).toBe(a);
    expect(resent?.[1]).toBe(b);

    const moved = takeChatListEvent(
      state,
      patch(1, [row("b", "ses_2", { title: "Renamed" })]),
    );
    expect(moved?.[0]).toBe(a);
    expect(moved?.[1]).not.toBe(b);
    expect(moved?.[1]?.holds).toBe(b?.holds);
  });

  it.each([
    ["skips a change", patch(3, [])],
    ["comes from another run of the list", patch(2, [], [], "two")],
  ])("starts over from a patch that %s", (_case, event) => {
    const state: ChatListState = {};
    takeChatListEvent(state, snapshot("one", 2, [row("a", "ses_1")]));

    expect(takeChatListEvent(state, event)).toBeUndefined();
    expect(state.held).toMatchObject({ epoch: "one", rev: 2 });
  });

  it("starts over from a patch before any snapshot", () => {
    expect(takeChatListEvent({}, patch(0, []))).toBeUndefined();
  });
});
