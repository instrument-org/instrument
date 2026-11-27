import {
  isOnSideWithoutKeyboard,
  isShown,
  keyboardPlace,
  keyboardSide,
  listenForKeyboardPlace,
} from "@/client/lib/keyboard-place";

/**
 * The surfaces Cmd+F can open a search in, and which one a press means.
 *
 * Cmd+G and Shift+Cmd+G go to the same surface Cmd+F would.
 *
 * Cmd+F is a menu accelerator (it has to be: a focused `<webview>` keeps every
 * key from the window's document), so it reaches the window as a command
 * rather than a keydown, with no element attached. Each surface with a search
 * (a find bar, a filter field, a list's search) registers here, and the
 * command goes to:
 *
 * 1. The innermost surface the keyboard is in (`keyboardPlace()`, or a browser
 *    page holding it).
 * 2. With the keyboard in none of them, the surface the person was last in.
 * 3. With no surface ever visited, the one that came on screen last.
 *
 * A surface is the nearest `[data-find-surface]` element around the target's
 * anchor, so a field in a viewer's toolbar answers for the whole viewer under
 * it. Only surfaces on screen count: every tab stays mounted, hidden with
 * `visibility`, and a closed inbox fades to nothing rather than unmounting, so
 * those surfaces are passed over, as is one under something drawn over it
 * that made it `inert`. Inside a dialog
 * that registers nothing, the press is the dialog's and opens nothing behind
 * it.
 */
type FindTarget = {
  /** An element inside the target; null while it is not mounted. */
  anchor: () => Element | null;
  /** The keyboard is in this target although no element of its surface holds it: a browser page, whose `<webview>` is mounted on the body. */
  holdsKeyboard?: () => boolean;
  /** Cmd+G and Shift+Cmd+G: steps to the next or previous match. A target without it opens its search instead. */
  findAgain?: (forward: boolean) => void;
  openFind: () => void;
};

const registered: { stamp: number; target: FindTarget }[] = [];
let clock = 0;

/** Adds a surface; returns its removal. */
export function registerFindTarget(target: FindTarget): () => void {
  listenForKeyboardPlace();
  listenForVisits();
  const entry = { stamp: 0, target };
  registered.push(entry);
  return () => {
    const at = registered.indexOf(entry);
    if (at !== -1) {
      registered.splice(at, 1);
    }
  };
}

/** Opens the search Cmd+F means; false when there is none on screen. */
export function openFindForKeyboard(): boolean {
  const chosen = findTargetForKeyboard();
  chosen?.openFind();
  return chosen !== undefined;
}

/** Steps the search Cmd+F means, the way Cmd+G does; false when there is none on screen. */
export function findAgainForKeyboard(forward: boolean): boolean {
  const chosen = findTargetForKeyboard();
  if (chosen?.findAgain) {
    chosen.findAgain(forward);
  } else {
    chosen?.openFind();
  }
  return chosen !== undefined;
}

function findTargetForKeyboard(): FindTarget | undefined {
  const place = insideViewer(keyboardPlace());
  const anySideHasKeyboard = keyboardSide() !== null;
  const chosen = chooseFindTarget(
    registered.flatMap(({ stamp, target }) => {
      const surface = surfaceOf(target);
      // Only the side with the keyboard is searched of a tab group's two;
      // with neither side marked, both are.
      return surface &&
        !(anySideHasKeyboard && isOnSideWithoutKeyboard(surface))
        ? [
            {
              holdsKeyboard: target.holdsKeyboard?.() ?? false,
              stamp,
              surface,
              target,
              // Drawn, and not under something that put it out of reach.
              visible: isShown(surface, { opacity: true }),
            },
          ]
        : [];
    }),
    place,
  );
  return chosen?.target;
}

/**
 * The choice behind {@link openFindForKeyboard}, given what it reads. Entries
 * are in the order they registered.
 */
export function chooseFindTarget<
  Entry extends {
    holdsKeyboard: boolean;
    stamp: number;
    surface: Element;
    visible: boolean;
  },
>(entries: Entry[], place: Element | null): Entry | undefined {
  const visible = entries.filter((entry) => entry.visible);
  const holding = visible.filter(
    (entry) =>
      entry.holdsKeyboard || (place !== null && entry.surface.contains(place)),
  );
  if (holding.length > 0) {
    return holding.reduce((inner, entry) =>
      inner.surface.contains(entry.surface) ? entry : inner,
    );
  }
  if (place?.closest('[role="dialog"], [role="alertdialog"]')) {
    return undefined;
  }
  return visible.reduce<Entry | undefined>(
    (latest, entry) =>
      latest === undefined || entry.stamp >= latest.stamp ? entry : latest,
    undefined,
  );
}

function surfaceOf(target: FindTarget): Element | null {
  const anchor = target.anchor();
  const inside = insideViewer(anchor);
  return inside?.closest("[data-find-surface]") ?? anchor;
}

/**
 * Where an element counts as being: in a toolbar drawn outside its viewer
 * (`data-find-surface-of`), the mark the toolbar left inside it, and anywhere
 * else, itself.
 */
export function insideViewer(element: Element | null): Element | null {
  const markId = element
    ?.closest("[data-find-surface-of]")
    ?.getAttribute("data-find-surface-of");
  return (markId ? document.getElementById(markId) : null) ?? element;
}

let isListening = false;

/** Marks a surface as visited whenever the keyboard or a press lands in it. */
function listenForVisits() {
  if (isListening) {
    return;
  }
  isListening = true;
  const visit = (event: Event) => {
    const into =
      event.target instanceof Element ? insideViewer(event.target) : null;
    clock += 1;
    for (const entry of registered) {
      const surface = surfaceOf(entry.target);
      if (
        entry.target.holdsKeyboard?.() ||
        (into !== null && surface?.contains(into))
      ) {
        entry.stamp = clock;
      }
    }
  };
  document.addEventListener("focusin", visit, { capture: true });
  document.addEventListener("pointerdown", visit, { capture: true });
}
