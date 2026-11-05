import { type TabView } from "@/shared/tabs";

/** How long a view is waited for: what the tab loads comes in behind its route. */
const RESTORE_LIMIT_MS = 1200;
const RESTORE_EVERY_MS = 50;

/** What a tab draws into, in the window that holds it. */
export function tabViewRoot(id: string) {
  return document.querySelector<HTMLElement>(`[data-app-tab-view="${id}"]`);
}

/** The way down to an element from the root, as the place it stands at each step. */
function pathTo(root: Element, element: Element) {
  const path: number[] = [];
  let at = element;
  while (at !== root) {
    const parent = at.parentElement;
    if (!parent) {
      return null;
    }
    path.unshift([...parent.children].indexOf(at));
    at = parent;
  }
  return path;
}

function elementAt(root: Element, path: readonly number[]) {
  let at: Element | undefined = root;
  for (const step of path) {
    at = at?.children[step];
  }
  return at;
}

/**
 * Where the keyboard and the scrolling stand in a tab, in terms another window
 * drawing the same tab can follow, since it starts with none of this one's
 * elements.
 */
export function captureTabView(root: HTMLElement | null): TabView | undefined {
  if (!root) {
    return undefined;
  }
  const scrolls = [...root.querySelectorAll("*")].flatMap((element) => {
    const { scrollLeft: left, scrollTop: top } = element;
    const path = left !== 0 || top !== 0 ? pathTo(root, element) : null;
    return path ? [{ left, path, top }] : [];
  });
  const { activeElement } = document;
  const focus =
    activeElement && root.contains(activeElement)
      ? pathTo(root, activeElement)
      : null;
  return focus || scrolls.length > 0 ? { focus, scrolls } : undefined;
}

/**
 * Puts a tab's keyboard and scrolling back as what they stand on comes in, and
 * says when that is done or no longer worth waiting for. Gives back how to stop.
 */
export function restoreTabView(
  root: HTMLElement,
  view: TabView,
  onDone: () => void,
) {
  let scrolls = view.scrolls;
  let focus = view.focus;
  const started = performance.now();
  const step = () => {
    scrolls = scrolls.filter(({ left, path, top }) => {
      const element = elementAt(root, path);
      if (!element) {
        return true;
      }
      element.scrollTo({ behavior: "instant", left, top });
      return element.scrollTop !== top || element.scrollLeft !== left;
    });
    if (focus) {
      const element = elementAt(root, focus);
      if (element instanceof HTMLElement) {
        element.focus({ preventScroll: true });
        focus = null;
      }
    }
    return (
      (scrolls.length === 0 && focus === null) ||
      performance.now() - started > RESTORE_LIMIT_MS
    );
  };
  if (step()) {
    onDone();
    return () => undefined;
  }
  const timer = setInterval(() => {
    if (step()) {
      clearInterval(timer);
      onDone();
    }
  }, RESTORE_EVERY_MS);
  return () => {
    clearInterval(timer);
  };
}

/** Resolves once what was just rendered is on screen, or soon anyway in a window not drawing. */
export function afterNextPaint() {
  return new Promise<void>((resolve) => {
    const limit = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(limit);
        resolve();
      });
    });
  });
}
