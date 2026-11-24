import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { composerWithKeyboard } from "@/client/lib/keyboard-home";
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { getDefaultStore } from "jotai";

import { isTypingInto } from "./is-typing-into";

/** What reads letters as its own, or lies over the side the composer is on. */
const READS_LETTERS = [
  "dialog",
  "alertdialog",
  "menu",
  "menubar",
  "listbox",
  "combobox",
  "tree",
  "grid",
  "application",
  "textbox",
]
  .map((role) => `[role="${role}"]`)
  .join(",");

/** How each composer's editor takes the keyboard, by its editable element. */
const takers = new WeakMap<Element, () => void>();

/**
 * How a composer's editor takes the keyboard for a letter typed elsewhere.
 * A DOM focus alone does not do: the editor puts its caret back a moment
 * later, after the letter has gone in wherever Chromium had the caret.
 */
export function setComposeFocus(editable: Element, take: () => void) {
  takers.set(editable, take);
}

/**
 * A letter typed while the keyboard is in nothing that takes one goes into
 * the composer on show: that of the side with the keyboard, so a side
 * showing a page or a file never types into the chat on the other. The
 * composer takes the keyboard as the key goes down and the key is left
 * alone, so the browser types it, and everything that reads typing (the
 * slash menu, undo) sees an ordinary press.
 *
 * Space stays a button's press and the transcript's scroll, and `?` the
 * shortcut guide's.
 */
export function installTypeToCompose() {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.metaKey ||
      // AltGr, which types characters, reads as Control and Alt on Windows.
      ((event.ctrlKey || event.altKey) &&
        !event.getModifierState("AltGraph")) ||
      event.key.length !== 1 ||
      event.key === " " ||
      event.key === SHORTCUT_GUIDE.accelerator ||
      isTypingInto(event.target) ||
      (event.target instanceof Element &&
        event.target.closest(READS_LETTERS) !== null) ||
      // A menu, popover or dialog is up, whatever has the keyboard.
      document.querySelector("[data-radix-focus-guard]") !== null ||
      getDefaultStore().get(windowHoldsAtom).length > 0
    ) {
      return;
    }
    const composer = composerWithKeyboard();
    if (composer) {
      takers.get(composer)?.();
    }
  };
  // Bubbling, after whatever on the way up takes the letter for itself, as a
  // list of files does to find a name.
  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
  };
}
