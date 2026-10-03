import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  EMPTY_GUEST_MEMO,
  type GuestMemo,
  reconcileGuests,
} from "./reconcile-guests";

const childTaskId = TaskIdSchema.parse("child-task");
const unreadTaskId = TaskIdSchema.parse("unread-task");
const open = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMF");
const closed = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMG");
const visited = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMH");
const taskOwn = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMJ");
const unread = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMK");

const windowGuest = (session: StoreId.Session) =>
  encodeBrowserTargetId(WINDOW_ID, session);
const taskGuest = encodeBrowserTargetId(childTaskId, taskOwn);
const unreadGuest = encodeBrowserTargetId(unreadTaskId, unread);

function reconcile(
  attached: BrowserTargetId[],
  {
    chatOfTask = new Map([[childTaskId, "chat-1"]]),
    heldIds = new Set<string>(),
    memo = EMPTY_GUEST_MEMO,
  }: {
    chatOfTask?: Map<typeof childTaskId, string | undefined>;
    heldIds?: Set<string>;
    memo?: GuestMemo;
  } = {},
) {
  return reconcileGuests({
    attached: new Set(attached),
    chatOfTask,
    heldIds,
    memo,
  });
}

describe("reconcileGuests", () => {
  it("closes the window's guests no tab or visit holds, and leaves a task's alone", () => {
    const result = reconcile(
      [windowGuest(open), windowGuest(closed), windowGuest(visited), taskGuest],
      { heldIds: new Set([open, "screen-1", visited, taskOwn]) },
    );
    expect(result.close).toMatchInlineSnapshot(`
      [
        "window/ses_01M3G55N35541T2M6SWPS72GMG",
      ]
    `);
    expect(result.add).toEqual([]);
  });

  it("asks for a close once while the guest stays attached, and again once it detached and came back", () => {
    const first = reconcile([windowGuest(closed)]);
    const second = reconcile([windowGuest(closed)], { memo: first.memo });
    const detached = reconcile([], { memo: second.memo });
    const back = reconcile([windowGuest(closed)], { memo: detached.memo });

    expect(
      [first, second, detached, back].map((result) => result.close.length),
    ).toEqual([1, 0, 0, 1]);
  });

  it("adds a tab for a task's guest as it arrives, in its chat's group, and only once", () => {
    const first = reconcile([taskGuest]);
    const second = reconcile([taskGuest], { memo: first.memo });

    expect(first.add).toEqual([
      { group: "chat-1", id: taskOwn, taskId: childTaskId },
    ]);
    expect(second.add).toEqual([]);
  });

  it("does not bring back a task's tab the user closed while its guest is still attached", () => {
    const opened = reconcile([taskGuest]);
    const afterClose = reconcile([taskGuest], {
      heldIds: new Set(),
      memo: opened.memo,
    });
    expect(afterClose.add).toEqual([]);
  });

  it("holds a guest whose task has not been read until the read names its chat", () => {
    const waiting = reconcile([unreadGuest]);
    const read = reconcile([unreadGuest], {
      chatOfTask: new Map([[unreadTaskId, undefined]]),
      memo: waiting.memo,
    });

    expect(waiting.add).toEqual([]);
    expect(read.add).toEqual([
      { group: undefined, id: unread, taskId: unreadTaskId },
    ]);
  });

  it("adds nothing for a task guest a tab already holds", () => {
    expect(reconcile([taskGuest], { heldIds: new Set([taskOwn]) }).add).toEqual(
      [],
    );
  });
});
