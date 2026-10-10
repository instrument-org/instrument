/**
 * Where the person is in the window's document, for a chord whose meaning
 * depends on it (Cmd+F finds in that surface): the element holding focus, or,
 * when focus has fallen back to the body (a click on blank space, a pane's
 * padding, a non-focusable row), the element last pressed.
 *
 * A browser page is not in this document: its `<webview>` is mounted on the
 * body, away from the panel that shows it, so a caller asks
 * `pageHoldingKeyboard()` first.
 */
export function keyboardPlace(): Element | null {
  listen();
  return placeOf({ focused: document.activeElement, pressed: lastPressed });
}

/** The choice behind {@link keyboardPlace}, given what it reads. */
export function placeOf({
  focused,
  pressed,
}: {
  focused: Element | null;
  pressed: Element | null;
}): Element | null {
  if (focused && focused !== focused.ownerDocument.body) {
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
