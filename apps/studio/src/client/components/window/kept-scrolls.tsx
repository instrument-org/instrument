import { keptByTab } from "@/client/lib/kept-by-tab";
import {
  RESTORE_LIMIT_MS,
  restoreTabView,
  scrollsOf,
} from "@/client/lib/tab-view-state";
import { type TabView } from "@/shared/tabs";
import { type ReactNode, useLayoutEffect, useRef } from "react";

/** Where each group tab's screen was scrolled as another tab came up, and at what address. */
const scrollsByTab = keptByTab<{ href: string; scrolls: TabView["scrolls"] }>();

/** What a person does that takes the scrolling over from a screen putting it back. */
const TAKEOVER_EVENTS = ["keydown", "pointerdown", "wheel"] as const;

/**
 * A group tab's screen, scrolled back to where it was left as the tab comes
 * back up, for one drawn afresh: a screen let go from behind the tab up, or
 * come back to after a launch. Whatever was scrolled in it (a document, a folder's list, the
 * columns) goes back as its content comes in, if the tab is still at the
 * address it was left at, until the person scrolls, clicks or types in it.
 * The offsets are the ones its elements reported as they scrolled, so the
 * screen going reads nothing off the page.
 *
 * A screen kept drawn out of sight (`kept-screens.ts`) never lost where it
 * was scrolled, but the keyboard coming back to it can move it: an editor
 * given the caret scrolls to it. So for the same moment after it is shown
 * again, anything that scrolls it without the person is put back.
 */
export function KeptScrolls({
  children,
  href,
  isKept = true,
  isShown = true,
  tabId,
}: {
  children: ReactNode;
  /** Where the tab stands. */
  href: string;
  /** Whether the screen at this address goes back to where it was left; one that opens at its end keeps nothing. */
  isKept?: boolean;
  /** Whether the screen is on screen, rather than kept drawn behind another. */
  isShown?: boolean;
  tabId: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Until when a screen shown again holds its offsets against whatever
  // scrolls it, in the clock `performance.now()` reads.
  const heldUntil = useRef(0);
  const wasShown = useRef(isShown);
  useLayoutEffect(() => {
    if (isShown && !wasShown.current && isKept) {
      heldUntil.current = performance.now() + RESTORE_LIMIT_MS;
    }
    wasShown.current = isShown;
  }, [isKept, isShown]);
  const hrefNow = useRef(href);
  const isKeptNow = useRef(isKept);
  useLayoutEffect(() => {
    hrefNow.current = href;
    isKeptNow.current = isKept;
  });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const offsets = new Map<Element, { left: number; top: number }>();
    const onScroll = (event: Event) => {
      const { target } = event;
      if (!(target instanceof Element)) {
        return;
      }
      const left = offsets.get(target);
      if (
        left !== undefined &&
        performance.now() < heldUntil.current &&
        (target.scrollTop !== left.top || target.scrollLeft !== left.left)
      ) {
        target.scrollTo({ behavior: "instant", ...left });
        return;
      }
      offsets.set(target, { left: target.scrollLeft, top: target.scrollTop });
    };
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });

    const kept = scrollsByTab.get(tabId);
    let isRestoring =
      kept !== undefined && kept.href === hrefNow.current && isKeptNow.current;
    let stopRestoring: (() => void) | undefined;
    // Put back once the screen is laid out at the width it is shown at: a tab
    // drawn as its group comes up stands for a frame in a split still at the
    // last group's widths, where a document runs to another height and an
    // offset put back there drifts as it reflows. Before that frame's paint.
    let laidOut: ResizeObserver | undefined;
    if (kept && isRestoring) {
      laidOut = new ResizeObserver(() => {
        laidOut?.disconnect();
        if (isRestoring) {
          stopRestoring = restoreTabView(
            root,
            { focus: null, scrolls: kept.scrolls },
            () => {
              isRestoring = false;
            },
          );
        }
      });
      laidOut.observe(root.parentElement ?? root);
    }
    const takeOver = () => {
      heldUntil.current = 0;
      laidOut?.disconnect();
      stopRestoring?.();
      isRestoring = false;
    };
    for (const type of TAKEOVER_EVENTS) {
      root.addEventListener(type, takeOver, { capture: true, passive: true });
    }
    return () => {
      laidOut?.disconnect();
      stopRestoring?.();
      root.removeEventListener("scroll", onScroll, { capture: true });
      for (const type of TAKEOVER_EVENTS) {
        root.removeEventListener(type, takeOver, { capture: true });
      }
      // Gone again before it was put back: it stands where it was left.
      if (kept && isRestoring) {
        return;
      }
      const scrolls = isKeptNow.current ? scrollsOf(root, offsets) : [];
      if (scrolls.length > 0) {
        scrollsByTab.set(tabId, { href: hrefNow.current, scrolls });
      } else {
        scrollsByTab.delete(tabId);
      }
    };
  }, [tabId]);
  return (
    <div className="contents" ref={rootRef}>
      {children}
    </div>
  );
}
