/**
 * What is selected in the file browser, and every way a press or a key can
 * change it, as plain data and functions of it. Nothing here knows about
 * React, the DOM or which view drew the rows: a view says what was pressed
 * and in what order its rows stand, and gets the next selection back.
 */

/** Several selected, held beside the one the keyboard is on. */
export type SeveralSelected = {
  /** Where a Shift-click or Shift-arrow reaches from. */
  anchor: string;
  /** All of them, in the order they were picked. */
  paths: readonly string[];
  /** What the last reach from the anchor took, which the next one replaces. */
  range: readonly string[];
};

export type Selection = {
  /** The one the keyboard is on, the last picked. */
  lead: null | string;
  /** Several, when ⌘ or Shift made it several; it stands only while it holds `lead`. */
  several: null | SeveralSelected;
};

/** A press or key that adds to the selection rather than replacing it: Shift reaches, ⌘ picks one more. */
export type SelectionMode = "extend" | "toggle";

export const NOTHING_SELECTED: Selection = { lead: null, several: null };

/**
 * The selection as it stands. Several held beside a lead they do not include
 * are stale (a caller moved the lead onto something it just made or renamed),
 * and moving the lead to one thing is a selection of that one.
 */
export function normalizeSelection(selection: Selection): Selection {
  const { lead, several } = selection;
  if (lead === null) {
    return several === null ? selection : NOTHING_SELECTED;
  }
  return several === null || several.paths.includes(lead)
    ? selection
    : { lead, several: null };
}

/** Everything selected, the lead among it. */
export function selectedPathsOf(selection: Selection): readonly string[] {
  const { lead, several } = normalizeSelection(selection);
  if (lead === null) return [];
  return several?.paths ?? [lead];
}

export function sameSelection(left: Selection, right: Selection) {
  if (left.lead !== right.lead) return false;
  if (left.several === right.several) return true;
  if (!left.several || !right.several) return false;
  return (
    left.several.anchor === right.several.anchor &&
    sameList(left.several.paths, right.several.paths) &&
    sameList(left.several.range, right.several.range)
  );
}

function sameList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

/** One thing alone, or nothing. */
export function selectOnly(path: null | string): Selection {
  return path === null ? NOTHING_SELECTED : { lead: path, several: null };
}

/**
 * Exactly these, the way ⌘A takes a folder: the lead stays where it is when
 * it is among them, and is the first of them otherwise.
 */
export function selectExactly(
  current: Selection,
  paths: readonly string[],
): Selection {
  const first = paths[0];
  if (first === undefined) return NOTHING_SELECTED;
  const lead =
    current.lead !== null && paths.includes(current.lead)
      ? current.lead
      : first;
  return paths.length > 1
    ? { lead, several: { anchor: first, paths, range: paths } }
    : { lead, several: null };
}

/** A ⌘-click: one more picked, or one let go and the last picked before it leads. */
export function toggleSelected(current: Selection, path: string): Selection {
  const held = selectedPathsOf(current);
  if (!held.includes(path)) {
    const paths = [...held, path];
    return paths.length > 1
      ? { lead: path, several: { anchor: path, paths, range: [path] } }
      : { lead: path, several: null };
  }
  const rest = held.filter((each) => each !== path);
  const lead = rest.at(-1);
  if (lead === undefined) return NOTHING_SELECTED;
  return rest.length > 1
    ? { lead, several: { anchor: lead, paths: rest, range: [lead] } }
    : { lead, several: null };
}

/**
 * A Shift-click or Shift-arrow: from the anchor to this one in the order the
 * view draws its rows, in place of the reach the last one took from there,
 * keeping whatever ⌘ picked besides, the way every Mac list does it. With no
 * anchor in that order, it is a plain selection of this one.
 */
export function extendSelected(
  current: Selection,
  path: string,
  order: readonly string[],
): Selection {
  const normal = normalizeSelection(current);
  const held = selectedPathsOf(normal);
  const anchor = normal.several?.anchor ?? normal.lead;
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(path);
  if (anchor === null || from === -1 || to === -1) {
    return selectOnly(path);
  }
  const range =
    from <= to
      ? order.slice(from, to + 1)
      : order.slice(to, from + 1).reverse();
  const previousRange = normal.several?.range ?? [anchor];
  const paths = [
    ...held.filter(
      (each) => !previousRange.includes(each) && !range.includes(each),
    ),
    ...range,
  ];
  return paths.length > 1
    ? { lead: path, several: { anchor, paths, range } }
    : { lead: path, several: null };
}

/** A press or key on one row: alone, or with the modifier it carried. */
export function selectWithMode(
  current: Selection,
  path: string,
  mode: null | SelectionMode,
  order: readonly string[],
): Selection {
  if (mode === "toggle") return toggleSelected(current, path);
  if (mode === "extend") return extendSelected(current, path, order);
  return selectOnly(path);
}

/**
 * What is left once a search, a filter or a re-read takes some of the
 * selection off the screen, so an action on the selection never reaches a row
 * nobody can see. The same selection when all of it is still shown.
 */
export function keepShown(
  current: Selection,
  isShown: (path: string) => boolean,
): Selection {
  const held = selectedPathsOf(current);
  if (held.every(isShown)) return current;
  return selectExactly(current, held.filter(isShown));
}
