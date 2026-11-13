import { type SidebarPlace } from "@/shared/tabs";
import { atom } from "jotai";

/**
 * What letting go over the sidebar's list would do now, which the list
 * shows: a tab into the group of the row under it, which takes the row's
 * selected tone; a tab as a group of its own at the top of the list, over
 * New or the empty list under the rows, which takes a plain highlight; or,
 * for a whole group, a room opened between two rows, the rows past it moved
 * aside, where the group lands as it is.
 */
export type SidebarDrop =
  | { group: string; kind: "into" }
  | {
      kind: "new";
      /** What lights for it: the New row or the empty list under the rows. */
      over: "empty" | "new";
    }
  | {
      /** The list's item the room opens in front of (`data-drop-item`); none at the list's end. */
      before: string | undefined;
      /** How tall the room is, in the list's px: the row that would land there. */
      gap: number;
      kind: "between";
      place: SidebarPlace;
    };

/** Where a drag over this window's sidebar would land, as last measured. */
export const sidebarDropAtom = atom<SidebarDrop | undefined>(undefined);

/**
 * A tab or a whole group held over this window's sidebar, by the key it is
 * carried under, and where the pointer is in the window's px: the sidebar
 * draws it there as a row, since main's picture of a window shows only where
 * letting go would make one.
 */
export const heldOverSidebarAtom = atom<
  undefined | { clientX: number; clientY: number; key: string }
>(undefined);

/**
 * A row lifted out of the list by the pointer: its group, and where the
 * lifted copy stands, from the list's top in its own px. Its place in the
 * list is shut meanwhile, and the copy is gone while the row is off the
 * sidebar, where main's picture of the window stands in for it.
 */
export const liftedRowAtom = atom<
  undefined | { group: string; isOff: boolean; top: number }
>(undefined);

/**
 * Whether the room opens, moves and shuts at once rather than sliding: as a
 * row lifts out of the place the room takes, and as what was let go fills
 * the room.
 */
export const roomSnapsAtom = atom(false);

/** The group that has just filled a room, which takes its place in the list without arriving. */
export const filledRoomAtom = atom<string | undefined>(undefined);

/** The space between the list's items (`gap-0.5`). */
export const LIST_GAP_PX = 2;

/**
 * The room a group's row takes in the list, its height and the space under
 * it, for a row from another window, which this one has not laid out.
 */
export const ROW_GAP_PX = 52 + LIST_GAP_PX;

/** What is carried over the list, which decides where it can land. */
export type DropCarry =
  | {
      /** A tab lands in a row's group, or as a group of its own at the top. */
      carries: "tab";
      /** Its own group, which it does not land in. */
      from: string | undefined;
    }
  | {
      /** Whether it can be pinned: a chat's group, never a draft's. */
      canPin: boolean;
      /** A whole group lands between rows. */
      carries: "group";
      /** The room it takes. */
      gap: number;
    };

function contains(element: Element, x: number, y: number) {
  const { bottom, left, right, top } = element.getBoundingClientRect();
  return x >= left && x < right && y >= top && y < bottom;
}

/** The list under a point in the window, if the sidebar is under it. */
function groupListAt(x: number, y: number): HTMLElement | undefined {
  const nav = [
    ...document.querySelectorAll<HTMLElement>('nav[aria-label="Tab groups"]'),
  ].find((each) => contains(each, x, y));
  return nav?.querySelector<HTMLElement>("[data-group-list]") ?? undefined;
}

interface Slot {
  before: string | undefined;
  place: SidebarPlace;
  y: number;
}

/**
 * Where something carried over the sidebar at a point lands. A tab lands in
 * the group of the row under it, rows meeting halfway across the space
 * between them, or as a group of its own over New or the empty list under
 * the rows. A whole group lands in the room between rows whose edge is
 * nearest, among the pinned rows or the rest. Measured from the list as laid
 * out, so the rows moved aside for a room do not move the room, and in the
 * list's own px, which the window's zoom scales. Over the sidebar but not its
 * list (its search, a project's banner), or over a list showing search or
 * History, it lands nowhere but is still over the sidebar.
 */
export function sidebarDropAt(
  x: number,
  y: number,
  carry: DropCarry,
): { drop: SidebarDrop | undefined; isOver: boolean } {
  const list = groupListAt(x, y);
  if (!list) {
    const isOver = [
      ...document.querySelectorAll('nav[aria-label="Tab groups"]'),
    ].some((each) => contains(each, x, y));
    return { drop: undefined, isOver };
  }
  const bounds = list.getBoundingClientRect();
  const zoom = list.offsetHeight > 0 ? bounds.height / list.offsetHeight : 1;
  const at = (y - bounds.top) / zoom + list.scrollTop;
  const items = [
    ...list.querySelectorAll<HTMLElement>("[data-drop-item]"),
  ].filter(
    (each) =>
      !each.hasAttribute("data-leaving") && !each.hasAttribute("data-lifted"),
  );
  const top = (each: HTMLElement) => each.offsetTop;
  const bottom = (each: HTMLElement) => each.offsetTop + each.offsetHeight;
  const keyOf = (each: HTMLElement | undefined) => each?.dataset.dropItem;
  const groupOf = (each: HTMLElement) => each.dataset.dropGroup ?? "";
  const pinned = items.filter((each) => each.dataset.dropSection === "pinned");
  const rest = items.filter((each) => each.dataset.dropSection === "rest");
  const newRow = items.find((each) => keyOf(each) === ":new");
  const divider = items.find((each) => keyOf(each) === ":divider");
  const history = items.find((each) => keyOf(each) === ":history");
  if (!newRow) {
    return { drop: undefined, isOver: true };
  }

  if (carry.carries === "tab") {
    const half = LIST_GAP_PX / 2;
    const isIn = (each: HTMLElement) =>
      at >= top(each) - half && at < bottom(each) + half;
    const under = [...pinned, ...rest].find(isIn);
    if (under) {
      const group = groupOf(under);
      return {
        drop: group === carry.from ? undefined : { group, kind: "into" },
        isOver: true,
      };
    }
    if (isIn(newRow)) {
      return { drop: { kind: "new", over: "new" }, isOver: true };
    }
    const empty = list.querySelector<HTMLElement>("[data-drop-empty]");
    const isOverEmpty =
      empty !== null && empty.offsetHeight > 0 && at >= top(empty);
    return {
      drop: isOverEmpty ? { kind: "new", over: "empty" } : undefined,
      isOver: true,
    };
  }

  const slots: Slot[] = [];
  if (carry.canPin) {
    pinned.forEach((each, index) => {
      slots.push({
        before: keyOf(each),
        place: {
          ...(index > 0 ? { after: groupOf(pinned[index - 1] ?? each) } : {}),
          before: groupOf(each),
          pinned: true,
        },
        y: top(each),
      });
    });
    const last = pinned.at(-1);
    slots.push({
      before: keyOf(divider ?? newRow),
      place: { ...(last ? { after: groupOf(last) } : {}), pinned: true },
      y: last ? bottom(last) : top(newRow),
    });
  }
  rest.forEach((each, index) => {
    slots.push({
      before: keyOf(each),
      place: {
        ...(index > 0 ? { after: groupOf(rest[index - 1] ?? each) } : {}),
        before: groupOf(each),
        pinned: false,
      },
      y: top(each),
    });
  });
  const last = rest.at(-1);
  slots.push({
    before: keyOf(history),
    place: { ...(last ? { after: groupOf(last) } : {}), pinned: false },
    y: last ? bottom(last) : bottom(newRow),
  });

  const nearest = slots.reduce((best, slot) =>
    Math.abs(slot.y - at) < Math.abs(best.y - at) ? slot : best,
  );
  return {
    drop: {
      before: nearest.before,
      gap: carry.gap,
      kind: "between",
      place: nearest.place,
    },
    isOver: true,
  };
}
