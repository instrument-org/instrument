import { zoomAtom } from "@/client/atoms/zoom";
import {
  type OutlineHeading,
  useActiveHeading,
  useMarkdownHeadings,
} from "@/client/hooks/use-markdown-outline";
import { cn } from "@/client/lib/utils";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

// Layout px left between the top of the viewer and a heading jumped to, so it
// sits a little in from the edge rather than flush against it.
const HEADING_SCROLL_MARGIN = 24;

// Layout px kept visible above and below the active entry when the outline
// scrolls to keep it in view.
const REVEAL_MARGIN = 32;

// One bar per heading in the collapsed rail, shorter the deeper the heading,
// so the column reads as the document's structure at a glance.
const BAR_WIDTH_BY_DEPTH = ["w-4", "w-3", "w-2", "w-1.5", "w-1", "w-1"];

/**
 * A scrolling markdown document with its outline beside it: the children are
 * the rendered markdown, and the outline reads the headings off them once they
 * are in the DOM. Declares the container the outline's wide and narrow forms
 * are chosen against, which is the viewer's own width rather than the window's
 * -- the artifact panel is resizable and the window is zoomable.
 */
export function MarkdownDocument({ children }: { children: ReactNode }) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  return (
    <div className="@container/markdown flex min-h-0 flex-1">
      <div
        className="relative min-w-0 flex-1 overflow-auto"
        ref={setScrollElement}
      >
        {children}
      </div>
      <MarkdownOutline scrollElement={scrollElement} />
    </div>
  );
}

/**
 * The document's headings beside the document, each a jump to its section and
 * the one being read marked as such.
 *
 * Wide, it is a column of its own with the list always showing. Narrow, the
 * column shrinks to a rail of bars -- one per heading, shorter the deeper --
 * that reads as the shape of the document, and the list opens over the prose
 * while the pointer is on the rail. The list covers the rail once open, so a
 * click there is a click on an entry; the rail itself is a button for the
 * keyboard, which has no hover and so pins the list open instead. It is nothing
 * at all for a document with fewer than two headings, where there is nowhere
 * to jump to.
 */
export function MarkdownOutline({
  scrollElement,
}: {
  scrollElement: HTMLElement | null;
}) {
  const zoom = useAtomValue(zoomAtom);
  const headings = useMarkdownHeadings(scrollElement);
  const spied = useActiveHeading(headings, scrollElement);
  // The entry just jumped to, held until the reader scrolls on their own. The
  // spy alone would mark the wrong entry after a jump to a heading near the
  // end, since a heading the document ends too soon after can never climb to
  // the reading line.
  const [selected, setSelected] = useState<null | number>(null);
  const [pinned, setPinned] = useState(false);
  const programmaticScroll = useRef(false);
  const railRef = useRef<HTMLDivElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }
    const handleScroll = () => {
      if (!programmaticScroll.current) {
        setSelected(null);
      }
    };
    const handleScrollEnd = () => {
      programmaticScroll.current = false;
    };
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    scrollElement.addEventListener("scrollend", handleScrollEnd);
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      scrollElement.removeEventListener("scrollend", handleScrollEnd);
    };
  }, [scrollElement]);

  const active =
    selected !== null && selected < headings.length ? selected : spied;

  useEffect(() => {
    for (const container of [railRef.current, listRef.current]) {
      const item = container?.querySelector<HTMLElement>(
        `[data-heading="${active}"]`,
      );
      if (container && item) {
        revealWithin(container, item);
      }
    }
  }, [active]);

  if (headings.length < 2) {
    return null;
  }

  const minLevel = Math.min(...headings.map((heading) => heading.level));
  const depthOf = (heading: OutlineHeading) =>
    Math.min(heading.level - minLevel, BAR_WIDTH_BY_DEPTH.length - 1);

  const jumpTo = (index: number) => {
    const heading = headings[index];
    if (!scrollElement || !heading) {
      return;
    }
    const viewport = scrollElement.getBoundingClientRect();
    const rect = heading.element.getBoundingClientRect();
    // The rect delta is on-screen px and `scrollTop` is layout px.
    const target = Math.max(
      0,
      scrollElement.scrollTop +
        (rect.top - viewport.top) / zoom -
        HEADING_SCROLL_MARGIN,
    );
    setSelected(index);
    setPinned(false);
    // A jump to where the document already is fires no scroll events, so
    // nothing would ever clear the flag.
    if (Math.abs(target - scrollElement.scrollTop) >= 1) {
      programmaticScroll.current = true;
      scrollElement.scrollTo({ behavior: "smooth", top: target });
    }
  };

  // Above `@min-[896px]/markdown` the outline is a column of its own beside
  // the document, with the full list always showing. Below it, the column is
  // a rail of bars and the list opens over the document on demand. The break
  // is where the prose still keeps a comfortable measure after the column
  // takes its share.
  return (
    <nav
      aria-label="Contents"
      className="group/outline relative w-6 shrink-0 @min-[896px]/markdown:w-56 @min-[896px]/markdown:border-l @min-[896px]/markdown:border-border/60"
      onKeyDown={(event) => {
        if (event.key === "Escape" && pinned) {
          event.stopPropagation();
          setPinned(false);
          railButtonRef.current?.focus();
        }
      }}
    >
      <div className="absolute inset-y-0 right-0 w-6 @min-[896px]/markdown:hidden">
        <div
          aria-hidden
          className="scrollbar-hide flex h-full flex-col overflow-y-auto py-4"
          ref={railRef}
        >
          <div className="my-auto flex flex-col items-start gap-1 pl-1">
            {headings.map((heading, index) => (
              <span
                className={cn(
                  "h-0.5 shrink-0 rounded-full",
                  BAR_WIDTH_BY_DEPTH[depthOf(heading)],
                  index === active ? "bg-foreground" : "bg-muted-foreground/35",
                )}
                data-heading={index}
                key={index}
              />
            ))}
          </div>
        </div>
        <button
          aria-expanded={pinned}
          aria-label="Contents"
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setPinned((value) => !value);
          }}
          ref={railButtonRef}
          type="button"
        />
      </div>
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-10 w-64 max-w-[80cqw] border-l border-border/60 bg-(--markdown-surface) shadow-lg @min-[896px]/markdown:visible @min-[896px]/markdown:static @min-[896px]/markdown:w-full @min-[896px]/markdown:max-w-none @min-[896px]/markdown:border-l-0 @min-[896px]/markdown:shadow-none",
          pinned ? "visible" : "invisible group-hover/outline:visible",
        )}
      >
        <div
          className="relative h-full overflow-y-auto py-4 pr-2 pl-2"
          ref={listRef}
        >
          <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
            Contents
          </div>
          {headings.map((heading, index) => (
            <button
              aria-current={index === active ? "location" : undefined}
              className={cn(
                "relative block w-full truncate rounded-md py-1 pr-2 text-left text-xs/5 hover:bg-muted hover:text-foreground",
                index === active
                  ? "text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground"
                  : "text-muted-foreground",
              )}
              data-heading={index}
              key={index}
              onClick={() => {
                jumpTo(index);
              }}
              style={{ paddingLeft: `${0.5 + depthOf(heading) * 0.75}rem` }}
              title={heading.text}
              type="button"
            >
              {heading.text}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

// Scrolls `list` the least amount that brings `item` into view with a margin,
// touching nothing outside the list. `scrollIntoView` is the obvious call and
// the wrong one: it also scrolls every ancestor that needs it to show the item,
// which here includes the document the reader is in the middle of.
function revealWithin(list: HTMLElement, item: HTMLElement) {
  const top = item.offsetTop - REVEAL_MARGIN;
  const bottom = item.offsetTop + item.offsetHeight + REVEAL_MARGIN;
  if (top < list.scrollTop) {
    list.scrollTop = top;
  } else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight;
  }
}
