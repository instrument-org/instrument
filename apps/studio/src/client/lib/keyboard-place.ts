import {
  type BrowserTargetId,
  browserTargetOf,
} from "@instrument-org/workspace/client";

/**
 * The side of the tab group on screen that has the keyboard, which every
 * chord meaning "the tab up" acts on, whatever holds the caret. Null while
 * no tab group is on screen.
 */
export function keyboardSide(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "[data-app-tab-active] [data-group-side][data-keyboard]",
  );
}

/**
 * The page up on a side of a tab group: the page tab the side names while it
 * shows one, or the page a file tab draws its file as (an HTML file), whose
 * slot names it.
 */
export function pageOfSide(side: Element): BrowserTargetId | null {
  const tab =
    side.getAttribute("data-page-tab") ??
    side
      .querySelector("[data-hosted-page-tab]")
      ?.getAttribute("data-hosted-page-tab");
  return tab == null ? null : browserTargetOf(tab);
}

/** Whether an element is on the side of a tab group that does not have the keyboard. */
export function isOnSideWithoutKeyboard(element: Element) {
  const side = element.closest("[data-group-side]");
  return side !== null && !side.hasAttribute("data-keyboard");
}

/**
 * Whether a page is up on a side of the tab group on screen that does not
 * have the keyboard, which the page may then not hold: the keyboard is in
 * the side that has it, whatever a page does on its own.
 */
export function isPageOnSideWithoutKeyboard(targetId: BrowserTargetId) {
  return [
    ...document.querySelectorAll(
      "[data-app-tab-active] [data-group-side]:not([data-keyboard])",
    ),
  ].some((side) => pageOfSide(side) === targetId);
}

/**
 * Where the person is in the window's document, for a chord whose meaning
 * depends on it (Cmd+F finds in that surface): the element holding focus, or,
 * when focus is on nothing in the side with the keyboard (fallen back to the
 * body, left in the sidebar, or on the other side), that side, and with no
 * tab group on screen, the element last pressed.
 *
 * A browser page is not in this document: its `<webview>` is mounted on the
 * body, away from the panel that shows it, so a caller asks
 * `pageHoldingKeyboard()` first.
 */
export function keyboardPlace(): Element | null {
  listen();
  return placeOf({
    focused: document.activeElement,
    pressed: lastPressed,
    side: keyboardSide(),
  });
}

/** The choice behind {@link keyboardPlace}, given what it reads. */
export function placeOf({
  focused,
  pressed,
  side = null,
}: {
  focused: Element | null;
  pressed: Element | null;
  /** The side of the tab group on screen with the keyboard, if one is. */
  side?: Element | null;
}): Element | null {
  const isFocused = focused !== null && focused !== focused.ownerDocument.body;
  if (side !== null) {
    // A dialog or menu over the window holds the caret above every side.
    return isFocused &&
      (side.contains(focused) ||
        focused.closest("[role=dialog], [role=alertdialog], [role=menu]"))
      ? focused
      : side;
  }
  if (isFocused) {
    return focused;
  }
  return pressed?.isConnected ? pressed : null;
}

let lastPressed: Element | null = null;
let isListening = false;

function listen() {
  if (isListening) {
    return;
  }
  isListening = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      lastPressed = event.target instanceof Element ? event.target : null;
    },
    { capture: true },
  );
}

/** Starts reading presses before the first chord asks, so the first one already knows. */
export function listenForKeyboardPlace() {
  listen();
}
