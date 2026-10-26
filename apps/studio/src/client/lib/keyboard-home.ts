/**
 * Where the keyboard goes when a screen comes up. Each screen marks the part
 * it is worked from with `data-keyboard-home`: a list, whose open or selected
 * row takes the keyboard (its first row when none is), a composer, whose
 * words do, or the element itself. A lower value wins where a screen marks more than one, so a chat's
 * composer goes ahead of the chat list beside it.
 *
 * Coming up by the rail or a place's chord puts the keyboard there, never
 * on the button pressed, so the arrows work on the screen at once.
 */

/** How long a screen has to draw its home after it is asked for, in frames. */
const HOME_WAIT_FRAMES = 30;

const ACTIVE_TAB = "[data-app-tab-active]";

/**
 * Puts the keyboard in the screen on show once it has drawn, unless
 * something on it took the keyboard first (a composer focusing itself as it
 * mounts). `leaving` is a press that changes the screen: the keyboard still
 * in the screen going away waits for the new one rather than counting.
 */
export function focusScreenHome({ leaving }: { leaving: boolean }) {
  const from = document.activeElement;
  let frames = 0;
  const attempt = () => {
    const now = document.activeElement;
    const isOldScreen =
      leaving &&
      now === from &&
      from?.isConnected === true &&
      from.closest(ACTIVE_TAB) !== null;
    if (!isOldScreen && isInScreen(now)) {
      return;
    }
    const home = isOldScreen ? null : homeTarget();
    if (home) {
      home.focus({ preventScroll: true });
      return;
    }
    frames += 1;
    if (frames < HOME_WAIT_FRAMES) {
      requestAnimationFrame(attempt);
    }
  };
  requestAnimationFrame(attempt);
}

/** The element the screen on show is worked from, or null while it has none drawn. */
export function homeTarget(): HTMLElement | null {
  const homes = [
    ...document.querySelectorAll<HTMLElement>(
      `${ACTIVE_TAB} [data-keyboard-home]`,
    ),
  ].filter(isShown);
  homes.sort(
    (a, b) =>
      Number(a.dataset.keyboardHome || 1) - Number(b.dataset.keyboardHome || 1),
  );
  const [home] = homes;
  if (!home) {
    return null;
  }
  return (
    first(home, '[data-open], [role="option"][aria-selected="true"]') ??
    first(home, '[contenteditable="true"]') ??
    (home.hasAttribute("tabindex") ? home : null) ??
    first(home, '[tabindex="0"]') ??
    first(home, "button:not([disabled]), a[href]")
  );
}

/** Whether the keyboard is somewhere a person can see in the screen on show. */
function isInScreen(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element !== document.body &&
    element.closest(ACTIVE_TAB) !== null &&
    isShown(element)
  );
}

function first(root: HTMLElement, selector: string) {
  return (
    [...root.querySelectorAll<HTMLElement>(selector)].find(isShown) ?? null
  );
}

function isShown(element: HTMLElement) {
  return element.checkVisibility({
    opacityProperty: true,
    visibilityProperty: true,
  });
}

/**
 * A list the person is walking with the arrows, which keeps the keyboard
 * while each thing it opens comes up: a composer mounting with the chat
 * stays put. Let go by the next press of the pointer anywhere, or by the
 * keyboard leaving the list.
 */
let walkedList: HTMLElement | null = null;

export function keepKeyboardInList(list: HTMLElement) {
  walkedList = list;
}

export function letGoOfList() {
  walkedList = null;
}

/** Whether something coming up may take the keyboard from where it is. */
export function mayTakeKeyboard() {
  return !(
    walkedList?.isConnected && walkedList.contains(document.activeElement)
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", letGoOfList, { capture: true });
}
