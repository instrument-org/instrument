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
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { resolveAccelerator } from "@/shared/shortcuts";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";

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
  /** A character, which jumps to the name closest to what has been typed. */
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
  // One character a name could have in it. `key` is a word for everything
  // else (Tab, F5, Dead, Process), and the window keeps the guide's own key.
  if (/^\P{C}$/u.test(press.key) && press.key !== SHORTCUT_GUIDE.accelerator) {
    return { char: press.key, type: "type-ahead" };
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
    info: chord(
      resolveAccelerator(WINDOW_SHORTCUTS.fileInfo.accelerator, {
        isMac: os === "mac",
      }),
    ),
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

/**
 * How long a typed character waits for the next before the search starts over:
 * twice the Mac's default key repeat delay, the wait its file manager takes.
 */
export const TYPE_AHEAD_RESET_MS = 1000;

export type TypeAhead = { at: number; typed: string };

export const NO_TYPE_AHEAD: TypeAhead = { at: -Infinity, typed: "" };

/** Whether what was typed a moment ago is still being added to. */
export function isTypingAhead(state: TypeAhead, now: number) {
  return state.typed !== "" && now - state.at <= TYPE_AHEAD_RESET_MS;
}

const ENDS_TYPE_AHEAD = new Set(["Backspace", "Escape", "Tab"]);

/** Whether a press throws away what has been typed, so the next character starts over. */
export function endsTypeAhead({ key }: Pick<KeyPress, "key">) {
  return ENDS_TYPE_AHEAD.has(key);
}

/**
 * The order names are searched in. Case, width and how an accent is encoded
 * make no difference, and an accented letter sorts right after its bare one,
 * so "ec" reaches "Éclair" and "strass" reaches "straße".
 */
const NAME_ORDER = new Intl.Collator(undefined, { sensitivity: "accent" });

/**
 * A character typed at the listing: added to what was typed a moment ago, or
 * the start of a new search once the pause has run out. It lands on the first
 * name at or after what has been typed in alphabetical order, wherever the
 * view shows that name, or on the last name when none is that late in the
 * alphabet. So a misspelled name still lands beside the right one, and a letter
 * pressed again stays where it is. `match` is null only with no names at all.
 */
export function typeAhead<T extends { name: string }>({
  char,
  entries,
  now,
  state,
}: {
  char: string;
  entries: readonly T[];
  now: number;
  state: TypeAhead;
}): { match: null | T; state: TypeAhead } {
  const typed = (isTypingAhead(state, now) ? state.typed : "") + char;
  const isEarlier = (a: T, b: T) => NAME_ORDER.compare(a.name, b.name) < 0;
  let closest: null | T = null;
  let last: null | T = null;
  for (const entry of entries) {
    if (last === null || isEarlier(last, entry)) last = entry;
    if (
      NAME_ORDER.compare(entry.name, typed) >= 0 &&
      (closest === null || isEarlier(entry, closest))
    ) {
      closest = entry;
    }
  }
  return { match: closest ?? last, state: { at: now, typed } };
}
