import { type SidebarPlace } from "@/shared/tabs";
import { atom, getDefaultStore } from "jotai";

/**
 * What letting go over the sidebar's list would do now, which the list
 * shows: a tab into the group of the row under it, which takes a quiet
 * fill; or a room opened between two rows, the rows past it moved aside,
 * where a whole group lands as it is and a tab as a group of its own, drawn
 * standing in it as that group's row.
 */
export type SidebarDrop =
  | { group: string; kind: "into" }
  | {
      /** The list's item the room opens in front of (`data-drop-item`); none at the list's end. */
      before: string | undefined;
      /** How tall the room is, in the list's px: the row that would land there. */
      gap: number;
      kind: "between";
      place: SidebarPlace;
      /** Where the room starts, from the list's top in its own px. */
      top: number;
    };

/** Where a drag over this window's sidebar would land, as last measured. */
export const sidebarDropAtom = atom<SidebarDrop | undefined>(undefined);

/**
 * Whether the room opens, moves and shuts at once rather than sliding: as a
 * row lifts out of the place the room takes, and as what was let go fills
 * the room.
 */
export const roomSnapsAtom = atom(false);

/** The group that has just filled a room, which takes its place in the list without arriving. */
export const filledRoomAtom = atom<string | undefined>(undefined);

/**
 * Shows where a drag over this window's sidebar lands, or that it lands
 * nowhere there, the room sliding to it.
 */
export function showDrop(drop: SidebarDrop | undefined) {
  const store = getDefaultStore();
  if (JSON.stringify(store.get(sidebarDropAtom)) !== JSON.stringify(drop)) {
    store.set(roomSnapsAtom, false);
    store.set(sidebarDropAtom, drop);
  }
}

/** How long a group that filled a room goes on not arriving. */
const FILLED_MS = 500;

/**
 * Shuts the sidebar's room at once, for what was let go in it, which
 * stands where the room was: a lifted row back in the list, or a group new
 * to it, which takes its place without arriving.
 */
export function fillRoom(group: string | undefined) {
  const store = getDefaultStore();
  store.set(roomSnapsAtom, true);
  store.set(sidebarDropAtom, undefined);
  if (group === undefined) {
    return;
  }
  store.set(filledRoomAtom, group);
  setTimeout(() => {
    if (store.get(filledRoomAtom) === group) {
      store.set(filledRoomAtom, undefined);
    }
  }, FILLED_MS);
}

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
      /** A tab, or files, land in a row's group, or as a group of their own in a room. */
      carries: "tab";
      /** Its own group, which it does not land in. */
      from: string | undefined;
    }
  | {
      /** A whole group lands between rows, among the pinned ones or the rest. */
      carries: "group";
      /** The room it takes. */
      gap: number;
    };

/**
 * How far into an unpinned row from its edge a tab held there opens a room
 * beside it, where it becomes a group of its own, rather than joining it.
 */
const ROOM_BAND_PX = 8;

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
  /** The item the room opens in front of; none at the list's end. */
  before: HTMLElement | undefined;
  place: SidebarPlace;
  y: number;
}

/**
 * Where something carried over the sidebar at a point lands. A tab lands in
 * the group of the row under it, rows meeting halfway across the space
 * between them, or as a group of its own in a room: near the line between
 * two rows, or at the first or last row's outer edge, among the pinned rows,
 * pinned, or the rest; over New, at the top of the rest; and over History
 * or the empty list under the rows, at their end. A whole group lands in the room between
 * rows whose edge is nearest, among the pinned rows or the rest. Measured from the list as laid
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
  const last = items.at(-1) ?? newRow;
  const room = ({ before, place }: Omit<Slot, "y">, gap: number) => ({
    drop: {
      before: keyOf(before),
      gap,
      kind: "between" as const,
      place,
      top: before ? top(before) : bottom(last) + LIST_GAP_PX,
    },
    isOver: true,
  });

  if (carry.carries === "tab") {
    const half = LIST_GAP_PX / 2;
    const isIn = (each: HTMLElement) =>
      at >= top(each) - half && at < bottom(each) + half;
    const into = (row: HTMLElement) => {
      const group = groupOf(row);
      return {
        drop:
          group === carry.from ? undefined : { group, kind: "into" as const },
        isOver: true,
      };
    };
    // The room in front of a section's row at an index, or at its end.
    const roomAt = (section: HTMLElement[], index: number) => {
      const isPinned = section === pinned;
      const after = section[index - 1];
      const next = section[index];
      return room(
        {
          before: next ?? (isPinned ? (divider ?? newRow) : history),
          place: {
            ...(after ? { after: groupOf(after) } : {}),
            ...(next ? { before: groupOf(next) } : {}),
            pinned: isPinned,
          },
        },
        ROW_GAP_PX,
      );
    };
    for (const section of [pinned, rest]) {
      const index = section.findIndex(isIn);
      const under = section[index];
      if (!under) {
        continue;
      }
      if (at < top(under) + ROOM_BAND_PX) {
        return roomAt(section, index);
      }
      if (at >= bottom(under) - ROOM_BAND_PX) {
        return roomAt(section, index + 1);
      }
      return into(under);
    }
    if (isIn(newRow)) {
      return roomAt(rest, 0);
    }
    if (history && isIn(history)) {
      return roomAt(rest, rest.length);
    }
    const empty = list.querySelector<HTMLElement>("[data-drop-empty]");
    const isOverEmpty =
      empty !== null && empty.offsetHeight > 0 && at >= top(empty);
    return isOverEmpty
      ? roomAt(rest, rest.length)
      : { drop: undefined, isOver: true };
  }

  const slots: Slot[] = [];
  pinned.forEach((each, index) => {
    slots.push({
      before: each,
      place: {
        ...(index > 0 ? { after: groupOf(pinned[index - 1] ?? each) } : {}),
        before: groupOf(each),
        pinned: true,
      },
      y: top(each),
    });
  });
  const lastPinned = pinned.at(-1);
  slots.push({
    before: divider ?? newRow,
    place: {
      ...(lastPinned ? { after: groupOf(lastPinned) } : {}),
      pinned: true,
    },
    y: lastPinned ? bottom(lastPinned) : top(newRow),
  });
  rest.forEach((each, index) => {
    slots.push({
      before: each,
      place: {
        ...(index > 0 ? { after: groupOf(rest[index - 1] ?? each) } : {}),
        before: groupOf(each),
        pinned: false,
      },
      y: top(each),
    });
  });
  const lastRest = rest.at(-1);
  slots.push({
    before: history,
    place: { ...(lastRest ? { after: groupOf(lastRest) } : {}), pinned: false },
    y: lastRest ? bottom(lastRest) : bottom(newRow),
  });

  const nearest = slots.reduce((best, slot) =>
    Math.abs(slot.y - at) < Math.abs(best.y - at) ? slot : best,
  );
  return room(nearest, carry.gap);
}
