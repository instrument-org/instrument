import { keptByTab } from "@/client/lib/kept-by-tab";
import { restoreTabView, scrollsOf } from "@/client/lib/tab-view-state";
import { type TabView } from "@/shared/tabs";
import { type ReactNode, useLayoutEffect, useRef } from "react";

/** Where each group tab's screen was scrolled as another tab came up, and at what address. */
const scrollsByTab = keptByTab<{ href: string; scrolls: TabView["scrolls"] }>();

/** What a person does that takes the scrolling over from a screen putting it back. */
const TAKEOVER_EVENTS = ["keydown", "pointerdown", "wheel"] as const;

/**
 * A group tab's screen, scrolled back to where it was left as the tab comes
 * back up: a group draws only its tab up, so the screen is drawn afresh each
 * time. Whatever was scrolled in it (a document, a folder's list, the
 * columns) goes back as its content comes in, if the tab is still at the
 * address it was left at, until the person scrolls, clicks or types in it.
 * The offsets are the ones its elements reported as they scrolled, so the
 * screen going reads nothing off the page.
 */
export function KeptScrolls({
  children,
  href,
  isKept = true,
  tabId,
}: {
  children: ReactNode;
  /** Where the tab stands. */
  href: string;
  /** Whether the screen at this address goes back to where it was left; one that opens at its end keeps nothing. */
  isKept?: boolean;
  tabId: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
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
      if (target instanceof Element) {
        offsets.set(target, { left: target.scrollLeft, top: target.scrollTop });
      }
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
