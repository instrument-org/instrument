import {
  type BrowserTargetId,
  browserTargetOf,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  EMPTY_GUEST_MEMO,
  type GuestMemo,
  reconcileGuests,
} from "./reconcile-guests";

const open = StoreId.TabSchema.parse("tab_01M3G55N35541T2M6SWPS72GMF");
const closed = StoreId.TabSchema.parse("tab_01M3G55N35541T2M6SWPS72GMG");
const visited = StoreId.TabSchema.parse("tab_01M3G55N35541T2M6SWPS72GMH");

const windowGuest = (tab: StoreId.Tab) => browserTargetOf(tab);

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
  const all = [windowGuest(open), windowGuest(closed), windowGuest(visited)];
  /** Each guest held by its tab, as the window has them before any closes. */
  const heldBefore = reconcile(all, {
    heldIds: new Set([open, closed, visited]),
  }).memo;

  it("closes the guests whose tab and visits are gone", () => {
    const result = reconcile(all, {
      heldIds: new Set([open, "screen-1", visited]),
      memo: heldBefore,
    });
    expect(result.close).toMatchInlineSnapshot(`
      [
        "tab_01M3G55N35541T2M6SWPS72GMG",
      ]
    `);
  });

  it("leaves a guest no tab has held yet: an agent's page that has not gone anywhere", () => {
    expect(reconcile([windowGuest(closed)]).close).toEqual([]);
  });

  it("asks for a close once while the guest stays attached, and again once it detached and came back held", () => {
    const first = reconcile([windowGuest(closed)], { memo: heldBefore });
    const second = reconcile([windowGuest(closed)], { memo: first.memo });
    const detached = reconcile([], { memo: second.memo });
    const backHeld = reconcile([windowGuest(closed)], {
      heldIds: new Set([closed]),
      memo: detached.memo,
    });
    const closedAgain = reconcile([windowGuest(closed)], {
      memo: backHeld.memo,
    });

    expect(
      [first, second, detached, backHeld, closedAgain].map(
        (result) => result.close.length,
      ),
    ).toEqual([1, 0, 0, 0, 1]);
  });
});
