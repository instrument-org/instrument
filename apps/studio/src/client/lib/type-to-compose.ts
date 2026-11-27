import { isWindowHeld } from "@/client/atoms/tab-navigation-block";
import { composerWithKeyboard } from "@/client/lib/keyboard-home";

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
 * The composer that what is typed or pasted at `target` belongs to: the one
 * on show in the side with the keyboard, so a side showing a page or a file
 * never sends either into the chat on the other. None when `target` takes
 * typing or pasting for itself, or something lies over the side.
 */
function composerFor(target: EventTarget | null) {
  if (
    isTypingInto(target) ||
    (target instanceof Element && target.closest(READS_LETTERS) !== null) ||
    // A web page's keys and pastes are its own.
    document.activeElement?.tagName === "WEBVIEW" ||
    // A menu, popover or dialog is up, whatever has the keyboard.
    document.querySelector("[data-radix-focus-guard]") !== null ||
    isWindowHeld()
  ) {
    return null;
  }
  return composerWithKeyboard();
}

/**
 * A letter typed, or a paste made, while the keyboard is in nothing that
 * takes one goes into the composer (`composerFor`). The composer takes the
 * keyboard as the key goes down and the key is left alone, so the browser
 * types it, and everything that reads typing (the slash menu, undo) sees an
 * ordinary press. A paste already has its target, so it is made again on the
 * composer, which reads files, pictures and long text as it always does.
 *
 * Space stays a button's press and the transcript's scroll.
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
      event.key === " "
    ) {
      return;
    }
    const composer = composerFor(event.target);
    if (composer) {
      takers.get(composer)?.();
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    if (event.defaultPrevented || !event.clipboardData?.types.length) {
      return;
    }
    const composer = composerFor(event.target);
    const take = composer && takers.get(composer);
    if (!take) {
      return;
    }
    event.preventDefault();
    take();
    composer.dispatchEvent(
      new ClipboardEvent("paste", {
        cancelable: true,
        clipboardData: event.clipboardData,
      }),
    );
  };
  // Bubbling, after whatever on the way up takes the letter or the paste for
  // itself, as a list of files does to find a name.
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("paste", onPaste);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("paste", onPaste);
  };
}
