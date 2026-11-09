import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { clamp } from "radashi";
import {
  animate,
  cancelFrame,
  frame,
  motion,
  Reorder,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IconGlint, ShimmerSweep } from "@/client/components/shimmer-sweep";

import { EDGE_FADE, EDGE_FADE_WIDTH, useEdgeFade } from "./use-edge-fade";

/** A tab on the strip: what it is called and what stands for it. */
export interface StripTab {
  /**
   * Something the tab carries after its name: a count of what arrived in it
   * while the user was elsewhere. Kept when the row compresses, since a number
   * is the one thing a narrow tab still has room to say.
   */
  badge?: ReactNode;
  icon: ReactNode;
  /** Drawn first and held there: not dragged, not closed. */
  isFixed?: boolean;
  /**
   * A second drawing of a one-color icon, which takes the shimmer's color and
   * its glint while the tab works. Left out for a picture, which stays as it is.
   */
  glintIcon?: ReactNode;
  /** An agent is at work in it: its name shimmers, and its icon with `glintIcon`. */
  isWorking?: boolean;
  key: string;
  title: string;
  /**
   * What hovering the tab says in place of its bare name: the whole name
   * (`title` may be a shortened one) over a line the tab has no room for,
   * such as where it is. Without it the name alone is the tab's tooltip.
   */
  tooltip?: { detail?: ReactNode; title: string };
}

// The strip's measurements, in layout px. `GAP` is the `gap-1` between tabs.
const GAP = 4;
// A tab with nothing in it but its icon: a square at the strip's tab height.
const MIN_TAB = 32;
// A centered icon and a close, clear of each other.
const CLOSE_FITS = 60;
// An icon at the head of the tab and a few characters of name after it.
const NAME_FITS = 80;
// The control that adds a tab, and the gap it holds: room the tabs cannot use.
const NEW_TAB_ROOM = 32 + GAP;
// The `mr-3` holding a fixed tab off the rest, on top of the gap.
const FIXED_MARGIN = 12;
// The row's own `px-2` on each side, which its tabs cannot use.
const ROW_PADDING = 16;

// Lands a tab at its new place rather than moving it there; the projection
// stays on so a drag can still reorder around it.
const LAND_IN_PLACE = { layout: { duration: 0 } };

// How a tab let go settles into its place, however fast it was moving: critically
// damped, so it arrives at once and does not hang short of its place or pass it.
const SETTLE_SPRING = { stiffness: 1000, damping: 63 };
const SETTLE = { type: "spring", ...SETTLE_SPRING } as const;
const SETTLE_DRAG = {
  bounceDamping: SETTLE_SPRING.damping,
  bounceStiffness: SETTLE_SPRING.stiffness,
};

// How the tabs beside one being dragged make way for it.
const MAKE_WAY = { layout: { duration: 0.2, ease: [0.4, 0, 0.1, 1] } } as const;

// A tab gives its place in the row up and takes it back with a motion, the tabs
// beside it following: a transition on real layout, and the one thing about a tab
// being dragged that does not follow the pointer.
const GIVES_PLACE_UP =
  "transition-[flex-grow,margin-right,min-width,opacity,padding] duration-(--tab-motion) ease-out motion-reduce:transition-none";

// A closing tab gives its share of the row up rather than being taken out of
// it, so the tabs beside it widen as it narrows: a transition on real layout
// rather than an exit animation.
const COLLAPSED = {
  flexGrow: 0,
  marginRight: -GAP,
  minWidth: 0,
  opacity: 0,
  paddingLeft: 0,
  paddingRight: 0,
} satisfies React.CSSProperties;

// How long a tab takes to leave the row or to arrive in it; the `pane-tab-in`
// keyframe in `globals.css` reads the same number off `--tab-motion`.
const TAB_MOTION_MS = 150;
const TAB_MOTION = {
  "--tab-motion": `${TAB_MOTION_MS}ms`,
} as React.CSSProperties;

// What the tab being read stands on: the page's own surface, lifted off the
// bar as a card, the way a browser draws its selected tab. A tint of
// the bar's own hue sat too close to the bar to read as chosen. A strip on
// another ground names its own in `--tab-selected`.
const SELECTED = {
  backgroundColor: "var(--tab-selected, var(--background))",
} satisfies React.CSSProperties;

// What a tab stands on while it is being carried over the others.
const CARRIED = {
  backgroundColor: "var(--card)",
} satisfies React.CSSProperties;

// Cuts off tabs past the row's end, with room left around them for the selected
// tab's shadow, which a row exactly as tall as its tabs would slice flat.
const TAB_ROW =
  "flex min-w-0 flex-1 items-center gap-1 overflow-clip [overflow-clip-margin:4px]";

// The room around the tabs inside a scrolling row, the `p-1` it draws, in layout
// px. A scroller clips at its padding edge whatever `overflow-clip-margin` says,
// so a row exactly as tall as its tabs would slice the selected tab's shadow flat.
const SCROLL_ROOM = 4;

interface StripLayout {
  density: TabDensity;
  fixedIsNamed: boolean;
  selectedDensity: TabDensity;
  visibleCount: number;
}

type TabDensity = "compact" | "full" | "icon";

/**
 * A row of tabs: an even share of
 * the row each, compressing together to icons rather than scrolling, the one
 * being read held wide enough for its name and close, dragged to reorder,
 * closed by the middle button or the cross, and arriving and leaving with a
 * motion rather than a jump. With `overflow="scroll"` each tab keeps the width
 * its name needs and the row scrolls sideways instead, keeping the tab up in
 * view. The window's bar and a chat's pane both draw theirs with it, so a tab
 * is one thing across the window.
 */
export function TabStrip({
  carriedKey,
  heldAt,
  className,
  groupKey,
  isStill,
  label = "Open tabs",
  newControl,
  onClose,
  onContextMenu,
  newMenu,
  onNew,
  onReorder,
  onSelect,
  onTabDrag,
  onTabDragEnd,
  onTabDragStart,
  overflow = "compress",
  selectedKey,
  tabs,
}: {
  /** A tab being carried out of the strip, which gives its place up to the tabs beside it. */
  carriedKey?: string | undefined;
  /** A tab in the pointer's hand, from this strip or another, drawn with its left edge at this on-screen point. */
  heldAt?: { key: string; left: number } | undefined;
  className?: string;
  /** Drawn as a plus at the end of the row when given. */
  /** The set these tabs belong to; when it changes the strip adopts them silently. */
  groupKey?: string;
  /** The tabs are changing with nobody to see it, so nothing comes or goes with a motion. */
  isStill?: boolean;
  /** What the row is called to a screen reader. */
  label?: string;
  /** Drawn where the plus is, for a strip whose new tab is a choice: a menu's trigger around `NewTabButton`. */
  newControl?: ReactNode;
  onClose: (key: string) => void;
  /** A right click on a tab, for a menu the caller draws. */
  onContextMenu?: (key: string, event: React.MouseEvent) => void;
  /** What a right click on the plus offers: a menu's content, the tabs closed lately. */
  newMenu?: ReactNode;
  onNew?: () => void;
  /** Where the strip's own reorder puts a dragged tab, for an owner that has it place them. */
  onReorder?: (keys: string[]) => void;
  onSelect: (key: string) => void;
  /** Where a tab being dragged is, which the strip's own reorder keeps to its row. */
  onTabDrag?: (key: string, event: PointerEvent) => void;
  onTabDragEnd?: (key: string, event: PointerEvent) => void;
  /** A tab's drag has started, `moved` px along from where it was pressed. */
  onTabDragStart?: (key: string, event: PointerEvent, moved: number) => void;
  /**
   * Past the row's room, tabs compress toward icons; or keep their width and
   * the row scrolls; or compress, and once even icons do not fit, the row
   * scrolls its icons with the one up still named (`squeeze`).
   */
  overflow?: "compress" | "scroll" | "squeeze";
  selectedKey: string | undefined;
  tabs: StripTab[];
}) {
  const squeezes = overflow === "squeeze";
  // Whether a squeezing row has room for every tab as at least an icon.
  const [iconsFit, setIconsFit] = useState(true);
  const scrolls = overflow === "scroll" || (squeezes && !iconsFit);
  const plus =
    newControl ??
    (onNew ? (
      <ContextMenu>
        <ToolbarTooltip chord="newTab" label="New tab">
          <ContextMenuTrigger asChild disabled={newMenu === undefined}>
            <NewTabButton onClick={onNew} />
          </ContextMenuTrigger>
        </ToolbarTooltip>
        {newMenu}
      </ContextMenu>
    ) : null);
  const hasNew = plus !== null;
  const fixedTabs = tabs.filter((tab) => tab.isFixed);
  const movableTabs = tabs.filter((tab) => !tab.isFixed);
  const movableKeys = movableTabs.map((tab) => tab.key);
  const orderedKeys = tabs.map((tab) => tab.key);
  const prefersReducedMotion = useReducedMotion();

  const rowRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [draggingKey, setDraggingKey] = useState<string>();
  let lifted: string | undefined;
  if (draggingKey !== undefined) {
    lifted = scrolls ? `[data-tab-key="${draggingKey}"]` : '[role="tab"]';
  }
  useEdgeFade(scrolls ? scrollerRef : areaRef, { lifted, scrolls });
  const [closing, setClosing] = useState<{ index: number; tab: StripTab }[]>(
    [],
  );
  const [arriving, setArriving] = useState<string[]>([]);
  // The tabs as last drawn, so a tab gone from the list since is drawn on its
  // way out from wherever it went: its own cross, the middle button, a chord,
  // a menu, or anything else that closed it.
  const [seen, setSeen] = useState(movableTabs);
  const [group, setGroup] = useState(groupKey);
  const [measuredLayout, setLayout] = useState(() =>
    stripLayout(0, movableTabs.length, fixedTabs.length),
  );

  const isListChanged =
    movableKeys.length !== seen.length ||
    movableKeys.some((key, index) => key !== seen[index]?.key);
  if (
    group !== groupKey ||
    (seen.length > 0 &&
      !seen.some((tab) => movableKeys.includes(tab.key)) &&
      movableKeys.length > 0) ||
    (isStill && (isListChanged || arriving.length + closing.length > 0))
  ) {
    // The whole strip was swapped for another set (another window), so
    // none of these tabs are arriving: they were already open, somewhere the
    // user was not looking, and animating them in makes a switch feel like
    // five tabs opening at once.
    setGroup(groupKey);
    setSeen(movableTabs);
    setArriving([]);
    setClosing([]);
  } else if (isListChanged) {
    const seenKeys = seen.map((tab) => tab.key);
    const opened = movableKeys.filter((key) => !seenKeys.includes(key));
    const closed = seen.flatMap((tab, index) =>
      movableKeys.includes(tab.key) ? [] : [{ index, tab }],
    );
    setSeen(movableTabs);
    if (opened.length > 0) {
      setArriving((current) => [...current, ...opened]);
    }
    if (closed.length > 0 && !prefersReducedMotion) {
      setClosing((current) => [
        ...current.filter(
          ({ tab }) => !closed.some((gone) => gone.tab.key === tab.key),
        ),
        ...closed,
      ]);
    }
  }

  useEffect(() => {
    if (arriving.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setArriving([]);
    }, TAB_MOTION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [arriving]);

  useEffect(() => {
    if (closing.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setClosing([]);
    }, TAB_MOTION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [closing]);

  // Collapsing is not the same as closed: a tab reopened on its way out is in
  // the list again and is drawn whole.
  const collapsing = closing.filter(
    ({ tab }) => !movableKeys.includes(tab.key),
  );
  const collapsingKeys = new Set(collapsing.map(({ tab }) => tab.key));
  const drawnCount = movableTabs.length + collapsing.length;
  const fixedCount = fixedTabs.length;
  // A row that scrolls has room for every tab at its full width, or, squeezed
  // past its icons, for every tab as an icon and the one up named.
  let layout = measuredLayout;
  if (scrolls) {
    layout = squeezes
      ? {
          density: "icon",
          fixedIsNamed: false,
          selectedDensity: "full",
          visibleCount: drawnCount,
        }
      : stripLayout(0, drawnCount, fixedCount);
  }
  const { density, fixedIsNamed, selectedDensity, visibleCount } = layout;

  // A squeezing row measures itself whichever way it is drawn, since the
  // strip inside it is as wide as its tabs once it scrolls.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!squeezes || !row) {
      return;
    }
    const apply = () => {
      const room = row.clientWidth - ROW_PADDING - (hasNew ? NEW_TAB_ROOM : 0);
      setIconsFit(
        stripLayout(room, drawnCount, fixedCount).visibleCount >= drawnCount,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [drawnCount, fixedCount, hasNew, squeezes]);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const area = areaRef.current;
    if (scrolls || !strip || !area) {
      return;
    }
    const apply = () => {
      const row = stripLayout(
        strip.clientWidth - (fixedCount > 0 ? FIXED_MARGIN : 0),
        drawnCount,
        fixedCount,
      );
      const files = stripLayout(
        area.clientWidth - (hasNew ? NEW_TAB_ROOM : 0),
        drawnCount,
        0,
      );
      const next = { ...files, fixedIsNamed: row.density === "full" };
      setLayout((current) =>
        current.density === next.density &&
        current.fixedIsNamed === next.fixedIsNamed &&
        current.selectedDensity === next.selectedDensity &&
        current.visibleCount === next.visibleCount
          ? current
          : next,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(strip);
    observer.observe(area);
    return () => {
      observer.disconnect();
    };
  }, [drawnCount, fixedCount, hasNew, scrolls]);

  // A scrolling row keeps the tab up in view, gliding to it as it changes or a
  // tab opens, and again once an opening tab has grown to its width.
  useEffect(() => {
    if (!scrolls) {
      return;
    }
    showTab(scrollerRef.current, selectedKey, "smooth");
    const timer = setTimeout(() => {
      showTab(scrollerRef.current, selectedKey, "smooth");
    }, TAB_MOTION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [scrolls, selectedKey, tabs.length]);
  const showSelectedAtOnce = useEffectEvent(() => {
    showTab(scrollerRef.current, selectedKey, "instant");
  });
  // A narrower row would otherwise slide its end over the selected tab's far
  // side. This watches the row rather than the scroller, whose width also
  // follows the tabs, so that a tab opening still glides into view.
  useEffect(() => {
    const row = rowRef.current;
    if (!scrolls || !row) {
      return;
    }
    const observer = new ResizeObserver(() => {
      showSelectedAtOnce();
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [scrolls]);

  // The run of tabs there is room for, kept over the selection.
  const selectedIndex = movableKeys.indexOf(selectedKey ?? "");
  const liveCount = Math.max(0, visibleCount - collapsing.length);
  const start = Math.max(
    0,
    Math.min(selectedIndex - liveCount + 1, movableTabs.length - liveCount),
  );
  const visibleTabs = movableTabs.slice(start, start + liveCount);
  const visibleKeys = movableKeys.slice(start, start + liveCount);

  // A closing tab collapses where it stood among the tabs in view, by its
  // place in the whole row, ahead of anything since closed beside it.
  const drawnTabs = visibleTabs.map((tab) => ({ isClosing: false, tab }));
  for (const { index, tab } of collapsing.toSorted(
    (a, b) => a.index - b.index,
  )) {
    drawnTabs.splice(
      Math.min(Math.max(index - start, 0), drawnTabs.length),
      0,
      { isClosing: true, tab },
    );
  }
  const drawnKeys = drawnTabs.map(({ tab }) => tab.key);

  if (draggingKey !== undefined && !visibleKeys.includes(draggingKey)) {
    setDraggingKey(undefined);
  }
  const isReordering = draggingKey !== undefined || heldAt !== undefined;

  const selectRelative = (from: string, direction: -1 | 1) => {
    const index = orderedKeys.indexOf(from);
    if (index === -1) {
      return;
    }
    const next =
      orderedKeys[
        (index + direction + orderedKeys.length) % orderedKeys.length
      ];
    if (next !== undefined) {
      onSelect(next);
    }
  };

  const reorderGroup = (
    <Reorder.Group
      as="div"
      axis="x"
      className={
        scrolls ? "flex shrink-0 items-center gap-1" : cn(TAB_ROW, EDGE_FADE)
      }
      onReorder={(keys: string[]) => {
        onReorder?.([
          ...movableKeys.slice(0, start),
          ...keys.filter((key) => !collapsingKeys.has(key)),
          ...movableKeys.slice(start + liveCount),
        ]);
      }}
      ref={areaRef}
      role="none"
      values={drawnKeys}
    >
      {drawnTabs.map(({ isClosing, tab }, index) => (
        <Tab
          density={tab.key === selectedKey ? selectedDensity : density}
          isArriving={arriving.includes(tab.key)}
          isCarried={carriedKey === tab.key}
          isClosing={isClosing}
          isDragging={draggingKey === tab.key}
          isScrolled={scrolls}
          isStill={isStill}
          isPlacedByOwner={onReorder === undefined}
          isReordering={isReordering}
          {...(heldAt?.key === tab.key ? { heldLeft: heldAt.left } : {})}
          isSelected={tab.key === selectedKey}
          key={tab.key}
          nextIsSelected={drawnKeys[index + 1] === selectedKey}
          onClose={() => {
            // A tab already on its way out is not closed twice: the
            // second close would keep it collapsing rather than gone.
            if (isClosing) {
              return;
            }
            onClose(tab.key);
          }}
          onContextMenu={(event) => {
            onContextMenu?.(tab.key, event);
          }}
          onDrag={(event) => {
            if (event instanceof PointerEvent) {
              onTabDrag?.(tab.key, event);
            }
          }}
          onDragEnd={(event) => {
            setDraggingKey(undefined);
            // The selected tab's new place may be past the row's end.
            // Dropping any other tab leaves the row where it is.
            if (scrolls && tab.key === selectedKey) {
              showTab(scrollerRef.current, tab.key, "smooth");
            }
            if (event instanceof PointerEvent) {
              onTabDragEnd?.(tab.key, event);
            }
          }}
          onDragStart={(event, moved) => {
            setDraggingKey(tab.key);
            if (event instanceof PointerEvent) {
              onTabDragStart?.(tab.key, event, moved);
            }
          }}
          onSelect={() => {
            onSelect(tab.key);
          }}
          onSelectRelative={(direction) => {
            selectRelative(tab.key, direction);
          }}
          // The last tab keeps its hairline against the new-tab control,
          // so the control reads as part of the row rather than adrift.
          showSeparator={index < drawnTabs.length - 1 || hasNew}
          tab={tab}
          value={tab.key}
        />
      ))}
      {/* Inside the row rather than after it, so it sits against the last
          tab while the tabs are short of the row and is pushed to the end
          once they fill it. It is not one of the values, so the drag
          never counts it. A scrolling row has it after the scroller, where
          it stays in view. */}
      {scrolls ? null : plus}
    </Reorder.Group>
  );

  return (
    <div
      className={cn("flex h-10 shrink-0 items-center gap-1 px-2", className)}
      ref={rowRef}
      style={TAB_MOTION}
    >
      <div
        aria-label={label}
        className={scrolls ? "flex min-w-0 flex-1 items-center gap-1" : TAB_ROW}
        data-density={density}
        data-tab-count={tabs.length}
        ref={stripRef}
        role="tablist"
      >
        {fixedTabs.map((tab, index) => (
          <Tab
            density={selectedKey === tab.key || fixedIsNamed ? "full" : "icon"}
            isFixed
            isSelected={selectedKey === tab.key}
            key={tab.key}
            nextIsSelected={
              (fixedTabs[index + 1]?.key ?? visibleKeys[0]) === selectedKey
            }
            onContextMenu={(event) => {
              onContextMenu?.(tab.key, event);
            }}
            onSelect={() => {
              onSelect(tab.key);
            }}
            onSelectRelative={(direction) => {
              selectRelative(tab.key, direction);
            }}
            showSeparator={index < fixedTabs.length - 1 || drawnCount > 0}
            tab={tab}
          />
        ))}
        {scrolls ? (
          <>
            <motion.div
              className={cn(
                "-m-1 flex min-w-0 [scrollbar-width:none] overflow-x-auto p-1",
                EDGE_FADE,
              )}
              layoutScroll
              // Refusing a middle press takes its mousedown with it, which is
              // what would start the system's autoscroll in a row that scrolls.
              onPointerDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                }
              }}
              // A wheel that only turns up and down scrolls the row sideways.
              onWheel={(event) => {
                const list = event.currentTarget;
                if (
                  list.scrollWidth > list.clientWidth &&
                  Math.abs(event.deltaY) > Math.abs(event.deltaX)
                ) {
                  list.scrollLeft += event.deltaY;
                }
              }}
              ref={scrollerRef}
            >
              {reorderGroup}
            </motion.div>
            {plus}
          </>
        ) : (
          reorderGroup
        )}
      </div>
    </div>
  );
}

/** The strip's plus, for a strip that wraps it in a trigger of its own (`newControl`). */
export function NewTabButton(props: ComponentProps<"button">) {
  return (
    <button
      aria-label="New tab"
      className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground/70 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
      type="button"
      {...props}
    >
      <PlusIcon className="size-4" />
    </button>
  );
}

/**
 * Scrolls a tab clear of its row's ends and of their fades, which are there only
 * where the row goes on: at its very end the scroll stops short, with the
 * padding's room left. Offsets are layout px, which is what scrollLeft is in
 * under the window's zoom.
 */
function showTab(
  list: HTMLElement | null,
  key: string | undefined,
  behavior: ScrollBehavior,
) {
  const tab = [
    ...(list?.querySelectorAll<HTMLElement>("[data-tab-key]") ?? []),
  ].find((element) => element.dataset.tabKey === key);
  if (!list || !tab) {
    return;
  }
  const room = SCROLL_ROOM + EDGE_FADE_WIDTH;
  const left = tab.offsetLeft - room;
  const right = tab.offsetLeft + tab.offsetWidth + room;
  if (left < list.scrollLeft) {
    list.scrollTo({ behavior, left });
  } else if (right > list.scrollLeft + list.clientWidth) {
    list.scrollTo({ behavior, left: right - list.clientWidth });
  }
}

/** Move focus one tab along the strip, wrapping, to match the selection. */
function focusSiblingTab(from: Element, direction: -1 | 1) {
  const strip = from.closest('[role="tablist"]');
  if (!strip) {
    return;
  }
  const tabs = [...strip.querySelectorAll('[role="tab"]:not([aria-hidden])')];
  const index = tabs.indexOf(from);
  if (index === -1) {
    return;
  }
  const next = tabs[(index + direction + tabs.length) % tabs.length];
  if (next instanceof HTMLElement) {
    next.focus();
  }
}

/** What the strip can draw, from the room it has and the tabs sharing it. */
function stripLayout(
  available: number,
  count: number,
  fixedCount: number,
): StripLayout {
  const total = count + fixedCount;
  if (available <= 0 || total === 0) {
    return {
      density: "full",
      fixedIsNamed: true,
      selectedDensity: "full",
      visibleCount: count,
    };
  }

  const visibleCount = Math.min(
    count,
    Math.max(1, Math.floor((available + GAP) / (MIN_TAB + GAP)) - fixedCount),
  );
  const content = available - GAP * (visibleCount + fixedCount - 1);
  const equalShare = content / Math.max(1, visibleCount + fixedCount);

  if (equalShare >= NAME_FITS) {
    return {
      density: "full",
      fixedIsNamed: true,
      selectedDensity: "full",
      visibleCount,
    };
  }

  const reserved = Math.min(
    NAME_FITS,
    content - MIN_TAB * (visibleCount + fixedCount - 1),
  );
  if (visibleCount <= 1 || reserved < CLOSE_FITS) {
    const density = tabDensity(equalShare);
    return {
      density,
      fixedIsNamed: false,
      selectedDensity: density,
      visibleCount,
    };
  }

  return {
    density: tabDensity((content - reserved) / (visibleCount - 1)),
    fixedIsNamed: false,
    selectedDensity: tabDensity(reserved),
    visibleCount,
  };
}

function Tab({
  density,
  heldLeft,
  isArriving,
  isCarried,
  isClosing,
  isDragging,
  isFixed,
  isPlacedByOwner,
  isReordering,
  isScrolled,
  isSelected,
  isStill,
  nextIsSelected,
  onClose,
  onContextMenu,
  onDrag,
  onDragEnd,
  onDragStart,
  onSelect,
  onSelectRelative,
  showSeparator,
  tab,
  value,
}: {
  density: TabDensity;
  /** In the pointer's hand: where its left edge stands, on screen. */
  heldLeft?: number;
  isArriving?: boolean;
  isCarried?: boolean;
  /** Its strip's owner says where a dragged tab goes, so the reorder's own idea is drawn nowhere. */
  isPlacedByOwner?: boolean;
  /** Its strip is changing with nobody to see it, so nothing is on its way anywhere. */
  isStill?: boolean | undefined;
  isClosing?: boolean;
  isDragging?: boolean;
  isFixed?: boolean;
  isReordering?: boolean;
  /** In a row that scrolls: as wide as its name wants, whatever the row's room. */
  isScrolled?: boolean;
  isSelected: boolean;
  nextIsSelected: boolean;
  onClose?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onDrag?: (event: Event) => void;
  onDragEnd?: (event: Event) => void;
  onDragStart?: (event: Event, moved: number) => void;
  onSelect: () => void;
  onSelectRelative: (direction: -1 | 1) => void;
  showSeparator: boolean;
  tab: StripTab;
  /** Present for a tab inside the group that can be dragged. */
  value?: string;
}) {
  const isClosable = !isFixed && onClose !== undefined;
  const prefersReducedMotion = useReducedMotion();
  // What the tab is drawn moved by, and, where its strip's owner places it, what the
  // reorder writes instead: its gesture has to go on, since turning its drag off ends
  // it, and it writes its own idea of where the tab is on every frame and springs that
  // back on the release, however the drag ended.
  const dragX = useMotionValue(0);
  const reorderX = useMotionValue(0);
  // In the hand it stands at the pointer, wherever its place in the row has got to,
  // and settles into that place when it is let go. Stood again every frame, after the
  // strip's own reorder has written and before anything is drawn, since its place also
  // moves with the pointer still: the row closes up and opens with a transition.
  const tabRef = useRef<HTMLDivElement>(null);
  const stoodOn = useRef(0);
  useLayoutEffect(() => {
    const element = tabRef.current;
    if (heldLeft === undefined || !element) {
      return;
    }
    const stand = () => {
      stoodOn.current = element.offsetLeft;
      dragX.set(offsetToStandAt(element, heldLeft));
    };
    stand();
    frame.preRender(stand, true);
    return () => {
      cancelFrame(stand);
    };
  }, [dragX, heldLeft]);
  const wasHeld = useRef(false);
  useLayoutEffect(() => {
    const element = tabRef.current;
    if (wasHeld.current && heldLeft === undefined) {
      if (prefersReducedMotion) {
        dragX.jump(0);
      } else {
        // Taken back with the button down, its place has gone home with it, and a
        // gesture still going holds off the layout animation that would carry it.
        if (isDragging && element) {
          dragX.jump(dragX.get() + stoodOn.current - element.offsetLeft);
        }
        void animate(dragX, 0, SETTLE);
      }
    }
    wasHeld.current = heldLeft !== undefined;
  }, [dragX, heldLeft, isDragging, prefersReducedMotion]);
  useLayoutEffect(() => {
    if (isStill && heldLeft === undefined) {
      dragX.jump(0);
    }
  }, [dragX, heldLeft, isStill]);

  const sizing = cn(
    isFixed
      ? cn("shrink-0", density !== "full" && "w-8")
      : isScrolled
        ? // A cap and floor to match the width, which the arriving motion
          // opens from nothing.
          density === "icon"
          ? "w-8 max-w-8 min-w-0 shrink-0"
          : "w-40 max-w-40 min-w-0 shrink-0"
        : cn(
            "max-w-60 flex-1",
            { compact: "min-w-15", full: "min-w-20", icon: "min-w-8" }[density],
          ),
    density === "full" ? "gap-2 px-2.5" : "justify-center px-1",
  );

  const className = cn(
    "group/pane-tab relative flex h-8 cursor-default items-center rounded-xl text-sm font-medium",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
    sizing,
    isSelected
      ? "text-foreground shadow-xs-soft"
      : // An opacity of the ink rather than a grey: the strip sits on the
        // project's tint in the window bar, and a fixed grey reads as dirt on
        // a colored ground.
        cn(
          "text-foreground/55",
          !isDragging && "hover:bg-foreground/8 hover:text-foreground",
        ),
    // Over the `z-index` a `Reorder.Item` sets itself, which lapses wherever the
    // tab stands exactly in its place.
    (isDragging || heldLeft !== undefined) && "z-10! shadow-xs-soft",
    // Takes its place back as it left it, the tabs beside it making room.
    isDragging && GIVES_PLACE_UP,
    // Gone from the row with its picture on the pointer, the tabs beside it taking
    // its place. Classes rather than `style`: a `Reorder.Item` keeps a style value
    // it was once given, which a tab that closes never finds out and a tab that
    // comes back would be drawn with.
    isCarried &&
      cn(
        "pointer-events-none -mr-1! min-w-0! grow-0! px-0! opacity-0!",
        GIVES_PLACE_UP,
      ),
    isArriving && "pane-tab-arriving",
    isFixed && showSeparator && "mr-3",
    showSeparator &&
      !isSelected &&
      !nextIsSelected &&
      cn(
        // Gone under the pointer on either side of it: the tab's own hover,
        // or the new-tab control's, which is the one button a tab is ever
        // next to.
        "after:pointer-events-none after:absolute after:top-1/4 after:h-1/2 after:w-px after:bg-gray-300 after:content-[''] hover:after:hidden has-[+button:hover]:after:hidden dark:after:bg-border/50",
        isFixed ? "after:-right-2" : "after:-right-0.5",
      ),
    isClosing &&
      cn(
        "pointer-events-none transition-all duration-(--tab-motion) ease-out",
        // A tab of its own width has no share to give up, so it gives the
        // width. A class, since a `Reorder.Item` keeps a style value.
        isScrolled && "w-0!",
      ),
  );

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === 1 && onClose) {
      onClose();
    } else if (event.button === 0) {
      onSelect();
    }
  };

  const contents = (
    <>
      <span
        className={cn(
          "relative flex size-4 shrink-0 items-center justify-center",
          tab.isWorking && tab.glintIcon && "brand-shiny-icon",
        )}
      >
        {tab.icon}
        {tab.isWorking && tab.glintIcon && (
          <IconGlint>{tab.glintIcon}</IconGlint>
        )}
      </span>
      <span
        className={cn(
          "min-w-0",
          // A name that does not fit fades out at its end, selected or not:
          // an ellipsis reads as a different name.
          density === "full"
            ? cn(
                isFixed
                  ? "whitespace-nowrap"
                  : "flex-1 overflow-hidden tab-title-fade whitespace-nowrap",
              )
            : "sr-only",
          tab.isWorking && "brand-shiny-text",
        )}
      >
        {tab.title}
        {tab.isWorking && <ShimmerSweep text={tab.title} />}
      </span>
      {tab.badge}
      {isClosable && density !== "icon" && (
        <button
          aria-label={`Close ${tab.title}`}
          className={cn(
            "absolute top-1/2 right-1.5 size-5 -translate-y-1/2 items-center justify-center rounded-md hover:bg-foreground/10",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
            isSelected ? "flex" : "hidden group-hover/pane-tab:flex",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          // A press here is not one on the tab, so it neither selects nor
          // drags it; a middle press still closes it, as anywhere on the tab.
          onPointerDown={(event) => {
            if (event.button !== 1) {
              event.stopPropagation();
            }
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </>
  );

  let surface: React.CSSProperties | undefined = isSelected
    ? SELECTED
    : undefined;
  if (isClosing) {
    surface = { ...surface, ...COLLAPSED };
  } else if (isDragging) {
    surface = isSelected ? SELECTED : CARRIED;
  }

  const handlers = {
    "aria-hidden": isClosing || undefined,
    "aria-selected": isSelected,
    className,
    "data-density": density,
    "data-tab-key": tab.key,
    onContextMenu,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        onSelectRelative(direction);
        focusSiblingTab(event.currentTarget, direction);
      }
    },
    // A click selects the tab without taking the keyboard from the screen,
    // which the tab coming up hands back to where it was in that tab.
    onMouseDown: (event: React.MouseEvent) => {
      if (event.button === 0) {
        event.preventDefault();
      }
    },
    onPointerDown,
    role: "tab",
    style: surface,
    tabIndex: isClosing || !isSelected ? -1 : 0,
    ...(tab.tooltip ? {} : { title: tab.title }),
  };

  const element =
    value === undefined ? (
      <div {...handlers}>{contents}</div>
    ) : (
      <Reorder.Item
        {...handlers}
        as="div"
        layout="position"
        ref={tabRef}
        style={{ ...surface, x: dragX }}
        {...(isPlacedByOwner ? { _dragX: reorderX } : {})}
        dragMomentum={false}
        dragTransition={SETTLE_DRAG}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onDragStart={(event, { offset }) => {
          onDragStart?.(event, offset.x);
        }}
        transition={isReordering ? MAKE_WAY : LAND_IN_PLACE}
        {...(heldLeft === undefined
          ? {}
          : // Where the pointer says, and nowhere its place in the row is on its way to.
            { transformTemplate: () => `translateX(${dragX.get()}px)` })}
        value={value}
      >
        {contents}
      </Reorder.Item>
    );

  if (!tab.tooltip) {
    return element;
  }
  // The wrapper stays while the tab closes or is carried, so the tab stays
  // the same element: a remount drops its collapse transition and the drag
  // gesture in hand. A tab on its way out or being carried has nothing to say.
  // It closes the moment the pointer leaves the tab: a hoverable tooltip
  // waits for a pointermove outside it, and a pointer gone into a page's
  // guest below sends none, so it would stay up over the page.
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger
        asChild
        // A held pointer is carrying a tab, which over any tab would otherwise
        // read as hovering it.
        onPointerMove={(event) => {
          if (event.buttons !== 0) {
            event.preventDefault();
          }
        }}
      >
        {element}
      </TooltipTrigger>
      {isClosing || isDragging ? null : (
        <TooltipContent maxWidth="28rem" side="bottom">
          <div className="font-medium break-words">{tab.tooltip.title}</div>
          {tab.tooltip.detail ? (
            <div className="mt-0.5 text-muted-foreground">
              {tab.tooltip.detail}
            </div>
          ) : null}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

/**
 * How far a tab moves, in the layout px a transform is in, for its left edge to
 * stand at an on-screen point, or as near as the row, which cuts off anything past
 * its ends, lets it.
 */
function offsetToStandAt(element: HTMLElement, left: number) {
  const list = element.closest<HTMLElement>("[role=tablist]");
  if (!list) {
    return 0;
  }
  const { left: listLeft, width } = list.getBoundingClientRect();
  // On screen px from layout px, which differ by the window's zoom.
  const zoom = width / list.offsetWidth;
  const standsAt = listLeft + (element.offsetLeft - list.offsetLeft) * zoom;
  const farthest = listLeft + width - element.offsetWidth * zoom;
  return (clamp(left, listLeft, farthest) - standsAt) / zoom;
}

function tabDensity(width: number): TabDensity {
  if (width >= NAME_FITS) {
    return "full";
  }
  return width >= CLOSE_FITS ? "compact" : "icon";
}
