/**
 * Where the keyboard is in the app window, kept by three rules:
 *
 * - Each screen marks the parts it is worked from with `data-keyboard-home`:
 *   a list, whose open or selected row takes the keyboard (its first row
 *   when none is), a composer, whose words do, or the element itself. A
 *   lower value wins where more than one is on show, so a chat's composer
 *   goes ahead of the chat list beside it, and the file list ahead of the
 *   page beside it. A part the window cannot focus itself (a page, drawn by
 *   a guest of its own) says how with `setHomeFocus`.
 * - A press of the pointer on a button leaves the keyboard where it was, as
 *   a Mac's buttons do: the rail, a toolbar's toggle, a tab. Tab still
 *   reaches every one.
 * - The keyboard left on nothing a person can see (a column put away, a
 *   screen gone) goes to the home of the screen on show.
 */

/** How long a screen has to draw its home after it is asked for, in frames. */
const HOME_WAIT_FRAMES = 30;

const ACTIVE_TAB = "[data-app-tab-active]";

/** Homes the window cannot put the keyboard in by focusing them, with how to. */
const homeFocus = new WeakMap<Element, () => void>();

/** How to put the keyboard in a home that is not focusable itself, such as the element a page is drawn into. */
export function setHomeFocus(home: Element, focus: () => void) {
  homeFocus.set(home, focus);
  return () => {
    if (homeFocus.get(home) === focus) {
      homeFocus.delete(home);
    }
  };
}

/**
 * Puts the keyboard in the screen on show once it has drawn, unless
 * something on it took the keyboard first (a composer focusing itself as it
 * mounts), or, when the keyboard was on nothing, anything a person can see
 * took it (a draft's window along the foot). `leaving` is a press that
 * changes the screen: the keyboard still in the screen going away waits for
 * the new one rather than counting.
 */
export function focusScreenHome({ leaving }: { leaving: boolean }) {
  const from = document.activeElement;
  const fromNothing = from === null || from === document.body;
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
    if (
      fromNothing &&
      now instanceof HTMLElement &&
      now !== document.body &&
      isShown(now)
    ) {
      return;
    }
    const home = isOldScreen ? null : homeOnShow();
    const focus = home && homeFocus.get(home);
    if (focus) {
      focus();
      return;
    }
    // A home whose rows are still on their way is waited for too.
    const target = home && targetIn(home);
    if (target) {
      focusQuietly(target);
      return;
    }
    frames += 1;
    if (frames < HOME_WAIT_FRAMES) {
      requestAnimationFrame(attempt);
    }
  };
  requestAnimationFrame(attempt);
}

/**
 * Focuses a home with no ring until the next key press: nobody moved the
 * keyboard there, so the ring would mark a place the person is not looking
 * at. `data-quiet-focus` hides it (`globals.css`), since Chromium draws the
 * ring on a script's focus while nothing else has been interacted with and
 * does not honor `focus({ focusVisible: false })`. A composer keeps no mark:
 * its caret shows where the keyboard is either way.
 */
function focusQuietly(target: HTMLElement) {
  if (target.isContentEditable) {
    target.focus({ preventScroll: true });
    return;
  }
  const controller = new AbortController();
  const unmark = () => {
    target.removeAttribute("data-quiet-focus");
    controller.abort();
  };
  target.setAttribute("data-quiet-focus", "");
  target.focus({ preventScroll: true });
  window.addEventListener("keydown", unmark, {
    capture: true,
    signal: controller.signal,
  });
  target.addEventListener("blur", unmark, { signal: controller.signal });
}

/** The part of the screen on show it is worked from, or null while it has none drawn. */
function homeOnShow(): HTMLElement | null {
  const homes = [
    ...document.querySelectorAll<HTMLElement>(
      `${ACTIVE_TAB} [data-keyboard-home]`,
    ),
  ].filter(isShown);
  homes.sort(
    (a, b) =>
      Number(a.dataset.keyboardHome || 1) - Number(b.dataset.keyboardHome || 1),
  );
  return homes[0] ?? null;
}

/** Where in a home the keyboard goes. */
function targetIn(home: HTMLElement): HTMLElement | null {
  return (
    first(home, '[data-open], [role="option"][aria-selected="true"]') ??
    first(home, '[contenteditable="true"]') ??
    (home.hasAttribute("tabindex") ? home : null) ??
    first(home, '[tabindex="0"]') ??
    first(home, "button:not([disabled]), a[href]")
  );
}

/**
 * Whether the keyboard is somewhere a person can see in the screen on show,
 * a page beside it included, whose guest is drawn outside the screen's own
 * elements.
 */
function isInScreen(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element !== document.body &&
    (element.closest(ACTIVE_TAB) !== null || element.tagName === "WEBVIEW") &&
    isShown(element)
  );
}

function first(root: HTMLElement, selector: string) {
  return (
    [...root.querySelectorAll<HTMLElement>(selector)].find(isShown) ?? null
  );
}

/**
 * Drawn, and not in a part of the screen put out of reach (`inert`).
 * Opacity does not count: a popover or menu fades in from zero, and the
 * keyboard its opening put in it is not gone.
 */
function isShown(element: HTMLElement) {
  return (
    element.closest("[inert]") === null &&
    element.checkVisibility({ visibilityProperty: true })
  );
}

/** How long something that just opened waits for a menu or dialog to go before it takes the keyboard, in frames. */
const LAYER_WAIT_FRAMES = 60;

/**
 * Puts the keyboard in something that just opened, such as a draft's prompt,
 * once the menu or dialog it was chosen from has gone. While one is up its
 * focus trap pulls the keyboard back into it, and as it goes it hands the
 * keyboard back to what opened it on a timer, so a focus made as the new
 * thing mounts does not last. Radix marks the window with its focus guards
 * while a modal layer is up; once they are gone, a timer of its own runs
 * after the layer's. Nothing moves when `holds` says the keyboard is already
 * there, or once the person presses a key or the pointer. Returns a way to
 * give up.
 */
export function focusOnceLayersClose({
  focus,
  holds,
}: {
  focus: () => void;
  holds: () => boolean;
}) {
  const controller = new AbortController();
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    controller.abort();
  };
  window.addEventListener("pointerdown", stop, {
    capture: true,
    signal: controller.signal,
  });
  window.addEventListener("keydown", stop, {
    capture: true,
    signal: controller.signal,
  });
  let frames = 0;
  const attempt = () => {
    frames += 1;
    if (document.querySelector("[data-radix-focus-guard]") === null) {
      timer = setTimeout(() => {
        if (!holds()) {
          focus();
        }
        stop();
      });
    } else if (frames < LAYER_WAIT_FRAMES) {
      frame = requestAnimationFrame(attempt);
    } else {
      stop();
    }
  };
  frame = requestAnimationFrame(attempt);
  return stop;
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

/**
 * The window's side of the rules above, for the app window to install once:
 * a button pressed leaves the keyboard where it was, and a keyboard left on
 * nothing a person can see goes home.
 */
export function installKeyboardHome() {
  const controller = new AbortController();
  const { signal } = controller;
  // Whether the press now ending was on a button, which leaves the keyboard
  // where it was; a page beside the screen loses it all the same, since its
  // guest gives the keyboard up to any press in the window.
  let pressedButton = false;
  window.addEventListener("pointerdown", letGoOfList, {
    capture: true,
    signal,
  });
  window.addEventListener(
    "mousedown",
    (event) => {
      const button =
        event.button === 0 && event.target instanceof Element
          ? event.target.closest("button")
          : null;
      // A button that drags, as a tab of the strip does, needs the press, and
      // so does a tab of a tab list, which is picked on it.
      if (
        button &&
        !button.closest('[draggable="true"]') &&
        button.getAttribute("role") !== "tab"
      ) {
        event.preventDefault();
        pressedButton = true;
      }
    },
    { capture: true, signal },
  );
  // Only for a keyboard whose place went away. One let go onto nothing by a
  // press on the screen's own words (to select them) stays let go.
  const isGone = (element: EventTarget | null) =>
    element instanceof HTMLElement &&
    (!element.isConnected || !isShown(element));
  // A press that put away the part the keyboard is in, which keeps the
  // keyboard while it is out of sight, once the press has done its work.
  window.addEventListener(
    "click",
    () => {
      const wasButton = pressedButton;
      pressedButton = false;
      requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (
          isGone(focused) ||
          (wasButton && (focused === null || focused === document.body))
        ) {
          focusScreenHome({ leaving: false });
        }
      });
    },
    { capture: true, signal },
  );
  // A part taken away with the keyboard in it, which leaves it on nothing.
  document.addEventListener(
    "focusout",
    (event) => {
      if (event.relatedTarget !== null) {
        return;
      }
      const left = event.target;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && isGone(left)) {
          focusScreenHome({ leaving: false });
        }
      });
    },
    { signal },
  );
  return () => {
    controller.abort();
  };
}
