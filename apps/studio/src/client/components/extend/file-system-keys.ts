/**
 * What a key press means to the file browser's listing, decided once for
 * every view. A view answers each command its own way (an arrow walks a grid,
 * a tree or a column), but which press is which command, and which presses
 * are left alone, is the same everywhere.
 */

import { formatAcceleratorTextFor } from "@/shared/format-accelerator";
import {
  type Os,
  OS_CONVENTIONS,
  type OsConventions,
} from "@/shared/os-conventions";

export type ListingDirection = "down" | "left" | "right" | "up";

export type ListingCommand =
  /** ⌘C, or Ctrl+C off the Mac: what is selected, to the clipboard as files. */
  | { type: "copy" }
  /** ⌥⌘C on the Mac, Ctrl+Shift+C on Windows: the paths of what is selected, to the clipboard. */
  | { type: "copy-path" }
  /** ⌘D on the Mac: a copy of what is selected beside it. */
  | { type: "duplicate" }
  /** An arrow; with Shift it reaches from where the selection began. */
  | { direction: ListingDirection; extend: boolean; type: "move" }
  /** ⇧⌘N, or Ctrl+Shift+N off the Mac: a new folder in the one on screen. */
  | { type: "new-folder" }
  /** ⌘O or ⌘↓, or Enter where F2 renames: open what is selected. */
  | { type: "open" }
  /** ⌘↑, or Alt+↑ off the Mac: the folder above the one on screen. */
  | { type: "parent" }
  /** F2 where Enter opens: rename what is selected, where it can be. */
  | { type: "rename" }
  /** Return on the Mac: rename what is selected, or open it where nothing can be renamed. */
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
  code: string;
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

/** Every file manager's Copy: ⌘C, or Ctrl+C off the Mac. */
const COPY_KEY = { alt: false, key: "c", shift: false };

/** ⌘A, or Ctrl+A off the Mac. */
function isSelectAllPress(press: KeyPress, { commandKey }: OsConventions) {
  return (
    press.key.toLowerCase() === "a" &&
    !press.shiftKey &&
    !press.altKey &&
    press[commandKey]
  );
}

/**
 * The file manager's Move to Trash: ⌘⌫ in the Finder, and Delete alone in
 * File Explorer and the Linux file managers. Shift+Delete there skips the
 * Recycle Bin or the Trash, which nothing here does, so it is left alone.
 */
function isTrashPress(
  press: KeyPress,
  { commandKey, files: { trashKey } }: OsConventions,
) {
  if (press.shiftKey || press.altKey) return false;
  const holds = (flag: OsConventions["commandKey"]) =>
    trashKey.withCommandKey && commandKey === flag;
  return (
    press.key === trashKey.key &&
    press.metaKey === holds("metaKey") &&
    press.ctrlKey === holds("ctrlKey")
  );
}

/**
 * A letter held with `commandKey`, and with Alt and Shift exactly as the chord
 * has them. Option rewrites the letter a Mac key types (⌥C is ç), so a chord
 * holding Alt goes by the key's place instead.
 */
function isCommandChordPress(
  press: KeyPress,
  chord: OsConventions["files"]["duplicateKey"],
  { commandKey }: OsConventions,
) {
  if (!chord) return false;
  const typed = chord.alt
    ? press.code === `Key${chord.key.toUpperCase()}`
    : press.key.toLowerCase() === chord.key;
  return (
    typed &&
    press[commandKey] &&
    press.altKey === chord.alt &&
    press.shiftKey === chord.shift
  );
}

/** ⇧⌘N, or Ctrl+Shift+N off the Mac, as every system's file manager has it. */
function isNewFolderPress(press: KeyPress, { commandKey }: OsConventions) {
  return (
    press.key.toLowerCase() === "n" &&
    press.shiftKey &&
    !press.altKey &&
    press[commandKey]
  );
}

/** ↑ with the Finder's ⌘ or the others' Alt, and nothing else held. */
function isParentPress(
  press: KeyPress,
  { files: { parentFolderKey } }: OsConventions,
) {
  const held = (["altKey", "ctrlKey", "metaKey", "shiftKey"] as const).filter(
    (flag) => press[flag],
  );
  return (
    press.key === "ArrowUp" && held.length === 1 && held[0] === parentFolderKey
  );
}

/**
 * The command a press is, or null for one the listing leaves to whoever else
 * wants it: shortcuts it does not know, and arrows with ⌘ or Ctrl other than
 * the ones the system's file manager keeps for going up and down folders.
 * Which keys rename, trash and go up are that file manager's
 * (`os-conventions.ts`).
 */
export function listingCommandOf(
  press: KeyPress,
  os: Os,
): ListingCommand | null {
  const conventions = OS_CONVENTIONS[os];
  if (isSelectAllPress(press, conventions)) return { type: "select-all" };
  if (isTrashPress(press, conventions)) return { type: "trash" };
  if (isNewFolderPress(press, conventions)) return { type: "new-folder" };
  if (isCommandChordPress(press, conventions.files.copyPathKey, conventions)) {
    return { type: "copy-path" };
  }
  if (isCommandChordPress(press, COPY_KEY, conventions)) {
    return { type: "copy" };
  }
  if (isCommandChordPress(press, conventions.files.duplicateKey, conventions)) {
    return { type: "duplicate" };
  }
  if (isParentPress(press, conventions)) return { type: "parent" };
  const command = press[conventions.commandKey];
  if (command && (press.key === "o" || press.key === "ArrowDown")) {
    return { type: "open" };
  }
  // Ctrl on a Mac, the Windows key elsewhere: nothing here is held with it.
  const other =
    press[conventions.commandKey === "metaKey" ? "ctrlKey" : "metaKey"];
  const direction = DIRECTIONS[press.key];
  if (direction) {
    return command || other
      ? null
      : { direction, extend: press.shiftKey, type: "move" };
  }
  if (command || other || press.altKey) return null;
  const { renameKey } = conventions.files;
  if (press.key === "Enter") {
    return renameKey === "Enter" ? { type: "return" } : { type: "open" };
  }
  if (press.key === renameKey) {
    return press.shiftKey ? null : { type: "rename" };
  }
  if (press.key === " ") return { type: "space" };
  // Letters and digits only, so shortcuts and whitespace stay untouched.
  if (press.key.length === 1 && /^[\p{L}\p{N}]$/u.test(press.key)) {
    return { char: press.key.toLowerCase(), type: "type-ahead" };
  }
  return null;
}

/**
 * The keys a menu names beside a row that does what a listing command does,
 * written the way `os` writes them, so the menu teaches the press that
 * `listingCommandOf` answers. Open names ⌘O where Return renames, and Enter
 * where it opens.
 */
export function listingKeys(os: Os) {
  const {
    deleteKey,
    files: { copyPathKey, duplicateKey, renameKey, trashKey },
    keyJoiner,
  } = OS_CONVENTIONS[os];
  const chord = (accelerator: string) =>
    formatAcceleratorTextFor({ accelerator, os });
  const commandChord = (held: OsConventions["files"]["duplicateKey"]) =>
    held &&
    chord(
      `${held.alt ? "Alt+" : ""}${held.shift ? "Shift+" : ""}CmdOrCtrl+${held.key}`,
    );
  return {
    copy: chord("CmdOrCtrl+C"),
    copyPath: commandChord(copyPathKey),
    duplicate: commandChord(duplicateKey),
    newFolder: chord("CmdOrCtrl+Shift+N"),
    open: chord(renameKey === "Enter" ? "CmdOrCtrl+O" : "Enter"),
    paste: chord("CmdOrCtrl+V"),
    preview: chord("Space"),
    rename: chord(renameKey),
    trash: trashKey.withCommandKey
      ? [chord("CmdOrCtrl"), deleteKey].join(keyJoiner)
      : deleteKey,
  };
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
