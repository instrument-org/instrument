import { cn } from "@/client/lib/utils";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { Reorder, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** A tab on the strip: what it is called and what stands for it. */
export interface StripTab {
  icon: ReactNode;
  /** Drawn first and held there: not dragged, not closed. */
  isFixed?: boolean;
  key: string;
  title: string;
}

// The strip's measurements, in layout px. `GAP` is the `gap-1` between tabs.
const GAP = 4;
// A tab with nothing in it but its icon: a square at the strip's tab height.
const MIN_TAB = 28;
// A centered icon and a close, clear of each other.
const CLOSE_FITS = 60;
// An icon at the head of the tab and a few characters of name after it.
const NAME_FITS = 80;
// The control that adds a tab, and the gap it holds: room the tabs cannot use.
const NEW_TAB_ROOM = 28 + GAP;
// The `mr-3` holding a fixed tab off the rest, on top of the gap.
const FIXED_MARGIN = 12;

// Lands a tab at its new place rather than moving it there; the projection
// stays on so a drag can still reorder around it.
const LAND_IN_PLACE = { layout: { duration: 0 } };

// A closing tab gives its share of the row up rather than being taken out of
// it, so the tabs beside it widen as it narrows. See the task pane's strip for
// why this is a transition on real layout rather than an exit animation.
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

// What a tab stands on while it is being carried over the others.
const CARRIED = {
  backgroundColor: "var(--card)",
} satisfies React.CSSProperties;
const CARRIED_SELECTED = {
  ...CARRIED,
  backgroundImage: "linear-gradient(var(--accent), var(--accent))",
} satisfies React.CSSProperties;

interface StripLayout {
  density: TabDensity;
  fixedIsNamed: boolean;
  selectedDensity: TabDensity;
  visibleCount: number;
}

type TabDensity = "compact" | "full" | "icon";

/**
 * A row of tabs the way the task page draws its pane tabs: an even share of
 * the row each, compressing together to icons rather than scrolling, the one
 * being read held wide enough for its name and close, dragged to reorder,
 * closed by the middle button or the cross, and arriving and leaving with a
 * motion rather than a jump. The browser and This Mac both draw theirs with
 * it, so a tab is one thing across the window.
 */
export function TabStrip({
  className,
  onClose,
  onNew,
  onReorder,
  onSelect,
  selectedKey,
  tabs,
  trailing,
}: {
  className?: string;
  onClose: (key: string) => void;
  /** Drawn as a plus at the end of the row when given. */
  onNew?: () => void;
  onReorder: (keys: string[]) => void;
  onSelect: (key: string) => void;
  selectedKey: string | undefined;
  tabs: StripTab[];
  /** Drawn at the right end, past the tabs. */
  trailing?: ReactNode;
}) {
  const hasNew = onNew !== undefined;
  const fixedTabs = tabs.filter((tab) => tab.isFixed);
  const movableTabs = tabs.filter((tab) => !tab.isFixed);
  const movableKeys = movableTabs.map((tab) => tab.key);
  const orderedKeys = tabs.map((tab) => tab.key);
  const prefersReducedMotion = useReducedMotion();

  const stripRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [draggingKey, setDraggingKey] = useState<string>();
  const [closing, setClosing] = useState<{ index: number; tab: StripTab }[]>(
    [],
  );
  const [arriving, setArriving] = useState<string[]>([]);
  const [seen, setSeen] = useState(movableKeys);
  const [{ density, fixedIsNamed, selectedDensity, visibleCount }, setLayout] =
    useState(() => stripLayout(0, movableTabs.length, fixedTabs.length));

  if (
    movableKeys.length !== seen.length ||
    movableKeys.some((key, index) => key !== seen[index])
  ) {
    const opened = movableKeys.filter((key) => !seen.includes(key));
    setSeen(movableKeys);
    if (opened.length > 0) {
      setArriving((current) => [...current, ...opened]);
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

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const area = areaRef.current;
    if (!strip || !area) {
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
  }, [drawnCount, fixedCount, hasNew]);

  // The run of tabs there is room for, kept over the selection.
  const selectedIndex = movableKeys.indexOf(selectedKey ?? "");
  const liveCount = Math.max(0, visibleCount - collapsing.length);
  const start = Math.max(
    0,
    Math.min(selectedIndex - liveCount + 1, movableTabs.length - liveCount),
  );
  const visibleTabs = movableTabs.slice(start, start + liveCount);
  const visibleKeys = movableKeys.slice(start, start + liveCount);

  const drawnTabs = visibleTabs.map((tab) => ({ isClosing: false, tab }));
  for (const { index, tab } of collapsing) {
    drawnTabs.splice(Math.min(index, drawnTabs.length), 0, {
      isClosing: true,
      tab,
    });
  }
  const drawnKeys = drawnTabs.map(({ tab }) => tab.key);

  if (draggingKey !== undefined && !visibleKeys.includes(draggingKey)) {
    setDraggingKey(undefined);
  }
  const isReordering = draggingKey !== undefined;

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

  return (
    <div
      className={cn("flex h-10 shrink-0 items-center gap-1 px-2", className)}
      style={TAB_MOTION}
    >
      <div
        aria-label="Open tabs"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
        data-density={density}
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
        <Reorder.Group
          as="div"
          axis="x"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
          onReorder={(keys: string[]) => {
            onReorder([
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
              isClosing={isClosing}
              isDragging={draggingKey === tab.key}
              isReordering={isReordering}
              isSelected={tab.key === selectedKey}
              key={tab.key}
              nextIsSelected={drawnKeys[index + 1] === selectedKey}
              onClose={() => {
                if (!prefersReducedMotion) {
                  setClosing((current) => [...current, { index, tab }]);
                }
                onClose(tab.key);
              }}
              onDragEnd={() => {
                setDraggingKey(undefined);
              }}
              onDragStart={() => {
                setDraggingKey(tab.key);
              }}
              onSelect={() => {
                onSelect(tab.key);
              }}
              onSelectRelative={(direction) => {
                selectRelative(tab.key, direction);
              }}
              showSeparator={index < drawnTabs.length - 1}
              tab={tab}
              value={tab.key}
            />
          ))}
          {/* Inside the row rather than after it, so it sits against the last
              tab while the tabs are short of the row and is pushed to the end
              once they fill it. It is not one of the values, so the drag
              never counts it. */}
          {onNew ? (
            <button
              aria-label="New tab"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              onClick={onNew}
              type="button"
            >
              <PlusIcon className="size-4" />
            </button>
          ) : null}
        </Reorder.Group>
      </div>
      {trailing}
    </div>
  );
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
  isArriving,
  isClosing,
  isDragging,
  isFixed,
  isReordering,
  isSelected,
  nextIsSelected,
  onClose,
  onDragEnd,
  onDragStart,
  onSelect,
  onSelectRelative,
  showSeparator,
  tab,
  value,
}: {
  density: TabDensity;
  isArriving?: boolean;
  isClosing?: boolean;
  isDragging?: boolean;
  isFixed?: boolean;
  isReordering?: boolean;
  isSelected: boolean;
  nextIsSelected: boolean;
  onClose?: () => void;
  onDragEnd?: () => void;
  onDragStart?: () => void;
  onSelect: () => void;
  onSelectRelative: (direction: -1 | 1) => void;
  showSeparator: boolean;
  tab: StripTab;
  /** Present for a tab inside the group that can be dragged. */
  value?: string;
}) {
  const isClosable = !isFixed && onClose !== undefined;

  const sizing = cn(
    isFixed
      ? cn("shrink-0", density !== "full" && "w-7")
      : cn(
          "max-w-48 flex-1",
          { compact: "min-w-15", full: "min-w-20", icon: "min-w-7" }[density],
        ),
    density === "full" ? "gap-1.5 px-2" : "justify-center px-1",
  );

  const className = cn(
    "group/pane-tab relative flex h-7 cursor-default items-center rounded-md text-xs font-medium select-none",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
    sizing,
    isSelected
      ? "bg-accent text-accent-foreground"
      : cn("text-muted-foreground", !isDragging && "hover:bg-accent/50"),
    isDragging && "z-10 shadow-xs-soft",
    isArriving && "pane-tab-arriving",
    isFixed && showSeparator && "mr-3",
    showSeparator &&
      !isSelected &&
      !nextIsSelected &&
      cn(
        "after:pointer-events-none after:absolute after:top-1/4 after:h-1/2 after:w-px after:bg-border after:content-[''] hover:after:hidden",
        isFixed ? "after:-right-2" : "after:-right-0.5",
      ),
    isClosing &&
      "pointer-events-none transition-all duration-(--tab-motion) ease-out",
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
      <span className="flex size-4 shrink-0 items-center justify-center">
        {tab.icon}
      </span>
      <span
        className={cn(
          "min-w-0",
          density === "full"
            ? cn(
                isFixed ? "whitespace-nowrap" : "flex-1 truncate",
                isClosable &&
                  (isSelected
                    ? "tab-title-fade"
                    : "group-hover/pane-tab:tab-title-fade"),
              )
            : "sr-only",
        )}
      >
        {tab.title}
      </span>
      {isClosable && density !== "icon" && (
        <button
          aria-label={`Close ${tab.title}`}
          className={cn(
            "absolute top-1/2 right-1 size-4 -translate-y-1/2 items-center justify-center rounded-sm hover:bg-foreground/10",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
            isSelected ? "flex" : "hidden group-hover/pane-tab:flex",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </>
  );

  let surface: React.CSSProperties | undefined;
  if (isClosing) {
    surface = COLLAPSED;
  } else if (isDragging) {
    surface = isSelected ? CARRIED_SELECTED : CARRIED;
  }

  const handlers = {
    "aria-hidden": isClosing || undefined,
    "aria-selected": isSelected,
    className,
    "data-density": density,
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
    onPointerDown,
    role: "tab",
    style: surface,
    tabIndex: isClosing || !isSelected ? -1 : 0,
    title: tab.title,
  };

  return value === undefined ? (
    <div {...handlers}>{contents}</div>
  ) : (
    <Reorder.Item
      {...handlers}
      as="div"
      layout="position"
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      transition={isReordering ? undefined : LAND_IN_PLACE}
      value={value}
    >
      {contents}
    </Reorder.Item>
  );
}

function tabDensity(width: number): TabDensity {
  if (width >= NAME_FITS) {
    return "full";
  }
  return width >= CLOSE_FITS ? "compact" : "icon";
}
