import { type SidebarPlace } from "@/shared/tabs";
import { atom, getDefaultStore } from "jotai";

import { type Span, type SteadyPick, steadyPick } from "./drag/landing";

/**
 * What letting go over the sidebar's list would do now, which the list
 * shows: a tab into the group of the row under it, which is ringed; or a
 * place between two rows, where a tab becomes a group of its own, shown by
 * a line between them with every row staying put, and where a whole group
 * lands as it is, in a room opened there, the rows past it moved aside.
 */
export type SidebarDrop =
  | { group: string; kind: "into" }
  | {
      /** The list's item the room opens in front of (`data-drop-item`); none at the list's end. */
      before: string | undefined;
      /** How tall the room is, in the list's px: the row that would land there; none (0) for the line. */
      gap: number;
      kind: "between";
      place: SidebarPlace;
      /** Where the room starts, or the middle of the line, from the list's top in its own px. */
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
      /** A tab, files or a link land in a row's group, or as a group of their own between rows. */
      carries: "tab";
      /** Its own group, which it does not land in. */
      from: string | undefined;
      /**
       * Which gap or row the pointer at a point among the rows picks, timing
       * a rest across measures (`steadyAt`); without one, the gap alone.
       */
      pick?: (at: number, spans: readonly Span[]) => SteadyPick;
    }
  | {
      /** A whole group lands between rows, among the pinned ones or the rest. */
      carries: "group";
      /** The room it takes. */
      gap: number;
    };

/** The gap a point among rows picks with nothing to remember, which never rests on a row. */
function gapAt(at: number, spans: readonly Span[]): SteadyPick {
  return steadyPick({ at, now: 0, spans }).pick;
}

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
 * Where something carried over the sidebar at a point lands. A tab lands as
 * a group of its own in the gap between rows nearest the pointer, the line
 * there moving on once the pointer is a little past a row's middle, among
 * the pinned rows, pinned, or the rest, New's middle parting the two; and
 * in the group of a row whose middle the pointer has rested on (`pick`),
 * never its own. A whole group lands in the room between
 * rows whose edge is nearest, among the pinned rows or the rest. Measured from the list as laid
 * out, so the rows moved aside for a room do not move the room, and in the
 * list's own px, which the window's zoom scales. Over the sidebar but not its
 * list (its search, a project's banner), or over a list showing search,
 * it lands nowhere but is still over the sidebar.
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
    // Over the sidebar above the list (a project's banner), nothing.
    if (!contains(list, x, y)) {
      return { drop: undefined, isOver: true };
    }
    // The rows in the list's order, with New between the pinned and the
    // rest where there are pinned rows, so passing its middle moves the
    // line from the end of one to the start of the other.
    const hasPinned = pinned.length > 0;
    const rows = [...pinned, ...(hasPinned ? [newRow] : []), ...rest];
    const pick = (carry.pick ?? gapAt)(
      at,
      rows.map((each) => ({
        isTakeable: each !== newRow && groupOf(each) !== carry.from,
        size: each.offsetHeight,
        start: top(each),
      })),
    );
    const takes = pick.kind === "into" ? rows[pick.index] : undefined;
    if (takes) {
      return {
        drop: { group: groupOf(takes), kind: "into" },
        isOver: true,
      };
    }
    // The gap as a place in a section: before its row at an index, or at its end.
    const isPinned = hasPinned && pick.index <= pinned.length;
    const section = isPinned ? pinned : rest;
    const index = isPinned
      ? pick.index
      : pick.index - (hasPinned ? pinned.length + 1 : 0);
    const after = section[index - 1];
    const next = section[index];
    const half = LIST_GAP_PX / 2;
    return {
      drop: {
        before: keyOf(next ?? (isPinned ? (divider ?? newRow) : undefined)),
        gap: 0,
        kind: "between",
        place: {
          ...(after ? { after: groupOf(after) } : {}),
          ...(next ? { before: groupOf(next) } : {}),
          pinned: isPinned,
        },
        top: next
          ? top(next) - half
          : after
            ? bottom(after) + half
            : bottom(newRow) + half,
      },
      isOver: true,
    };
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
    before: undefined,
    place: { ...(lastRest ? { after: groupOf(lastRest) } : {}), pinned: false },
    y: lastRest ? bottom(lastRest) : bottom(newRow),
  });

  const nearest = slots.reduce((best, slot) =>
    Math.abs(slot.y - at) < Math.abs(best.y - at) ? slot : best,
  );
  return room(nearest, carry.gap);
}
