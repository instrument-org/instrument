/**
 * Where the keyboard is in the app window, kept by three rules:
 *
 * - Each screen marks the parts it is worked from with `data-keyboard-home`:
 *   a list, whose open or selected row takes the keyboard (its first row
 *   when none is), a composer, whose words do, or the element itself. A
 *   lower value wins where more than one is on show, so a chat's composer
 *   goes ahead of the chat list beside it, and the file list ahead of the
 *   page beside it. A part the window cannot focus itself (a page, drawn by
 *   a guest of its own) says how with `setHomeFocus`. In a tab group only
 *   the side with the keyboard (`data-keyboard`) counts, and the caret on
 *   the other side counts as on nothing. A tab come back to (`data-tab-up`)
 *   is worked from the home it was last worked from, its page or the list
 *   beside it.
 * - A press of the pointer on a button leaves the keyboard where it was, as
 *   a Mac's buttons do: the rail, a toolbar's toggle, a tab. Tab still
 *   reaches every one.
 * - The keyboard left on nothing a person can see (a column put away, a
 *   screen gone) goes to the home of the screen on show. What counts as
 *   nothing is one answer (`isKeyboardNowhere`), for everything that asks
 *   before it takes the keyboard or sends it home.
 * - A page gives the keyboard back in one place, to where a person last
 *   had it (`returnKeyboardToWindow`), and a field a person is done with
 *   lets go of it in one (`leaveField`).
 * - A page that only borrows the keyboard, as one an agent presses in does,
 *   is not heard taking it (`keyboard-loan.ts`).
 */

import {
  installKeyboardLoan,
  returnLentKeyboard,
  tellWindowKeyboardLeft,
} from "@/client/lib/keyboard-loan";
import {
  isOnSideWithoutKeyboard,
  isShown,
  keyboardSide,
} from "@/client/lib/keyboard-place";

/** How long a screen has to draw its home after it is asked for, in frames. */
const HOME_WAIT_FRAMES = 30;

/** How long a part of the screen has, whose code may still be loading, in frames. */
const PART_WAIT_FRAMES = 300;

const ACTIVE_TAB = "[data-app-tab-active]";

/** Homes the window cannot put the keyboard in by focusing them, with how to. */
const homeFocus = new WeakMap<
  Element,
  { focus: () => void; holds: () => boolean }
>();

/**
 * The home each tab was last worked from, by its `data-keyboard-home`. The
 * value rather than the element, since a tab is drawn afresh each time it
 * comes up.
 */
const lastHomes = new Map<string, string>();

/**
 * Where a person last put the keyboard: an element of the window, or the
 * guest of a page they took it into (`notePersonInPage`). A page an agent's
 * command put the keyboard in is neither, and gives it back here
 * (`returnKeyboardFromAgent`).
 */
let lastPlace: HTMLElement | null = null;

/**
 * How to put the keyboard in a home that is not focusable itself, such as
 * the element a page is drawn into, and whether it is there.
 */
export function setHomeFocus(
  home: Element,
  way: { focus: () => void; holds: () => boolean },
) {
  homeFocus.set(home, way);
  return () => {
    if (homeFocus.get(home) === way) {
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
      isShown(now) &&
      !isOnSideWithoutKeyboard(now)
    ) {
      return;
    }
    // A home whose rows are still on their way is waited for too.
    const home = isOldScreen ? null : homeOnShow();
    if (home && putKeyboardIn(home)) {
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
 * Puts the keyboard in the home of one part of the screen on show, such as
 * a side of a tab group, once it has drawn, unless it went into the part
 * first. It leaves where it was at once, so keys meanwhile, or in a part
 * with no home, go nowhere. The home the part's tab was last worked from is
 * waited for a moment before another takes the keyboard.
 */
export function focusHomeIn(part: HTMLElement) {
  const from = document.activeElement;
  if (from instanceof HTMLElement && !part.contains(from)) {
    from.blur();
  }
  dropCaretOutside(part);
  let frames = 0;
  const attempt = () => {
    if (!part.isConnected || part.contains(document.activeElement)) {
      return;
    }
    if (frames > 0 && !isKeyboardNowhere()) {
      return;
    }
    const home = homeIn(part);
    if (
      (home && putKeyboardIn(home)) ||
      (frames >= HOME_WAIT_FRAMES && homesIn(part).some(putKeyboardIn))
    ) {
      return;
    }
    frames += 1;
    if (frames <= PART_WAIT_FRAMES) {
      requestAnimationFrame(attempt);
    }
  };
  attempt();
}

/**
 * Puts the keyboard in a home, by its own way or at its target, and takes
 * any caret left elsewhere away. Whether the home had anything to take it,
 * and it was taken.
 */
function putKeyboardIn(home: HTMLElement): boolean {
  const way = homeFocus.get(home);
  const target = way ? null : targetIn(home);
  if (!way && !target) {
    return false;
  }
  dropCaretOutside(home);
  if (way) {
    // A page takes the keyboard once it has drawn, unless it is somewhere
    // the person put it by then, which is nowhere yet.
    if (!way.holds() && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    way.focus();
  } else if (target) {
    focusQuietly(target);
    if (document.activeElement !== target) {
      return false;
    }
    if (target === home) {
      passIntoWordsOnArrival(home);
    }
  }
  return true;
}

/**
 * A person took a page's keyboard: pressed in it, or the window sent the
 * keyboard there for them. The pool's to say, since the window hears no
 * press in a page.
 */
export function notePersonInPage(guest: HTMLElement) {
  lastPlace = guest;
  if (document.activeElement === guest) {
    tellWindowKeyboardLeft();
  }
}

/**
 * Gives the keyboard back from a page an agent's command put it in. Main
 * asks after every command of an agent's, whatever the keyboard did
 * meanwhile, so nothing moves unless a page has it, and a page the person
 * put it in keeps it. It goes back where the page borrowed it from, the
 * element or nothing, which the window never heard it leave; with no loan
 * out, to where a person last had it.
 */
export function returnKeyboardFromAgent() {
  const held = document.activeElement;
  if (
    held?.tagName === "WEBVIEW" &&
    held !== lastPlace &&
    !returnLentKeyboard()
  ) {
    returnKeyboardToWindow();
  }
}

/**
 * Puts the keyboard back where a person last had it, from a page that took
 * it for an agent or that no slot shows any more: in that element or page,
 * while a person can still see it. One on the side of a tab group without
 * the keyboard is left for the home of the side with it. With that place
 * gone, a home of the window's own in what is on show takes it, the one its
 * tab was last worked from first, and never a page's: main asks again while
 * an agent's command holds a page, which would be handed it each time. With
 * nothing to take it, the page lets go and the keyboard is on nothing.
 */
export function returnKeyboardToWindow() {
  const was = lastPlace;
  const side = keyboardSide();
  if (was?.isConnected && side && isOnSideWithoutKeyboard(was)) {
    focusHomeIn(side);
    return;
  }
  if (was?.isConnected && isShown(was)) {
    was.focus({ preventScroll: true });
    if (document.activeElement === was) {
      return;
    }
  }
  const homes = side
    ? [homeIn(side), ...homesIn(side)]
    : homesIn(document).filter((home) => home.closest(ACTIVE_TAB) !== null);
  if (
    homes.some(
      (home) => home !== null && !homeFocus.has(home) && putKeyboardIn(home),
    )
  ) {
    return;
  }
  const held = document.activeElement;
  if (held instanceof HTMLElement && held.tagName === "WEBVIEW") {
    held.blur();
  }
}

/**
 * Lets go of a field a person is done with (an address entered, Escape in
 * an empty search): the keyboard leaves it for the home of the screen on
 * show, which may be the page the field just sent somewhere.
 */
export function leaveField(field: Element | null | undefined) {
  if (field instanceof HTMLElement) {
    field.blur();
  }
  focusScreenHome({ leaving: false });
}

/** How long a home that took the keyboard itself waits for its words to be drawn, in ms. */
const WORDS_WAIT_MS = 5000;

/**
 * A home that took the keyboard itself before its words were drawn (a file
 * whose editor is still loading) hands the keyboard to them as they come,
 * unless it has gone somewhere else by then.
 */
function passIntoWordsOnArrival(home: HTMLElement) {
  const observer = new MutationObserver(() => {
    if (document.activeElement !== home) {
      stop();
      return;
    }
    const words = first(home, '[contenteditable="true"]');
    if (words) {
      stop();
      words.focus({ preventScroll: true });
    }
  });
  const timer = setTimeout(() => {
    stop();
  }, WORDS_WAIT_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    home.removeEventListener("blur", stop);
  };
  observer.observe(home, {
    attributeFilter: ["contenteditable"],
    childList: true,
    subtree: true,
  });
  home.addEventListener("blur", stop);
}

/**
 * After a press in a side of a tab group, which has given the side the
 * keyboard: a press on nothing that takes the caret (empty space, a chip's
 * row, padding) still puts it in the side, in its home, unless the press
 * selected words.
 */
export function placeCaretAfterPress(side: HTMLElement) {
  requestAnimationFrame(() => {
    const now = document.activeElement;
    const selection = document.getSelection();
    if (
      (now === null || now === document.body) &&
      (selection === null || selection.isCollapsed)
    ) {
      focusHomeIn(side);
    }
  });
}

/**
 * A caret that landed in a side of a tab group without the keyboard by no
 * press (a field focusing itself, Tab) goes to the home of the side with
 * the keyboard, once the commit it came in has settled which side that is:
 * which side has the keyboard changes only on purpose.
 */
export function keepCaretOnKeyboardSide(side: HTMLElement) {
  requestAnimationFrame(() => {
    const keyboard = side
      .closest("[data-group-sides]")
      ?.querySelector<HTMLElement>("[data-group-side][data-keyboard]");
    if (
      keyboard &&
      keyboard !== side &&
      side.contains(document.activeElement)
    ) {
      focusHomeIn(keyboard);
    }
  });
}

/**
 * Takes away a caret left in editable words outside `part`. An editor let
 * go of by a blur, or by the keyboard going into something that types
 * nothing (a page's scroller), keeps its selection, and Chromium puts words
 * the system's text input sends (dictation, an input method) at the
 * selection wherever the keyboard is, so they would land in that editor.
 * An editor puts its caret back where it was as it takes the keyboard again.
 */
export function dropCaretOutside(part: Element) {
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  const holder = anchor instanceof Element ? anchor : anchor?.parentElement;
  const editor = holder?.closest('[contenteditable="true"]');
  if (selection && editor && !part.contains(editor)) {
    selection.removeAllRanges();
  }
}

/**
 * Puts the keyboard in the reply box of the composer `from` sits in
 * (`data-composer-column`), a chat popped out of its tab's included, which
 * no tab encloses. Outside a composer, the screen on show takes it.
 */
export function focusReplyBox(from: Element) {
  const column = from.closest("[data-composer-column]");
  const home =
    column &&
    [...column.querySelectorAll<HTMLElement>("[data-keyboard-home]")].find(
      (each) => isShown(each),
    );
  const way = home && homeFocus.get(home);
  const target = home && targetIn(home);
  if (way) {
    way.focus();
  } else if (target) {
    focusQuietly(target);
  } else {
    focusScreenHome({ leaving: false });
  }
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

/**
 * The part of the screen on show it is worked from, or null while it has
 * none drawn: in a tab group, the part of the side with the keyboard.
 */
function homeOnShow(): HTMLElement | null {
  const side = keyboardSide();
  if (side) {
    return homeIn(side);
  }
  return (
    homesIn(document).find((home) => home.closest(ACTIVE_TAB) !== null) ?? null
  );
}

/**
 * The part of `root` it is worked from, or null while it has none drawn: the
 * one its tab was last worked from, when that is drawn.
 */
function homeIn(root: HTMLElement): HTMLElement | null {
  const last = lastHomes.get(root.dataset.tabUp ?? "");
  const homes = homesIn(root);
  return (
    homes.find((home) => home.dataset.keyboardHome === last) ?? homes[0] ?? null
  );
}

/**
 * The words of the composer on show, for a letter typed on nothing: in a tab
 * group, the one on the side with the keyboard, and null when that side
 * shows something else.
 */
export function composerWithKeyboard(): HTMLElement | null {
  const root = keyboardSide() ?? document;
  return (
    [
      ...root.querySelectorAll<HTMLElement>(
        '[data-keyboard-home] [data-slot="composer-frame"] [contenteditable="true"]',
      ),
    ].find(
      (each) =>
        each.closest(ACTIVE_TAB) !== null &&
        each.closest('[aria-hidden="true"]') === null &&
        isShown(each) &&
        !isOnSideWithoutKeyboard(each),
    ) ?? null
  );
}

/** Notes the home the keyboard went into, for when its tab is come back to. */
function rememberHome() {
  const side = keyboardSide();
  const tab = side?.dataset.tabUp;
  if (!side || tab === undefined) {
    return;
  }
  const home = [
    ...side.querySelectorAll<HTMLElement>("[data-keyboard-home]"),
  ].find(
    (each) =>
      each.contains(document.activeElement) ||
      homeFocus.get(each)?.holds() === true,
  );
  if (home) {
    lastHomes.set(tab, home.dataset.keyboardHome ?? "");
  }
}

/** The homes drawn in `root`, the one that goes first first. */
function homesIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-keyboard-home]")]
    .filter((home) => isShown(home))
    .sort(
      (a, b) =>
        Number(a.dataset.keyboardHome || 1) -
        Number(b.dataset.keyboardHome || 1),
    );
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
    isShown(element) &&
    !isOnSideWithoutKeyboard(element)
  );
}

function first(root: HTMLElement, selector: string) {
  return (
    [...root.querySelectorAll<HTMLElement>(selector)].find((each) =>
      isShown(each),
    ) ?? null
  );
}

/**
 * Whether the keyboard is in nothing a person can see: on the body, in a
 * part hidden or put out of reach, or in a page no slot shows.
 */
export function isKeyboardNowhere() {
  const focused = document.activeElement;
  return focused === null || focused === document.body || !isShown(focused);
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
 * Puts the keyboard in the composer of the chat on show, once the menu or
 * dialog it was asked from has gone and the composer is drawn: the one on
 * the side of the group with the keyboard, when that side shows a chat, and
 * otherwise the last one drawn. One in a column put away is passed over.
 */
export function focusChatComposer() {
  const composer = () => {
    const shown = [
      ...document.querySelectorAll<HTMLElement>(
        `${ACTIVE_TAB} [data-slot="composer-frame"] [contenteditable="true"]`,
      ),
    ].filter(
      (each) => each.closest('[aria-hidden="true"]') === null && isShown(each),
    );
    return (
      shown.find(
        (each) => each.closest("[data-group-side][data-keyboard]") !== null,
      ) ?? shown.at(-1)
    );
  };
  focusOnceLayersClose({
    focus: () => {
      let frames = 0;
      const attempt = () => {
        const target = composer();
        if (target) {
          target.focus({ preventScroll: true });
          return;
        }
        frames += 1;
        if (frames < HOME_WAIT_FRAMES) {
          requestAnimationFrame(attempt);
        }
      };
      attempt();
    },
    holds: () => composer()?.contains(document.activeElement) === true,
  });
}

/**
 * The button a press is on, which may be a row that is one only by its role
 * and takes no focus itself. A field or a focusable part inside such a row
 * keeps its own press.
 */
function buttonPressed(target: Element) {
  const button = target.closest('button, [role="button"]:not([tabindex])');
  const focusable = target.closest(
    'a[href], input, textarea, select, [contenteditable="true"], [tabindex]',
  );
  return button !== null && focusable !== button && button.contains(focusable)
    ? null
    : button;
}

/**
 * The window's side of the rules above, for the app window to install once:
 * a button pressed leaves the keyboard where it was, and a keyboard left on
 * nothing a person can see goes home.
 */
export function installKeyboardHome() {
  const controller = new AbortController();
  const { signal } = controller;
  const endLoans = installKeyboardLoan({
    isPersonsPage: (guest) => guest === lastPlace,
  });
  // Whether the press now ending was on a button or a tab, which leaves the
  // keyboard where it was; a page beside the screen loses it all the same,
  // since its guest gives the keyboard up to any press in the window.
  let pressedButton = false;
  let pressedTab = false;
  window.addEventListener(
    "mousedown",
    (event) => {
      const button =
        event.button === 0 && event.target instanceof Element
          ? buttonPressed(event.target)
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
      // A tab brought up by a press keeps the keyboard where it was too,
      // unless that is nothing or the other side of a tab group: a press
      // there lets go of it, and a page gives it up to any press in the
      // window. Then it goes home.
      pressedTab =
        event.button === 0 &&
        event.target instanceof Element &&
        event.target.closest('[role="tab"]') !== null;
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "focusin",
    (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.tagName !== "WEBVIEW"
      ) {
        lastPlace = event.target;
      }
      rememberHome();
    },
    { signal },
  );
  // A page pressed takes the keyboard with no `focusin` here, only the
  // document's own blur.
  window.addEventListener("blur", rememberHome, { signal });
  // Only for a keyboard whose place went away. One let go onto nothing by a
  // press on the screen's own words (to select them) stays let go.
  // A page's guest is the pool's to take the keyboard from as it is put
  // away, and one an agent types into out of sight keeps it.
  const isGone = (element: EventTarget | null) =>
    element instanceof HTMLElement &&
    element.tagName !== "WEBVIEW" &&
    (!element.isConnected || !isShown(element));
  // A press that put away the part the keyboard is in, which keeps the
  // keyboard while it is out of sight, once the press has done its work.
  window.addEventListener(
    "click",
    () => {
      const wasButton = pressedButton;
      const wasTab = pressedTab;
      pressedButton = false;
      pressedTab = false;
      requestAnimationFrame(() => {
        const focused = document.activeElement;
        const isOnNothing = focused === null || focused === document.body;
        if (
          isGone(focused) ||
          (wasButton && isOnNothing) ||
          (wasTab && (isOnNothing || isOnSideWithoutKeyboard(focused)))
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
    endLoans();
    lastPlace = null;
  };
}
