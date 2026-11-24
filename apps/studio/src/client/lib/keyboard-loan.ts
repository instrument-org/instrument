/**
 * The keyboard a page borrows from the window. A page is a guest with a
 * document of its own, so the window hears one taking the keyboard as the
 * window losing it: the element it was in blurs, and so does the window. An
 * agent's press in a page takes it that way for the moment main needs to
 * hand it back, which is no one leaving what they were in. So the window is
 * told nothing until it is known where the keyboard went:
 *
 * - Back to the element it left, and the window never hears it was gone: a
 *   field keeps what was typed in it, and whatever closes as the window
 *   loses the keyboard stays open.
 * - To a page that keeps it, to another app, or to another element by a
 *   person's press or the window's own code, and the window hears it left,
 *   as it would have.
 * - Onto a control with nothing behind it but the browser, as a Tab an
 *   agent presses at the end of its page carries it to the window's first
 *   one, and it is put back where it left, unheard.
 *
 * Only a move the browser makes by itself is held back: one a person's
 * press or key makes, or the window's own code, is heard as it happens.
 */

/** How long the window waits to hear where the keyboard went once it is neither in a page nor back, in ms. */
const PASSING_MS = 100;

type Options = {
  /**
   * Whether the event being heard is the browser's own doing rather than
   * some script's. A test's to say, since every event of a test's has the
   * test under it.
   */
  isBrowsersDoing?: () => boolean;
  /** Whether a person put the keyboard in this page. */
  isPersonsPage: (guest: Element) => boolean;
  /** Whether a person can see this element. */
  isShown: (element: Element) => boolean;
};

/**
 * The keyboard out on loan, and the element it left: null for a keyboard
 * that was on nothing when the window lost it.
 */
let loan: {
  from: HTMLElement | null;
  /** Whether whoever knows the page holding it was asked if it is kept. */
  isAskedAfter: boolean;
  /** Whether a keyboard gone from the window altogether was given time to come back. */
  isWaitedFor: boolean;
} | null = null;

/** Whether the window lost the keyboard and has not heard. */
let hasWindowLeft = false;

/** The control the keyboard strayed onto, while it is taken off it again. */
let strayedOnto: HTMLElement | null = null;

/** Whether the events going out are this module's own, telling the window. */
let isTelling = false;

/** Whether a press or a key of the person's in the window is being handled. */
let isPersonActing = false;

let settling: ReturnType<typeof setTimeout> | null = null;

/** Whether a person can see an element, as whoever installed this says. */
let isOnShow: (element: Element) => boolean = () => true;

const pageListeners = new Set<(guest: HTMLElement) => void>();

/**
 * Calls `listener` with a page found holding the keyboard the window has
 * not heard it lost, for whoever knows the page to say whether it is given
 * back (it stays unheard) or kept (`tellWindowKeyboardLeft`).
 */
export function onKeyboardLentToPage(listener: (guest: HTMLElement) => void) {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
}

/** Whether the keyboard is out on loan from an element, rather than from nothing. */
export function isKeyboardLentFromField() {
  return loan !== null && loan.from !== null;
}

/**
 * Puts the keyboard back where a page borrowed it from: the element it
 * left, or nothing. False with no loan out, or with that element gone from
 * sight, which leaves where it goes to the caller.
 */
export function returnLentKeyboard() {
  if (loan === null) {
    return false;
  }
  const { from } = loan;
  if (from === null) {
    const held = document.activeElement;
    if (held instanceof HTMLElement && isPage(held)) {
      held.blur();
    }
    return true;
  }
  if (!from.isConnected || !isOnShow(from)) {
    return false;
  }
  from.focus({ preventScroll: true });
  return document.activeElement === from;
}

/**
 * Tells the window the keyboard left it, where it has not heard: the page
 * that has it is keeping it, or it went to `to`.
 */
export function tellWindowKeyboardLeft(to: Element | null = null) {
  const from = loan?.from ?? null;
  const hadWindowLeft = hasWindowLeft;
  endLoan();
  isTelling = true;
  try {
    if (from?.isConnected) {
      from.dispatchEvent(new FocusEvent("blur", { relatedTarget: to }));
      from.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          composed: true,
          relatedTarget: to,
        }),
      );
    }
    if (hadWindowLeft) {
      window.dispatchEvent(new Event("blur"));
    }
  } finally {
    isTelling = false;
  }
}

function endLoan() {
  loan = null;
  hasWindowLeft = false;
  if (settling !== null) {
    clearTimeout(settling);
    settling = null;
  }
}

function isPage(element: Element) {
  return element.tagName === "WEBVIEW";
}

/**
 * Whether the browser is dispatching the event being heard of its own
 * accord. An error's stack lists what called the listener, and an event the
 * browser fires for a keyboard a page took, or gave back, has nothing under
 * it: one a script causes (`blur()`, `focus()`, an element taken out) has
 * that script. For a listener to call directly.
 */
function hasNoScriptUnder() {
  const frames = (new Error().stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "));
  // This function, and the listener that asked.
  return frames.length <= 2;
}

/**
 * Keeps the window from hearing the keyboard leave it for a page until it
 * is known whether it comes back. Installed ahead of every other listener
 * of the window's, since it is their hearing it decides.
 */
export function installKeyboardLoan({
  isBrowsersDoing = hasNoScriptUnder,
  isPersonsPage,
  isShown,
}: Options) {
  const controller = new AbortController();
  const options = { capture: true, signal: controller.signal };
  isOnShow = isShown;

  const settle = () => {
    settling = null;
    const held = document.activeElement;
    if (hasWindowLeft) {
      if (held instanceof HTMLElement && isPage(held) && !isPersonsPage(held)) {
        // A page has it. Whoever knows the page says whether it keeps it,
        // and with no one to ask it does.
        if (pageListeners.size === 0) {
          tellWindowKeyboardLeft();
          return;
        }
        if (loan && !loan.isAskedAfter) {
          loan.isAskedAfter = true;
          for (const listener of pageListeners) {
            listener(held);
          }
        }
        return;
      }
      // No page has it, so another app does, unless it is on its way back
      // through a page that only passed it on.
      if (
        loan &&
        !loan.isWaitedFor &&
        !(held instanceof HTMLElement && isPage(held))
      ) {
        loan.isWaitedFor = true;
        settleIn(PASSING_MS);
        return;
      }
      tellWindowKeyboardLeft();
      return;
    }
    // The window has the keyboard, and it is not in the element it left.
    if (loan !== null && held !== loan.from) {
      tellWindowKeyboardLeft(held);
    }
    endLoan();
  };
  // Once the events of one change have all arrived. A page's taking the
  // keyboard blurs the element, then the window, more than once, and only
  // the last finds the page holding it; a keyboard on its way back through
  // the window has yet to land.
  const settleIn = (ms: number) => {
    if (settling !== null) {
      clearTimeout(settling);
    }
    settling = setTimeout(settle, ms);
  };

  const onLeave = (event: FocusEvent) => {
    if (isTelling) {
      return;
    }
    const isBrowsers = isBrowsersDoing();
    const { target } = event;
    if (target === event.currentTarget) {
      event.stopImmediatePropagation();
      hasWindowLeft = true;
      loan ??= { from: null, isAskedAfter: false, isWaitedFor: false };
      settleIn(0);
      return;
    }
    if (!(target instanceof HTMLElement) || isPage(target)) {
      return;
    }
    if (target === strayedOnto || target === loan?.from) {
      // Off a control the keyboard strayed onto, or the second of the two
      // events an element losing the keyboard fires.
      event.stopImmediatePropagation();
      return;
    }
    const to = event.relatedTarget;
    // With no press or key of the person's behind it, a page that is not
    // their own was handed the keyboard, or the browser took it from an
    // element still fit to hold it: a page is taking it.
    const leavesForPage =
      to instanceof Element
        ? isPage(to) && !isPersonsPage(to) && !isPersonActing
        : isBrowsers &&
          !isPersonActing &&
          loan === null &&
          target.isConnected &&
          isShown(target) &&
          !target.matches(":disabled");
    if (leavesForPage) {
      event.stopImmediatePropagation();
      loan = { from: target, isAskedAfter: false, isWaitedFor: false };
      settleIn(PASSING_MS);
    }
  };

  const onArrive = (event: FocusEvent) => {
    if (isTelling) {
      return;
    }
    const isBrowsers = isBrowsersDoing();
    const { target } = event;
    if (target === event.currentTarget) {
      if (hasWindowLeft) {
        // The window never heard the keyboard leave, so it is not told it
        // came back either.
        event.stopImmediatePropagation();
        hasWindowLeft = false;
        settleIn(PASSING_MS);
      }
      return;
    }
    if (!(target instanceof HTMLElement) || isPage(target) || loan === null) {
      return;
    }
    const { from } = loan;
    if (target === from) {
      event.stopImmediatePropagation();
      if (event.type === "focusin") {
        endLoan();
      }
      return;
    }
    if (!isBrowsers || isPersonActing) {
      tellWindowKeyboardLeft(target);
      return;
    }
    // Nothing put the keyboard here but the browser: it ran on out of a
    // page that was only passing it through.
    event.stopImmediatePropagation();
    if (event.type === "focus") {
      return;
    }
    strayedOnto = target;
    if (from?.isConnected && isShown(from)) {
      from.focus({ preventScroll: true });
    }
    if (document.activeElement === target) {
      target.blur();
    }
    strayedOnto = null;
    if (loan !== null) {
      tellWindowKeyboardLeft();
    }
  };

  // A press or a key of the person's in the window, and whatever the
  // keyboard does while it is handled, is theirs.
  const onPersonActs = (event: Event) => {
    if (event.isTrusted) {
      isPersonActing = true;
      setTimeout(() => {
        isPersonActing = false;
      }, 0);
    }
  };

  window.addEventListener("blur", onLeave, options);
  window.addEventListener("focusout", onLeave, options);
  window.addEventListener("focus", onArrive, options);
  window.addEventListener("focusin", onArrive, options);
  window.addEventListener("pointerdown", onPersonActs, options);
  window.addEventListener("mousedown", onPersonActs, options);
  window.addEventListener("keydown", onPersonActs, options);

  return () => {
    controller.abort();
    endLoan();
    strayedOnto = null;
    isPersonActing = false;
    isOnShow = () => true;
  };
}
