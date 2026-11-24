import { ShortcutKeys } from "@/client/components/shortcut-keys";
import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { commandKeyHeld } from "@/client/lib/utils";
import { isTypingInto } from "@/client/lib/is-typing-into";
import { getDefaultStore } from "jotai";
import { useSyncExternalStore } from "react";

/** Whether each editor that says so has anything of its own to undo. */
const ownUndos = new WeakMap<Element, () => boolean>();

/** Lets ⌘Z past an editor while it has nothing of its own to undo. */
export function setOwnUndo(editable: Element, hasUndo: () => boolean) {
  ownUndos.set(editable, hasUndo);
}

/**
 * Whether ⌘Z is free for a toast's Undo: the keyboard is in nothing that
 * undoes for itself, and nothing lies over the window. A field keeps its own
 * ⌘Z, and so does a composer once anything was written in it, sent or
 * cleared words included. One not written in yet, which takes the keyboard
 * as its chat comes up, lets the key past.
 */
function isUndoKeyFree() {
  const held = document.activeElement;
  return (
    (!isTypingInto(held) ||
      (held !== null && ownUndos.get(held)?.() === false)) &&
    held?.tagName !== "WEBVIEW" &&
    held?.closest('[role="dialog"]') == null &&
    document.querySelector("[data-radix-focus-guard]") === null &&
    getDefaultStore().get(windowHoldsAtom).length === 0
  );
}

/**
 * The Undo that ⌘Z presses: the newest toast's, while it shows the keys. Read
 * off the screen, so a toast that has gone, or lies under another, is never
 * undone by a key that nothing on screen names.
 */
export function undoOnShow() {
  return (
    document
      .querySelector(
        '[data-sonner-toast][data-front="true"]:not([data-removed="true"]) [data-undo-keys]',
      )
      ?.closest("button") ?? null
  );
}

/** ⌘Z presses the Undo of the toast on show. */
export function installUndoKey() {
  // Read before the press reaches anything: an editor that takes it may have
  // nothing left to undo by the time the window hears it.
  let wasFree = false;
  const before = () => {
    wasFree = isUndoKeyFree();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const isTaken =
      event.defaultPrevented &&
      // An editor keeps the press from the browser with nothing to undo too.
      !(event.target instanceof Element && ownUndos.has(event.target));
    if (
      isTaken ||
      !wasFree ||
      event.repeat ||
      event.shiftKey ||
      event.altKey ||
      !commandKeyHeld(event) ||
      event.key.toLowerCase() !== "z"
    ) {
      return;
    }
    const undo = undoOnShow();
    if (undo) {
      event.preventDefault();
      undo.click();
    }
  };
  window.addEventListener("keydown", before, true);
  // Bubbling, after a grid or an editor that takes the key for itself.
  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("keydown", before, true);
    window.removeEventListener("keydown", onKeyDown);
  };
}

function followKeyboard(onChange: () => void) {
  // A blur is heard before the keyboard has landed, and a dialog's guards and
  // a hold on the window come and go around a focus too.
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onChange);
  };
  document.addEventListener("focusin", later);
  document.addEventListener("focusout", later);
  // Writing the first words in a composer gives it something to undo.
  document.addEventListener("keyup", later);
  document.addEventListener("input", later);
  const unsubscribe = getDefaultStore().sub(windowHoldsAtom, onChange);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("focusin", later);
    document.removeEventListener("focusout", later);
    document.removeEventListener("keyup", later);
    document.removeEventListener("input", later);
    unsubscribe();
  };
}

function UndoLabel() {
  const isKeyFree = useSyncExternalStore(followKeyboard, isUndoKeyFree);
  return (
    <span className="inline-flex items-center gap-1.5">
      Undo
      {isKeyFree && (
        <span aria-hidden className="-mr-1" data-undo-keys>
          <ShortcutKeys accelerator="CmdOrCtrl+Z" />
        </span>
      )}
    </span>
  );
}

/** The label of a toast's Undo, with its keys while they would press it. */
export const UNDO_LABEL = <UndoLabel />;
