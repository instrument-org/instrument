import { zoomAtom } from "@/client/atoms/zoom";
import {
  type OutlineHeading,
  type OutlineLayout,
  useActiveHeading,
  useMarkdownHeadings,
  useOutlineLayout,
} from "@/client/hooks/use-markdown-outline";
import { flashJumpTarget } from "@/client/lib/flash-jump-target";
import { cn } from "@/client/lib/utils";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "./ui/button";
import { toolbarClassName } from "./ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// Layout px left between the top of the viewer and a heading jumped to, so it
// sits a little in from the edge rather than flush against it.
const HEADING_SCROLL_MARGIN = 24;

// Layout px kept visible above and below the active entry when the outline
// scrolls to keep it in view.
const REVEAL_MARGIN = 32;

// One bar per heading in the collapsed rail, shorter the deeper the heading,
// so the column reads as the document's structure at a glance.
const BAR_WIDTH_BY_DEPTH = ["w-4", "w-3", "w-2", "w-1.5", "w-1", "w-1"];

// Above this layout width the outline is a column of its own beside the
// document; below it, a rail over the document's gutter. The break is where the
// prose still keeps a comfortable measure after the column takes its share.
const WIDE_MIN_WIDTH = 896;

// Layout px between the viewer's edge and the rail: room for the thumb of a
// scrollbar drawn over the content, which the reader still has to be able to
// grab. A classic scrollbar's own width is added on top of it.
const SCROLLBAR_CLEARANCE = 12;

/**
 * A scrolling markdown document with its outline: the children are the
 * rendered markdown, and the outline reads the headings off them once they are
 * in the DOM.
 *
 * Where the outline goes is decided here, because the two answers are two
 * places in the tree. Wide, it is a column beside the scroll container, which
 * the reader can collapse. Narrow, or collapsed, it is a rail over the
 * document's own gutter, and it lives inside the scroll container for that:
 * a wheel over the rail then scrolls the document, as a wheel over the gutter
 * always has, where a sibling laid over the same pixels would swallow it.
 *
 * The collapse is remembered for this document and no longer; the next file
 * opens with its column back.
 */
export function MarkdownDocument({ children }: { children: ReactNode }) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [layoutElement, setLayoutElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState(false);
  const headings = useMarkdownHeadings(scrollElement);
  const layout = useOutlineLayout(scrollElement, layoutElement);
  const wide = layout.width >= WIDE_MIN_WIDTH;
  // Nothing at all for a document with fewer than two headings, where there
  // is nowhere to jump to.
  const hasOutline = headings.length >= 2;
  const column = hasOutline && wide && !collapsed;

  return (
    <div
      className="@container/markdown flex min-h-0 flex-1"
      ref={setLayoutElement}
    >
      <div
        className="relative min-w-0 flex-1 overflow-auto"
        ref={setScrollElement}
      >
        {hasOutline && !column && (
          <MarkdownOutline
            headings={headings}
            layout={layout}
            onExpand={
              wide
                ? () => {
                    setCollapsed(false);
                  }
                : undefined
            }
            scrollElement={scrollElement}
            variant="rail"
          />
        )}
        {children}
      </div>
      {column && (
        <MarkdownOutline
          headings={headings}
          layout={layout}
          onCollapse={() => {
            setCollapsed(true);
          }}
          scrollElement={scrollElement}
          variant="column"
        />
      )}
    </div>
  );
}

/**
 * The document's headings, each a jump to its section and the one being read
 * marked as such.
 *
 * As a column, the list is always showing. As a rail, it is a bar per heading
 * -- shorter the deeper -- that reads as the shape of the document, and the
 * list opens in a card over the prose while the pointer is on the rail. The
 * card covers the rail once open, so a click there is a click on an entry; the
 * rail itself is a button for the keyboard, which has no hover and so pins the
 * card open instead.
 */
export function MarkdownOutline({
  headings,
  layout,
  onCollapse,
  onExpand,
  scrollElement,
  variant,
}: {
  headings: OutlineHeading[];
  layout: OutlineLayout;
  /** Column only: hands the outline back to a rail. */
  onCollapse?: () => void;
  /** Rail only, and only where a column would fit: brings the column back. */
  onExpand?: () => void;
  scrollElement: HTMLElement | null;
  variant: "column" | "rail";
}) {
  const zoom = useAtomValue(zoomAtom);
  const spied = useActiveHeading(headings, scrollElement);
  // The entry just jumped to, held until the reader scrolls on their own. The
  // spy alone would mark the wrong entry after a jump to a heading near the
  // end, since a heading the document ends too soon after can never climb to
  // the reading line.
  const [selected, setSelected] = useState<null | number>(null);
  const [pinned, setPinned] = useState(false);
  // Whether the document is moving, from its first scroll event to
  // `scrollend`; the card keeps out of the way for the duration.
  const [scrolling, setScrolling] = useState(false);
  const programmaticScroll = useRef(false);
  const railRef = useRef<HTMLDivElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }
    const handleScroll = () => {
      setScrolling(true);
      if (!programmaticScroll.current) {
        setSelected(null);
      }
    };
    const handleScrollEnd = () => {
      setScrolling(false);
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
      // Instant, not smooth: a long document is the one where an outline is
      // worth having, and there a smooth scroll is a second or more of prose
      // streaming past. The flash is what says where the view landed.
      scrollElement.scrollTo({ behavior: "instant", top: target });
    }
    flashJumpTarget(heading.element);
  };

  const list = (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
      ref={listRef}
    >
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
  );

  if (variant === "column") {
    return (
      <nav
        aria-label="Contents"
        className="flex w-56 shrink-0 flex-col border-l border-border/60"
      >
        {/* At the column's leading edge rather than its trailing one, where
            the rail is about to be: collapsed from there, the pointer would
            land on the rail and the card would open under it at once. */}
        <div className="flex px-1.5 pt-1.5">
          <OutlineToggle label="Hide contents" onClick={onCollapse} />
        </div>
        {list}
      </nav>
    );
  }

  return (
    // Stuck to the top of the view and given no height of its own, so the
    // document flows underneath as if it were not there; everything it draws
    // is positioned out of that zero-height line.
    <nav
      aria-label="Contents"
      className="group/outline sticky top-0 z-20 h-0"
      onKeyDown={(event) => {
        if (event.key === "Escape" && pinned) {
          event.stopPropagation();
          setPinned(false);
          railButtonRef.current?.focus();
        }
      }}
    >
      {/* The rail: the height of the view, over the document's own gutter and
          clear of its scrollbar. */}
      <div
        className="absolute top-0 w-5"
        style={{
          height: layout.height,
          right: layout.scrollbarWidth + SCROLLBAR_CLEARANCE,
        }}
      >
        {/* Clipped rather than scrolled: a wheel here is meant for the
            document, and only a container that cannot scroll itself passes it
            on. The active bar is kept in view by hand. */}
        <div
          aria-hidden
          className="flex h-full flex-col overflow-hidden py-4"
          ref={railRef}
        >
          {/* Flush on the right and ragged on the left, so the column reads as
              a scrollbar with structure rather than a list without words. */}
          <div className="my-auto flex flex-col items-end gap-1">
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
        {/* The card: centered on the rail the way the bars are, no taller than
            most of the view, easing in from the rail's edge. A full-height
            sidebar snapping open over the prose reads as the layout changing;
            a card sliding out reads as a control. Its own overscroll is
            contained so reaching the end of the list does not start the
            document behind it moving.

            It opens a beat after the pointer arrives and not at all while the
            document is moving. The rail sits in the gutter, which is where a
            pointer crosses on its way to the scrollbar and where one is parked
            while a wheel scrolls the page; opened at once, the card would
            flash on every crossing and then take the wheel for its own list. */}
        <div
          className={cn(
            "invisible absolute top-1/2 right-0 z-10 flex max-h-[70%] w-64 max-w-[80cqw] translate-x-1.5 -translate-y-1/2 scale-[0.98] flex-col overflow-hidden overscroll-contain rounded-lg border border-border/60 bg-(--markdown-surface) opacity-0 shadow-lg transition-[opacity,translate,scale,visibility] duration-150 ease-out",
            pinned && "visible translate-x-0 scale-100 opacity-100",
            !pinned &&
              !scrolling &&
              "group-hover/outline:visible group-hover/outline:translate-x-0 group-hover/outline:scale-100 group-hover/outline:opacity-100 group-hover/outline:delay-100",
          )}
        >
          {onExpand && (
            <div className="flex justify-end px-1.5 pt-1.5">
              <OutlineToggle label="Show contents" onClick={onExpand} />
            </div>
          )}
          {list}
        </div>
      </div>
    </nav>
  );
}

// Rotated, because the icon draws a left-hand sidebar and the column is on the
// right.
function OutlineToggle({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={toolbarClassName({ className: "size-7", pressed: false })}
          onClick={onClick}
          size="icon-sm"
          variant="ghost"
        >
          <SidebarSimpleIcon className="size-4 rotate-180" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
