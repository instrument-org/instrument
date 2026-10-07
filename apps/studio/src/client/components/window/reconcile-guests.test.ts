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

const open = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMF");
const closed = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMG");
const visited = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMH");
const other = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMJ");

const windowGuest = (session: StoreId.Session) =>
  encodeBrowserTargetId(WINDOW_ID, session);
const notTheWindows = encodeBrowserTargetId(
  TaskIdSchema.parse("some-task"),
  other,
);

function reconcile(
  attached: BrowserTargetId[],
  {
    heldIds = new Set<string>(),
    memo = EMPTY_GUEST_MEMO,
  }: { heldIds?: Set<string>; memo?: GuestMemo } = {},
) {
  return reconcileGuests({ attached: new Set(attached), heldIds, memo });
}

describe("reconcileGuests", () => {
  it("closes the window's guests no tab or visit holds, and leaves any other alone", () => {
    const result = reconcile(
      [
        windowGuest(open),
        windowGuest(closed),
        windowGuest(visited),
        notTheWindows,
      ],
      { heldIds: new Set([open, "screen-1", visited]) },
    );
    expect(result.close).toMatchInlineSnapshot(`
      [
        "window/ses_01M3G55N35541T2M6SWPS72GMG",
      ]
    `);
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
});
