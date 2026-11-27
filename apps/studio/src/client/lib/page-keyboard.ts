import {
  focusHomeIn,
  isKeyboardNowhere,
  notePersonInPage,
  returnKeyboardToWindow,
} from "@/client/lib/keyboard-home";
import {
  isKeyboardLentFromField,
  returnLentKeyboard,
  tellWindowKeyboardLeft,
} from "@/client/lib/keyboard-loan";
import {
  isPageOnSideWithoutKeyboard,
  keyboardSide,
  pageOfSide,
} from "@/client/lib/keyboard-place";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  parseBrowserTargetId,
} from "@instrument-org/workspace/client";

/**
 * Which page has the keyboard, for the pool of browser pages
 * (`browser-pool.ts`): a page opened in place of the view takes it as it
 * comes on screen, one the person sent it to takes it, a press or a drag
 * holds every page off it, a page no slot shows gives it back, and a page on
 * the side of a tab group without the keyboard keeps none it took without a
 * press of the person's.
 */

/** What this reads of the pool, which the pool gives as it loads (`setPagePool`). */
type PagePool = {
  /** How many pages the pool holds. */
  count: () => number;
  /** The element a page's guest is, while the pool holds it. */
  guestOf: (targetId: BrowserTargetId) => HTMLElement | undefined;
  /** Every page the pool holds with its guest, in the order they were mounted. */
  guests: () => Iterable<[BrowserTargetId, HTMLElement]>;
  /** Whether a slot shows the page. */
  isShownInSlot: (targetId: BrowserTargetId) => boolean;
  /** The page's guest once it is ready to be driven. */
  readyGuestOf: (targetId: BrowserTargetId) => HTMLElement | undefined;
};

let pool: PagePool = {
  count: () => 0,
  guestOf: () => undefined,
  guests: () => [],
  isShownInSlot: () => false,
  readyGuestOf: () => undefined,
};

/** Gives this the pool's pages to read; the pool's own to call. */
export function setPagePool(pages: PagePool) {
  pool = pages;
}

/** Forgets what is pending for a page the pool lets go of. */
export function forgetPageKeyboard(targetId: BrowserTargetId) {
  clearTimeout(parkedKeyboardChecks.get(targetId));
  parkedKeyboardChecks.delete(targetId);
  keyboardHeirs.delete(targetId);
}

// Put keyboard focus on a guest so agent keyboard input dispatched to it is
// actually delivered there. Chromium routes keyboard input to the widget
// holding focus, and only this renderer-side DOM focus moves it across the
// process boundary -- the main process cannot do it for us. The guest's own
// `document.activeElement` survives losing and regaining focus, so this alone
// puts typing back into whatever the agent last clicked. A page on the side
// of a tab group without the keyboard never gets it this way, since the
// person's keys would follow it there: main then refuses the agent's keys
// that need focus, and plain typing reaches the page without it.
export function focusGuest(targetId: BrowserTargetId) {
  if (isPageOnSideWithoutKeyboard(targetId)) {
    return;
  }
  pool.guestOf(targetId)?.focus({ preventScroll: true });
}

/** How long a page opened in place of what the person was in waits to come on screen and take the keyboard. */
const HEIR_WAIT_MS = 5000;

/**
 * Pages opened in place of what the person was in, by target, with when
 * their claim on the keyboard lapses. The view a link was followed from
 * goes away with the caret in it, and a browser keeps the keyboard in the
 * content area across a link, so the page that took its place takes the
 * keyboard as it comes on screen, which is what lets back and forward step
 * through it.
 */
const keyboardHeirs = new Map<BrowserTargetId, number>();

/**
 * Hands the keyboard to the page once it is on screen and ready, unless
 * the person has put it somewhere they can see by then.
 */
export function takeKeyboardOnArrival(targetId: BrowserTargetId) {
  keyboardHeirs.set(targetId, Date.now() + HEIR_WAIT_MS);
  queueMicrotask(() => {
    passKeyboardTo(targetId);
  });
}

/**
 * Pages the person sent the keyboard into from the keys, by target, with
 * when the send lapses: an arrow into the page beside a folder, or one that
 * stepped from a page to the next file's. Unlike an heir's, the claim holds
 * wherever the keyboard is meanwhile (the step itself focuses the folder's
 * row), and only a press of the pointer in the window calls it off.
 */
const keyboardSends = new Map<BrowserTargetId, number>();

/** Puts the keyboard in the page now, or as it comes on screen and ready. */
export function giveKeyboardTo(targetId: BrowserTargetId) {
  keyboardSends.set(targetId, Date.now() + HEIR_WAIT_MS);
  passKeyboardTo(targetId);
}

/**
 * Holds keeping every page from taking the keyboard, and the pages that
 * would have taken it meanwhile. A page with the keyboard hears the window's
 * keys, and the window's loss of focus, in a process of its own, so a press
 * that may become a drag, and the drag, hold pages off: Escape and another
 * app taking the window still reach the drag.
 */
let keyboardHolds = 0;
const heldBack = new Set<BrowserTargetId>();

/**
 * Keeps pages from taking the keyboard until the returned function is
 * called, which hands it to a page that would have taken it meanwhile, its
 * claim as fresh as when it was made.
 */
export function holdKeyboardFromPages(): () => void {
  keyboardHolds += 1;
  let isHeld = true;
  return () => {
    if (!isHeld) {
      return;
    }
    isHeld = false;
    keyboardHolds -= 1;
    if (keyboardHolds > 0) {
      return;
    }
    const waiting = [...heldBack];
    heldBack.clear();
    const lapses = Date.now() + HEIR_WAIT_MS;
    for (const targetId of waiting) {
      for (const claims of [keyboardSends, keyboardHeirs]) {
        if (claims.has(targetId)) {
          claims.set(targetId, lapses);
        }
      }
      passKeyboardTo(targetId);
    }
  };
}

export function passKeyboardTo(targetId: BrowserTargetId) {
  const guest = pool.readyGuestOf(targetId);
  if (!guest || !pool.isShownInSlot(targetId)) {
    return;
  }
  if (keyboardHolds > 0) {
    const now = Date.now();
    if (
      [keyboardSends, keyboardHeirs].some(
        (claims) => (claims.get(targetId) ?? 0) >= now,
      )
    ) {
      heldBack.add(targetId);
    }
    return;
  }
  const sent = keyboardSends.get(targetId);
  const lapses = keyboardHeirs.get(targetId);
  keyboardSends.delete(targetId);
  keyboardHeirs.delete(targetId);
  // A page on the side without the keyboard never takes it.
  if (isPageOnSideWithoutKeyboard(targetId)) {
    return;
  }
  if (sent !== undefined && Date.now() <= sent) {
    notePersonInPage(guest);
    guest.focus({ preventScroll: true });
    return;
  }
  if (lapses === undefined || Date.now() > lapses || !isKeyboardNowhere()) {
    return;
  }
  notePersonInPage(guest);
  guest.focus({ preventScroll: true });
}

export function callOffKeyboardSends() {
  keyboardSends.clear();
}

export function recordHostFocus(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.tagName === "WEBVIEW") {
    return;
  }
  // Somewhere the person put the keyboard on purpose, which outranks a page
  // still on its way.
  keyboardHeirs.clear();
  // With no guests mounted nothing can steal focus, so skip the per-focusin
  // RPC. The main process re-seeds its claim from window focus whenever a
  // guarded command starts (see the manager's sendCommand).
  if (pool.count() > 0) {
    void rpcClient.browser.syncHostFocus.call();
  }
}

// Parking a guest only restyles it: the element stays in the DOM and stays
// focusable, so one the user had clicked into keeps keyboard focus after it
// goes invisible. Keystrokes would reach a page nobody can see, and every
// main-process chord that targets the focused guest (reload, zoom, history)
// would keep hitting it instead of the app. Hand focus back to the host as the
// guest leaves the screen; the `blur` this fires clears the main process's
// record of which guest is focused.
//
// After the commit, not during it: a park from a slot's layout cleanup runs
// inside React's commit, which puts focus back on whatever held it before the
// commit, so a blur there becomes `webview.focus()` and the guest takes the
// keyboard back from whatever the new screen focused (a new tab's address
// field).
//
// A page up on the side of a tab group with the keyboard keeps it: it leaves
// one slot for another as that side takes the keyboard, and handing focus
// back then would put it in the side that just lost the keyboard. That side
// can still name the page for a moment after its tab group leaves the screen,
// so a page still parked once the move would have settled hands the keyboard
// back then.
export function releaseGuestFocus(targetId: BrowserTargetId) {
  queueMicrotask(() => {
    const side = keyboardSide();
    if (side !== null && pageOfSide(side) === targetId) {
      clearTimeout(parkedKeyboardChecks.get(targetId));
      parkedKeyboardChecks.set(
        targetId,
        setTimeout(() => {
          parkedKeyboardChecks.delete(targetId);
          handKeyboardBackFromParked(targetId);
        }, SLOT_MOVE_SETTLE_MS),
      );
      return;
    }
    handKeyboardBackFromParked(targetId);
  });
}

/** How long a page moving from one slot to another may stay parked, in ms. */
const SLOT_MOVE_SETTLE_MS = 500;

/** The pending look, per page, at whether a parked page still has the keyboard. */
const parkedKeyboardChecks = new Map<
  BrowserTargetId,
  ReturnType<typeof setTimeout>
>();

/** Takes the keyboard from a page no slot shows, which no one can be typing into. */
export function handKeyboardBackFromParked(targetId: BrowserTargetId) {
  const guest = pool.guestOf(targetId);
  if (
    !guest ||
    pool.isShownInSlot(targetId) ||
    document.activeElement !== guest
  ) {
    return;
  }
  guest.blur();
  // What had the keyboard before the page may be in a tab no longer up, so
  // in a tab group it goes to what the side with it shows.
  const side = keyboardSide();
  if (side !== null) {
    focusHomeIn(side);
    return;
  }
  returnKeyboardToWindow();
}

/**
 * The page on screen that holds the keyboard, if one does: a parked guest
 * hands the keyboard back as it goes, and one that kept it is no page the
 * person is looking at.
 */
export function pageHoldingKeyboard(): BrowserTargetId | null {
  for (const [targetId, guest] of pool.guests()) {
    if (document.activeElement === guest && pool.isShownInSlot(targetId)) {
      return targetId;
    }
  }
  return null;
}

const pagePressListeners = new Set<(targetId: BrowserTargetId) => void>();

/** When the person last pressed the pointer in each page, which main reports since the host document never sees it. */
const pagePressedAt = new Map<BrowserTargetId, number>();

/** The page each pointerdown `pagePressed` passes on to the window was made in. */
const pagePressEvents = new WeakMap<Event, BrowserTargetId>();

/**
 * The page a press on the window was made in, when it is one a page passed
 * on (`pagePressed`): an overlay drawing that page over itself takes the
 * press as its own rather than as one outside it.
 */
export function pageOfPress(event: Event): BrowserTargetId | undefined {
  return pagePressEvents.get(event);
}

/**
 * Calls `listener` with a page each time the person presses the pointer in
 * it: a press the host document never sees, since it goes to the guest.
 * The one way a page gives its side of a tab group the keyboard; a page
 * taking focus otherwise (autofocus, a script, a load) does not.
 */
export function onPagePress(listener: (targetId: BrowserTargetId) => void) {
  pagePressListeners.add(listener);
  return () => {
    pagePressListeners.delete(listener);
  };
}

/** Whether the person has pressed the pointer in a tab's page since launch. */
export function wasPagePressed(tabId: string): boolean {
  const targetId = parseBrowserTargetId(tabId);
  return targetId !== null && pagePressedAt.has(targetId);
}

export function pagePressed(targetId: BrowserTargetId) {
  pagePressedAt.set(targetId, Date.now());
  const pressed = pool.guestOf(targetId);
  if (pressed) {
    notePersonInPage(pressed);
  }
  // A popover stays open when focus moves into a page, so a press in one of
  // this window's pages reaches the window's own listeners as a press on
  // nothing: on the root element, outside the React tree, where only what
  // listens on the document or the window (an open overlay's outside press
  // above all) hears it. The click completes it, since a popover waits for
  // one before it folds. The root says while one is open
  // (`lib/window-drag-overlays.ts`).
  if (
    pressed !== undefined &&
    document.documentElement.hasAttribute("data-overlay-open")
  ) {
    const press = {
      bubbles: true,
      button: 0,
      cancelable: true,
      composed: true,
    };
    const root = document.documentElement;
    const down = new PointerEvent("pointerdown", {
      ...press,
      isPrimary: true,
      pointerType: "mouse",
    });
    pagePressEvents.set(down, targetId);
    root.dispatchEvent(down);
    root.dispatchEvent(new MouseEvent("click", press));
  }
  for (const listener of pagePressListeners) {
    listener(targetId);
  }
}

/** How long a page that took the keyboard waits for the press main reports, which may arrive after the focus, in ms. */
const PRESS_REPORT_WAIT_MS = 150;

/** Whether the person pressed in the page within the time a press report may lag the focus it caused. */
function wasPressedJustNow(targetId: BrowserTargetId) {
  const pressed = pagePressedAt.get(targetId) ?? 0;
  return Date.now() - pressed < PRESS_REPORT_WAIT_MS * 4;
}

/**
 * Hands the keyboard back to the side that has it from a page on the other
 * side that took it without a press of the person's: a page focusing
 * itself, or one a load, a script or an agent's click focused. Waits a moment first for a
 * press main may still be reporting, which gives the page's side the
 * keyboard instead.
 */
export function keepKeyboardOnItsSide(targetId: BrowserTargetId) {
  if (!isPageOnSideWithoutKeyboard(targetId)) {
    return;
  }
  setTimeout(() => {
    const guest = pool.guestOf(targetId);
    const side = keyboardSide();
    if (
      !guest ||
      document.activeElement !== guest ||
      wasPressedJustNow(targetId) ||
      !isPageOnSideWithoutKeyboard(targetId) ||
      side === null
    ) {
      return;
    }
    guest.blur();
    focusHomeIn(side);
  }, PRESS_REPORT_WAIT_MS);
}

/**
 * Settles a page found holding the keyboard the window has not heard it
 * lost. One an agent's command put it in gives it back when main asks, so
 * the window goes on unheard. Any other needs a press of the person's to
 * keep a keyboard it took from a field: without one, by the time main
 * would have reported it, the field has it back, and main is told the
 * window has the keyboard still. A page that took it from nothing keeps it.
 */
export function askAfterKeyboard(guest: HTMLElement) {
  const targetId = [...pool.guests()].find(([, each]) => each === guest)?.[0];
  const keeps = () => {
    if (document.activeElement === guest) {
      tellWindowKeyboardLeft();
    }
  };
  if (targetId === undefined) {
    keeps();
    return;
  }
  void rpcClient.browser.returnsKeyboard.call({ targetId }).then((returns) => {
    if (returns) {
      return;
    }
    if (!isKeyboardLentFromField()) {
      keeps();
      return;
    }
    setTimeout(() => {
      if (document.activeElement !== guest) {
        return;
      }
      if (wasPressedJustNow(targetId) || !returnLentKeyboard()) {
        keeps();
        return;
      }
      void rpcClient.browser.syncHostFocus.call();
    }, PRESS_REPORT_WAIT_MS);
  }, keeps);
}

/** The host document losing the keyboard, as it does to a page taking it. */
export function onHostBlur() {
  queueMicrotask(() => {
    const target = pageHoldingKeyboard();
    if (target !== null) {
      keepKeyboardOnItsSide(target);
    }
  });
}
