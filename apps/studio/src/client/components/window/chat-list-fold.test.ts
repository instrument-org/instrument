import { type ChatId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  addPaint,
  type ChatListState,
  dropPaint,
  emptyChatListState,
  landPaint,
  shareChatList,
  shownChats,
  takeChatListEvent,
} from "./chat-list-fold";
import { type Chat } from "./chats";

/** A row with what the fold reads; the rest of a wire row never reaches it. */
function row(id: string, sessionId: string, overrides: Partial<Chat> = {}) {
  // A partial row stands in for the whole: the fold reads its id and session.
  return {
    archived: false,
    holds: { apps: [], files: [], sites: [] },
    id,
    sessionId,
    starred: false,
    title: id,
    ...overrides,
  } as unknown as Chat;
}

const chat = (id: string) => id as ChatId;
const ids = (rows: Chat[] | undefined) => rows?.map((each) => each.id);

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
    removed: removed.map(chat),
    rev: from + 1,
    upserts,
  };
}

/** What the window shows once it takes `event` in. */
function take(
  state: ChatListState,
  event: Parameters<typeof takeChatListEvent>[1],
) {
  expect(takeChatListEvent(state, event)).toBe(true);
  return shownChats(state);
}

describe("folding the chat list", () => {
  it("takes a snapshot, then patches, in the list's order", () => {
    const state = emptyChatListState();
    take(state, snapshot("one", 4, [row("a", "ses_1"), row("c", "ses_3")]));

    const shown = take(
      state,
      patch(4, [row("b", "ses_2"), row("d", "ses_0")], ["c"]),
    );

    expect(ids(shown)).toEqual(["d", "a", "b"]);
    expect(state.held).toMatchObject({ epoch: "one", rev: 5 });
  });

  it("keeps the object of a row that did not change, and of one sent again the same", () => {
    const state = emptyChatListState();
    const [a, b] =
      take(state, snapshot("one", 0, [row("a", "ses_1"), row("b", "ses_2")])) ??
      [];

    const resent = take(state, patch(0, [row("b", "ses_2")]));
    expect(resent?.[0]).toBe(a);
    expect(resent?.[1]).toBe(b);

    const moved = take(
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
    const state = emptyChatListState();
    take(state, snapshot("one", 2, [row("a", "ses_1")]));

    expect(takeChatListEvent(state, event)).toBe(false);
    expect(state.held).toMatchObject({ epoch: "one", rev: 2 });
  });

  it("starts over from a patch before any snapshot", () => {
    expect(takeChatListEvent(emptyChatListState(), patch(0, []))).toBe(false);
  });
});

describe("paints over the chat list", () => {
  function listed() {
    const state = emptyChatListState();
    take(state, snapshot("one", 0, [row("a", "ses_1"), row("b", "ses_2")]));
    return state;
  }
  const starred = (state: ChatListState, id = "a") =>
    shownChats(state)?.find((each) => each.id === id)?.starred;

  // Invalid state A: another chat's change, read before the star was written.
  it("keeps a paint through a patch sent from before its request", () => {
    const state = listed();
    const paint = addPaint(state, chat("a"), { starred: true });
    expect(starred(state)).toBe(true);

    take(state, patch(0, [row("b", "ses_2", { title: "Moved" })]));
    landPaint(state, paint, { epoch: "one", rev: 2 });

    expect(starred(state)).toBe(true);
  });

  it("drops a paint once the list is at the revision its request answered with", () => {
    const state = listed();
    const paint = addPaint(state, chat("a"), { starred: true });
    landPaint(state, paint, { epoch: "one", rev: 1 });
    expect(state.paints).toHaveLength(1);

    take(state, patch(0, [row("a", "ses_1", { starred: true })]));

    expect(state.paints).toEqual([]);
    expect(starred(state)).toBe(true);
  });

  it("drops a paint at once when its answer is a revision the list already has, or no list", () => {
    const state = listed();
    landPaint(state, addPaint(state, chat("a"), { starred: true }), {
      epoch: "one",
      rev: 0,
    });
    landPaint(state, addPaint(state, chat("b"), { starred: true }), null);

    expect(state.paints).toEqual([]);
  });

  it("drops a paint whose request failed", () => {
    const state = listed();
    const paint = addPaint(state, chat("a"), { starred: true });

    dropPaint(state, paint);

    expect(starred(state)).toBe(false);
  });

  // Invalid state B: Undo pressed before the archive's answer arrives.
  it("shows a quick Undo all the way through the archive's answer", () => {
    const state = listed();
    const archived = () =>
      shownChats(state)?.find((each) => each.id === "a")?.archived;
    const archive = addPaint(state, chat("a"), { archived: true });
    const undo = addPaint(state, chat("a"), { archived: false });
    expect(archived()).toBe(false);

    landPaint(state, archive, { epoch: "one", rev: 1 });
    take(state, patch(0, [row("a", "ses_1", { archived: true })]));
    expect(archived()).toBe(false);

    landPaint(state, undo, { epoch: "one", rev: 2 });
    take(state, patch(1, [row("a", "ses_1", { archived: false })]));
    expect(archived()).toBe(false);
    expect(state.paints).toEqual([]);
  });

  // Invalid state E: a patch read before the delete still has the row.
  it("keeps a deleted chat out until the list has it gone", () => {
    const state = listed();
    landPaint(state, addPaint(state, chat("a"), "gone"), {
      epoch: "one",
      rev: 2,
    });

    expect(ids(take(state, patch(0, [row("a", "ses_1")])))).toEqual(["b"]);
    expect(ids(take(state, patch(1, [], ["a"])))).toEqual(["b"]);
    expect(state.paints).toEqual([]);
  });

  it("takes a field off for a change that sets it to nothing", () => {
    const state = emptyChatListState();
    take(state, snapshot("one", 0, [row("a", "ses_1", { project: "top_1" })]));

    addPaint(state, chat("a"), { project: undefined });

    expect(Object.keys(shownChats(state)?.[0] ?? {})).not.toContain("project");
  });

  it("drops a paint from another run of the list once a fresh one arrives", () => {
    const state = listed();
    landPaint(state, addPaint(state, chat("a"), { starred: true }), {
      epoch: "one",
      rev: 5,
    });

    take(state, snapshot("two", 0, [row("a", "ses_1", { starred: true })]));

    expect(state.paints).toEqual([]);
  });
});

describe("sharing what is read from the chat list", () => {
  it("keeps every row's object when a chat before it goes", () => {
    const [a, b, c] = [row("a", "ses_1"), row("b", "ses_2"), row("c", "ses_3")];

    const shared = shareChatList(
      [a, b, c],
      [row("a", "ses_1"), row("c", "ses_3")],
    );

    expect(shared[0]).toBe(a);
    expect(shared[1]).toBe(c);
  });

  it("keeps the list itself when nothing in it moved", () => {
    const before = [row("a", "ses_1")];

    expect(shareChatList(before, [row("a", "ses_1")])).toBe(before);
  });
});
