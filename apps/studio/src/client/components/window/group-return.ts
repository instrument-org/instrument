import { atom } from "jotai";

/**
 * The group a group just made goes back to as it closes, as a browser's new
 * tab goes back to the tab it was opened from. One at a time, and only until
 * the person goes on to another group (`returnAfterArrival`): `once` for a
 * new empty one, which any switch away ends. For any other, Back from the
 * start of the group's one tab closes the group, as Back closes a tab a link
 * opened (`groupToStepBackTo`).
 */
export interface GroupReturn {
  group: string;
  once: boolean;
  to: string;
}

/**
 * How long a group just made goes back to the one it was made from: `once`
 * until any switch away, `untilUnrelated` until the person goes on to
 * another group.
 */
export type GroupReturns = "once" | "untilUnrelated";

export const groupReturnAtom = atom<GroupReturn | undefined>(undefined);

/** The return still standing as a group comes up. */
export function returnAfterArrival(
  back: GroupReturn | undefined,
  arrived: string,
): GroupReturn | undefined {
  return back?.group === arrived || (back?.to === arrived && !back.once)
    ? back
    : undefined;
}

/**
 * The group Back from the start of `tab` goes back to by closing the tab's
 * group: one made from another, not empty (`once`), while the tab is its only
 * one and the group it goes back to is still in `listed`.
 */
export function groupToStepBackTo(
  back: GroupReturn | undefined,
  tab: undefined | { group?: string; id: string },
  {
    listed,
    tabs,
  }: {
    listed: readonly string[];
    tabs: readonly { group?: string; id: string }[];
  },
): string | undefined {
  if (
    back === undefined ||
    back.once ||
    tab?.group === undefined ||
    back.group !== tab.group ||
    !listed.includes(back.to)
  ) {
    return undefined;
  }
  return tabs.every((each) => each.group !== tab.group || each.id === tab.id)
    ? back.to
    : undefined;
}
