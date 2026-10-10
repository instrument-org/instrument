import { pageHoldingKeyboard } from "@/client/lib/browser-pool";
import {
  keyboardPlace,
  listenForKeyboardPlace,
} from "@/client/lib/keyboard-place";
import { decodeBrowserTargetId } from "@instrument-org/workspace/client";

/**
 * The surfaces that hold tabs of their own (a chat beside the inbox, a chat
 * popped out, a draft's window), and which one the tab chords mean.
 *
 * Cmd+T and Cmd+W are menu accelerators, so they reach the window as commands
 * with no element attached. Each surface registers here, and while the
 * keyboard is in one (`keyboardPlace()`, or a page of its own holding it) the
 * chord is that surface's:
 *
 * - Cmd+T anywhere in it opens a tab there, the way its own add button does.
 * - Cmd+W only in the part that shows its tabs closes the one up there, so
 *   the caret in the words never closes something the person is not
 *   looking at.
 *
 * With the keyboard in none of them, the chord is the window's own. Only
 * surfaces on screen count: every window tab stays mounted, hidden with
 * `visibility`.
 */
type TabSurface = {
  /** The surface's outermost element; null while it is not mounted. */
  anchor: () => Element | null;
  /** Closes the tab up in the surface; false when none is up and the window's own chord stands. */
  closeTabUp: () => boolean;
  /** A page of the surface's own holds the keyboard: its `<webview>` is mounted on the body, outside the surface. */
  holdsKeyboard: () => boolean;
  openTab: () => void;
  /** The part of the surface showing its tabs, which Cmd+W answers for. */
  tabsAnchor: () => Element | null;
};

const registered: TabSurface[] = [];

/**
 * The surface Cmd+T last opened a tab in, while nothing has held the keyboard
 * or been pressed since: a new tab that takes no caret leaves focus on the
 * body, and the place would otherwise be the last press, from before the
 * chord. Cmd+T then Cmd+W closes the tab it opened.
 */
let openedIn: TabSurface | null = null;
let isListening = false;

function listen() {
  if (isListening) {
    return;
  }
  isListening = true;
  const forget = () => {
    openedIn = null;
  };
  document.addEventListener("focusin", forget, { capture: true });
  document.addEventListener("pointerdown", forget, { capture: true });
}

/** Adds a surface; returns its removal. */
export function registerTabSurface(surface: TabSurface): () => void {
  listenForKeyboardPlace();
  listen();
  registered.push(surface);
  return () => {
    const at = registered.indexOf(surface);
    if (at !== -1) {
      registered.splice(at, 1);
    }
    if (openedIn === surface) {
      openedIn = null;
    }
  };
}

/** Opens a tab in the surface the keyboard is in; false when it is in none. */
export function openTabForKeyboard(): boolean {
  const chosen = surfaceForKeyboard();
  if (!chosen) {
    return false;
  }
  // The new tab's address field takes the caret as it arrives only while
  // nothing else holds it.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  chosen.target.openTab();
  openedIn = chosen.target;
  return true;
}

/** Closes the tab up in the tabs the keyboard is in; false when it is in none. */
export function closeTabForKeyboard(): boolean {
  const chosen = surfaceForKeyboard();
  return chosen?.isInTabs === true && chosen.target.closeTabUp();
}

/** Whether the page holding the keyboard is one of these tabs. */
export function pageAmongHoldsKeyboard(tabIds: readonly string[]): boolean {
  const target = pageHoldingKeyboard();
  const owner = target === null ? null : decodeBrowserTargetId(target);
  return owner !== null && tabIds.includes(owner.sessionId);
}

function surfaceForKeyboard() {
  const focused = document.activeElement;
  if (openedIn && (focused === null || focused === document.body)) {
    return { isInTabs: true, target: openedIn };
  }
  const place = keyboardPlace();
  return chooseTabSurface(
    registered.flatMap((target) => {
      const surface = target.anchor();
      return surface
        ? [
            {
              holdsKeyboard: target.holdsKeyboard(),
              surface,
              tabs: target.tabsAnchor(),
              target,
              visible: surface.checkVisibility({
                opacityProperty: true,
                visibilityProperty: true,
              }),
            },
          ]
        : [];
    }),
    place,
  );
}

/**
 * The choice behind the tab chords, given what they read: the innermost
 * surface on screen the keyboard is in, and whether it is in the part
 * showing its tabs.
 */
export function chooseTabSurface<
  Entry extends {
    holdsKeyboard: boolean;
    surface: Element;
    tabs: Element | null;
    visible: boolean;
  },
>(
  entries: Entry[],
  place: Element | null,
): (Entry & { isInTabs: boolean }) | undefined {
  const visible = entries.filter((entry) => entry.visible);
  // A page holding the keyboard is its surface's whatever the place says:
  // its `<webview>` is the focused element, mounted outside every surface.
  const page = visible.find((entry) => entry.holdsKeyboard);
  if (page) {
    return { ...page, isInTabs: true };
  }
  const holding = visible.filter(
    (entry) => place !== null && entry.surface.contains(place),
  );
  if (holding.length === 0) {
    return undefined;
  }
  const inner = holding.reduce((chosen, entry) =>
    chosen.surface.contains(entry.surface) ? entry : chosen,
  );
  return {
    ...inner,
    isInTabs: place !== null && (inner.tabs?.contains(place) ?? false),
  };
}
