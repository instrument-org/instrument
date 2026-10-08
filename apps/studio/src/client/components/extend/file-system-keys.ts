/**
 * What a key press means to the file browser's listing, decided once for
 * every view. A view answers each command its own way (an arrow walks a grid,
 * a tree or a column), but which press is which command, and which presses
 * are left alone, is the same everywhere.
 */

export type ListingDirection = "down" | "left" | "right" | "up";

export type ListingCommand =
  /** An arrow; with Shift it reaches from where the selection began. */
  | { direction: ListingDirection; extend: boolean; type: "move" }
  /** ⌘O or ⌘↓: open what is selected. */
  | { type: "open" }
  /** Return: rename what is selected, or open it where nothing can be renamed. */
  | { type: "return" }
  /** ⌘A (Ctrl+A off the Mac): every row the view is walking. */
  | { type: "select-all" }
  /** Space, which is Quick Look's: the page holding the browser answers it, and no row does. */
  | { type: "space" }
  /** ⌘⌫ on the Mac, Delete elsewhere: what is selected, to the Trash. */
  | { type: "trash" }
  /** A letter or digit, which jumps to the next name starting with what was typed. */
  | { char: string; type: "type-ahead" };

type KeyPress = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
};

const DIRECTIONS: Record<string, ListingDirection> = {
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
};

/** ⌘A, or Ctrl+A off the Mac. */
function isSelectAllPress(press: KeyPress, isMac: boolean) {
  return (
    press.key.toLowerCase() === "a" &&
    !press.shiftKey &&
    !press.altKey &&
    (isMac ? press.metaKey : press.ctrlKey)
  );
}

/**
 * ⌘⌫, the Finder's Move to Trash; off the Mac, Delete alone, as Explorer and
 * the Linux file managers have it. Shift+Delete there skips the Recycle Bin
 * or the Trash, which nothing here does, so it is left alone.
 */
function isTrashPress(press: KeyPress, isMac: boolean) {
  if (press.shiftKey || press.altKey) return false;
  return isMac
    ? press.key === "Backspace" && press.metaKey && !press.ctrlKey
    : press.key === "Delete" && !press.metaKey && !press.ctrlKey;
}

/**
 * The command a press is, or null for one the listing leaves to whoever else
 * wants it: shortcuts it does not know, and arrows with ⌘ or Ctrl other than
 * ⌘↓, which the Finder keeps for going up and down folders.
 */
export function listingCommandOf(
  press: KeyPress,
  isMac: boolean,
): ListingCommand | null {
  if (isSelectAllPress(press, isMac)) return { type: "select-all" };
  if (isTrashPress(press, isMac)) return { type: "trash" };
  const command = press.metaKey || press.ctrlKey;
  if (command && (press.key === "o" || press.key === "ArrowDown")) {
    return { type: "open" };
  }
  const direction = DIRECTIONS[press.key];
  if (direction) {
    return command ? null : { direction, extend: press.shiftKey, type: "move" };
  }
  if (command || press.altKey) return null;
  if (press.key === "Enter") return { type: "return" };
  if (press.key === " ") return { type: "space" };
  // Letters and digits only, so shortcuts and whitespace stay untouched.
  if (press.key.length === 1 && /^[\p{L}\p{N}]$/u.test(press.key)) {
    return { char: press.key.toLowerCase(), type: "type-ahead" };
  }
  return null;
}

/** How long typed letters wait for the next before the search starts over, like the Finder's. */
export const TYPE_AHEAD_RESET_MS = 700;

export type TypeAhead = { at: number; typed: string };

export const NO_TYPE_AHEAD: TypeAhead = { at: -Infinity, typed: "" };

/**
 * A letter typed at the listing: added to what was typed a moment ago, or
 * the start of a new search once the pause has run out. A repeated single
 * letter steps past the row the keyboard is on, so pressing it again cycles
 * through every name starting with it; a longer string refines in place.
 * `match` is null when no name starts with what has been typed.
 */
export function typeAhead<T extends { name: string }>({
  char,
  currentIndex,
  entries,
  now,
  state,
}: {
  char: string;
  currentIndex: number;
  entries: readonly T[];
  now: number;
  state: TypeAhead;
}): { match: null | T; state: TypeAhead } {
  const typed =
    (now - state.at > TYPE_AHEAD_RESET_MS ? "" : state.typed) + char;
  const next = { at: now, typed };
  if (entries.length === 0) return { match: null, state: next };
  const start =
    currentIndex < 0 ? 0 : currentIndex + (typed.length === 1 ? 1 : 0);
  for (let step = 0; step < entries.length; step += 1) {
    const entry = entries[(start + step) % entries.length];
    if (entry?.name.toLowerCase().startsWith(typed)) {
      return { match: entry, state: next };
    }
  }
  return { match: null, state: next };
}
