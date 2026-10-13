import {
  keyboardPlace,
  listenForKeyboardPlace,
} from "@/client/lib/keyboard-place";

/**
 * The surfaces Cmd+F can open a search in, and which one a press means.
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
 * those surfaces are passed over. Inside a dialog
 * that registers nothing, the press is the dialog's and opens nothing behind
 * it.
 */
type FindTarget = {
  /** An element inside the target; null while it is not mounted. */
  anchor: () => Element | null;
  /** The keyboard is in this target although no element of its surface holds it: a browser page, whose `<webview>` is mounted on the body. */
  holdsKeyboard?: () => boolean;
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
  const place = keyboardPlace();
  const chosen = chooseFindTarget(
    registered.flatMap(({ stamp, target }) => {
      const surface = surfaceOf(target);
      return surface
        ? [
            {
              holdsKeyboard: target.holdsKeyboard?.() ?? false,
              stamp,
              surface,
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
  chosen?.target.openFind();
  return chosen !== undefined;
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
  return anchor?.closest("[data-find-surface]") ?? anchor;
}

let isListening = false;

/** Marks a surface as visited whenever the keyboard or a press lands in it. */
function listenForVisits() {
  if (isListening) {
    return;
  }
  isListening = true;
  const visit = (event: Event) => {
    const into = event.target instanceof Node ? event.target : null;
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
