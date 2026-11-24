import { atom } from "jotai";

/**
 * The group a group just made goes back to as it closes, as a browser's new
 * tab goes back to the tab it was opened from. One at a time, and only until
 * the person goes on to another group (`returnAfterArrival`): `once` for a
 * new empty one, which any switch away ends.
 */
export interface GroupReturn {
  group: string;
  once: boolean;
  to: string;
}

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
