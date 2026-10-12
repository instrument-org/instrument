import { keyboardPlace } from "@/client/lib/keyboard-place";

/**
 * The views with a history of their own inside a tab (what a chat's pane or
 * a draft's band has up), and which one back and forward mean.
 *
 * Back and forward reach the window as commands with no element attached,
 * the way Cmd+T and Cmd+W do, so they are read against the same place
 * (`keyboardPlace()`): with the keyboard in one of these views, the step is
 * that view's, even at the end of its history, where it does nothing, the
 * way a browser's pane does. A page holding the keyboard is asked first,
 * since its `<webview>` is mounted outside every view. With the keyboard in
 * none of them, the step is the window's own.
 *
 * Only views on screen count: every window tab stays mounted, hidden with
 * `visibility`.
 */
type HistorySurface = {
  /** The view's outermost element; null while it is not mounted. */
  anchor: () => Element | null;
  step: (direction: "back" | "forward") => void;
};

const registered: HistorySurface[] = [];

/**
 * The view a step last walked, while nothing has held the keyboard or been
 * pressed since: a step replaces what was up with the caret or the last
 * press in it, and the place would otherwise be nowhere, so the next step
 * would be the window's. Back then forward returns where back left.
 */
let steppedIn: HistorySurface | null = null;
let isListening = false;

function listen() {
  if (isListening) {
    return;
  }
  isListening = true;
  const forget = () => {
    steppedIn = null;
  };
  document.addEventListener("focusin", forget, { capture: true });
  document.addEventListener("pointerdown", forget, { capture: true });
}

/** Adds a view; returns its removal. */
export function registerHistorySurface(surface: HistorySurface): () => void {
  listen();
  registered.push(surface);
  return () => {
    const at = registered.indexOf(surface);
    if (at !== -1) {
      registered.splice(at, 1);
    }
    if (steppedIn === surface) {
      steppedIn = null;
    }
  };
}

/** Steps the view the keyboard is in; false when it is in none. */
export function stepForKeyboard(direction: "back" | "forward"): boolean {
  const place = keyboardPlace();
  if (place === null && steppedIn && isOnScreen(steppedIn)) {
    steppedIn.step(direction);
    return true;
  }
  return stepSurfaceAt(place, direction);
}

/** Steps the view `place` is in, for a press over it; false when it is in none. */
export function stepSurfaceAt(
  place: Element | null,
  direction: "back" | "forward",
): boolean {
  const chosen = surfaceAt(place);
  if (!chosen) {
    return false;
  }
  chosen.step(direction);
  steppedIn = chosen;
  return true;
}

function surfaceAt(place: Element | null) {
  if (place === null) {
    return undefined;
  }
  let inner: { element: Element; surface: HistorySurface } | undefined;
  for (const surface of registered) {
    const element = surface.anchor();
    if (!element?.contains(place) || !isOnScreen(surface)) {
      continue;
    }
    if (!inner || inner.element.contains(element)) {
      inner = { element, surface };
    }
  }
  return inner?.surface;
}

function isOnScreen(surface: HistorySurface) {
  return (
    surface.anchor()?.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    }) ?? false
  );
}
