import { FileIcon } from "@/client/components/file-icon";
import { useBrowserAgentActivity } from "@/client/hooks/use-browser-agent-activity";
import { cn } from "@/client/lib/utils";
import { TaskPane } from "@instrument-org/workspace/client";
import { GlobeSimpleIcon } from "@phosphor-icons/react/GlobeSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { Reorder, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { PaneToggle } from "./pane-toggle";

// The strip's measurements, in layout px. `GAP` is the `gap-1` between tabs.
const GAP = 4;
// A tab with nothing in it but its icon, which at the strip's own tab height is
// a square. Tabs stop here rather than compressing into a column of slivers.
const MIN_TAB = 28;
// A centered icon and a close, clear of each other. The close is drawn over the
// name's tail rather than beside it, so it tracks the tab's right edge and
// closes on an icon that is sitting still in the middle of the tab.
const CLOSE_FITS = 60;
// An icon at the head of the tab and a 42px name box after it: a few characters
// and the ellipsis that says there were more. Under it a name is a chopped
// letter or two.
const NAME_FITS = 80;
// The `mr-3` holding the fixed tab off the task's own, on top of the gap.
const FIXED_MARGIN = 12;

// Lands a tab at its new place rather than moving it there.
//
// The projection itself has to stay on whatever the strip is doing: it is what
// registers each tab's box with the group, so a tab that is not projecting is a
// tab the drag cannot reorder around. Only the animation over it is turned off.
const LAND_IN_PLACE = { layout: { duration: 0 } };

// A closing tab gives its share of the row up rather than being taken out of
// the row. Every tab here is an even share of one width, so the tabs beside it
// widen as it narrows, through real flex layout and frame by frame -- which is
// also the only way to resize a tab without scaling the icon inside it.
//
// Pulling it out of flow instead would hand the survivors their full width in a
// single frame and leave the projection sliding boxes that are already the
// wrong size for where they are drawn, out past the end of a strip that clips.
//
// A transition rather than an exit animation, because the widths here are a
// class per density and an exit animation does not leave them alone: naming a
// property there makes Motion own it, and it owns it by reading whatever the
// tab happened to measure when it mounted and writing that back inline. A tab
// that then compressed would be held at the width it was born at.
//
// Inline for the same reason from the other side: these have to beat the
// density classes, and which of two utilities wins is a question about the
// order of a stylesheet rather than the order of a `cn` call.
//
// `minWidth` because the floor under each share outranks a width; the negative
// margin is the `gap-1` a tab at zero width is still holding open, so the row
// does not jump when it finally goes.
const COLLAPSED = {
  flexGrow: 0,
  marginRight: -GAP,
  minWidth: 0,
  opacity: 0,
  paddingLeft: 0,
  paddingRight: 0,
} satisfies React.CSSProperties;

// Long enough to be seen taking the space back, short enough that a second
// close does not queue behind the first. Kept with `duration-150` below, which
// is what actually runs it.
const COLLAPSE_MS = 150;

// What a tab stands on while it is being carried, which is a question it does
// not have to answer while it is sitting in the row.
//
// Every surface here but the card's is a translucent overlay -- `--accent` is
// 5% white in the dark theme, `--muted` 8% -- so they read as a tab only
// because of what is behind them, which is the row. Lift one out of the row and
// what is behind it is the tabs it is crossing, and their names come through
// its own. The card is the row's own surface and the one opaque thing here to
// stand a tab on.
//
// In the light theme those same tokens are opaque and none of this shows, which
// is why it looks like a dark-mode bug and is not one.
const CARRIED = { backgroundColor: "var(--card)" } satisfies React.CSSProperties;

// The selected tint painted over that floor rather than in place of it, so a
// tab that was the one being read still looks it while it is being moved. As a
// background image because the floor is already using the background color.
const CARRIED_SELECTED = {
  ...CARRIED,
  backgroundImage: "linear-gradient(var(--accent), var(--accent))",
} satisfies React.CSSProperties;

interface StripLayout {
  /** What a tab that is not the one being read can draw. */
  density: TabDensity;
  /** Whether the fixed tab has the room to say what it is in words. */
  fixedIsNamed: boolean;
  /** What the selected tab can draw, which is never less than the rest. */
  selectedDensity: TabDensity;
  /** How many of the task's tabs are drawn at all. */
  visibleCount: number;
}

type TabDensity = "compact" | "full" | "icon";

/**
 * The pane's tab strip, and the close control at its right end.
 *
 * Tabs are positional and uncapped. A cap would have to evict something the
 * user was reading, and the answer to an over-eager agent is telling it what is
 * already open rather than throwing tabs away behind it.
 *
 * The browser sits outside the group that can be dragged rather than
 * being pinned inside it: it is the pane's zero state, always drawn and never stored, so
 * there is nothing about it for a drag to move.
 */
export function PaneTabs({
  fileTabs,
  onClose,
  onReorder,
  onSelect,
  selectedKey,
  taskId,
}: {
  fileTabs: TaskPane.Tab[];
  onClose: (key: string) => void;
  onReorder: (keys: string[]) => void;
  onSelect: (key: string) => void;
  selectedKey: string | undefined;
  taskId: Parameters<typeof PaneToggle>[0]["taskId"];
}) {
  const fileKeys = fileTabs.map((tab) => TaskPane.tabKey(tab));
  // The browser is always drawn and always first, so the strip's order is the
  // fixed tab followed by the stored ones. Arrow keys walk this, including the
  // tabs the strip has no room to draw.
  const orderedKeys = ["browser", ...fileKeys];
  const fileCount = fileTabs.length;

  const isBrowserBusy = useBrowserAgentActivity(taskId);
  const prefersReducedMotion = useReducedMotion();

  const stripRef = useRef<HTMLDivElement>(null);
  const tabAreaRef = useRef<HTMLDivElement>(null);
  // Motion's layout animation is here for the drag and nothing else: it is what
  // slides the other tabs out of the way of the one being moved. Left on, it
  // animates every width the strip changes on its own -- a tab widening as it
  // is selected, a task switch swapping the row out -- and those are arrivals
  // at a state rather than something to watch happen, so a tab slides in from
  // wherever the tab before it happened to end.
  //
  // Which tab is being dragged rather than whether one is, so the strip can
  // answer that question itself. The tab it names ends the drag, and it can be
  // gone before it does: the agent closes a pane tab, the run of drawn tabs
  // shifts, the task changes. Motion keeps a pan session alive across an unmount
  // mid-drag on purpose, so nothing about the tab going away brings the flag
  // down with it, and left up it animates every later width change again.
  const [draggingKey, setDraggingKey] = useState<string>();
  // The tabs that are collapsing, and where in the run each one was. They are
  // gone from the task's list the moment the close is asked for, but they are
  // still drawn and still taking room, and the strip has to lay out around what
  // is drawn: re-divided for the smaller count while one of them is still
  // there, the row is briefly fuller than it was -- names coming back, another
  // tab appearing -- against a strip that clips rather than scrolls.
  //
  // Their place in the run is kept with them. A tab that jumped to the end of
  // the row to leave it would be worse than one that never moved.
  const [closing, setClosing] = useState<
    { index: number; tab: TaskPane.Tab }[]
  >([]);
  const [{ density, fixedIsNamed, selectedDensity, visibleCount }, setLayout] =
    useState(() => stripLayout(0, fileCount));

  // Motion is not driving this one, so nothing is going to say when it ended.
  useEffect(() => {
    if (closing.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setClosing([]);
    }, COLLAPSE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [closing]);

  // Which of them are actually collapsing, which is not the same question as
  // which were closed. The task's tabs arrive through a query, and the write
  // that drops one reaches this component a render after the click does -- so
  // on that first render the tab is closed and still in the list, and drawing a
  // second copy of it would be drawing it twice. It stays whole for that
  // render, and starts collapsing on the one where it has actually gone.
  //
  // A tab reopened while it was on its way out reads the same way and is the
  // same answer: it is in the list, so it is not collapsing. The timer below
  // clears it either way.
  const collapsing = closing.filter(
    ({ tab }) => !fileKeys.includes(TaskPane.tabKey(tab)),
  );
  const collapsingKeys = new Set(collapsing.map(({ tab }) => TaskPane.tabKey(tab)));
  const drawnCount = fileCount + collapsing.length;

  // Measured rather than asked of CSS. A container query could answer what one
  // tab has room to draw, now that a tab is a share of the row rather than its
  // own width, but it cannot answer how many tabs the row has room for at all,
  // and that is the same reading. One mechanism, one number.
  //
  // In a layout effect so the first paint is already at the right state.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const area = tabAreaRef.current;
    if (!strip || !area) {
      return;
    }

    // Both are `flex-1` off a row whose width comes from the pane, so what they
    // read is the room the tabs have rather than the room they are taking.
    //
    // Two readings, because the fixed tab's name is inside the difference
    // between them. The task's tabs are laid out from the area they actually
    // have, which is what is left after the fixed tab; the fixed tab's own name
    // is decided by the row, which is the one width its name cannot change.
    // Measured off the area instead, it would be a name deciding whether there
    // was room for a name, and the answer would flip on every pass.
    const apply = () => {
      const row = stripLayout(strip.clientWidth - FIXED_MARGIN, drawnCount + 1);
      const files = stripLayout(area.clientWidth, drawnCount);
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
  }, [drawnCount]);

  // The run of tabs there is room for. It stays at the front of the strip until
  // the selection is past the end of it: whatever the pane is showing has to be
  // on the strip, and a file opened past the end arrives selected.
  //
  // Less the tabs that are collapsing, which are drawn on top of this run and
  // counted in the room it was laid out from. A tab hidden behind the end of a
  // full strip comes into it when the one leaving has finished leaving, rather
  // than arriving beside it at full width in a row with no space for both.
  const selectedIndex = fileKeys.indexOf(selectedKey ?? "");
  const liveCount = Math.max(0, visibleCount - collapsing.length);
  const start = Math.max(
    0,
    Math.min(selectedIndex - liveCount + 1, fileCount - liveCount),
  );
  const visibleTabs = fileTabs.slice(start, start + liveCount);
  const visibleKeys = fileKeys.slice(start, start + liveCount);

  // What the strip actually draws: the run above with the tabs that are
  // collapsing put back where they were.
  const drawnTabs = visibleTabs.map((tab) => ({ isClosing: false, tab }));
  for (const { index, tab } of collapsing) {
    drawnTabs.splice(Math.min(index, drawnTabs.length), 0, {
      isClosing: true,
      tab,
    });
  }
  const drawnKeys = drawnTabs.map(({ tab }) => TaskPane.tabKey(tab));

  // A tab the strip is no longer drawing is not a tab being dragged, whatever
  // its own callback got to say.
  if (draggingKey !== undefined && !visibleKeys.includes(draggingKey)) {
    setDraggingKey(undefined);
  }
  const isReordering = draggingKey !== undefined;

  // Focus follows the selection while the strip holds it. The arrow keys move
  // both themselves, but a selection that lands past the run above moves the
  // run too, and the tab that was next in the DOM a moment ago is then not the
  // one that ended up selected.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip?.contains(document.activeElement)) {
      return;
    }
    const selected = strip.querySelector(
      '[role="tab"][aria-selected="true"]:not([aria-hidden])',
    );
    if (
      selected instanceof HTMLElement &&
      selected !== document.activeElement
    ) {
      selected.focus();
    }
  }, [selectedKey]);

  const selectRelative = (from: string, direction: -1 | 1) => {
    const index = orderedKeys.indexOf(from);
    if (index === -1) {
      return;
    }
    // Wraps, which is what a tab strip does: the set is small and bounded, and
    // stopping at the end makes the last tab feel broken.
    const next =
      orderedKeys[
        (index + direction + orderedKeys.length) % orderedKeys.length
      ];
    if (next !== undefined) {
      onSelect(next);
    }
  };

  return (
    // `h-10 px-2` matches `FileViewerHeader` and `ViewerToolbar`, the rows that
    // stack under this one, so the three read as one band. No rule under it:
    // the row below draws its own, and two hairlines a row apart break the band
    // into pieces rather than separating anything.
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      {/* No horizontal scroll. Tabs share the row and compress as they fill it,
          the way the window's do; a strip that scrolls hides tabs behind an
          interaction nobody looks for in a space this small.

          They compress together: the strip trades every name for its icons at
          once, and then every close, so the row is always one thing rather than
          a mix of two. See `stripLayout`. */}
      <div
        aria-label="Open tabs"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
        data-density={density}
        ref={stripRef}
        role="tablist"
      >
        <PaneTab
          // Its name goes when an even share of the row would not carry one,
          // and comes back when it is the tab being read. It is a tab like the
          // rest of them, and a row of icons with one word at the head of it
          // reads as a row that failed to finish compressing.
          density={selectedKey === "browser" || fixedIsNamed ? "full" : "icon"}
          isBusy={isBrowserBusy}
          isSelected={selectedKey === "browser"}
          // A rule between the fixed tab and the task's own. The gap it sits in
          // is held open whether or not the rule is drawn, so a selection
          // moving in and out of the first tab never shifts the strip.
          nextIsSelected={visibleKeys[0] === selectedKey}
          onSelect={() => {
            onSelect("browser");
          }}
          onSelectRelative={(direction) => {
            selectRelative("browser", direction);
          }}
          // Against what is drawn, not what is left. The rule and the margin
          // holding it belong to a row that still has a tab in it, and the last
          // one is still there until it has finished collapsing.
          showSeparator={drawnCount > 0}
          tab={{ type: "browser" }}
        />

        {/* Presentational, so the tabs inside it are exposed as children of the
            tablist above rather than nested in an anonymous group. */}
        <Reorder.Group
          as="div"
          axis="x"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
          onReorder={(keys: string[]) => {
            // The drag only ever sees the run that is drawn, so the tabs either
            // side of it keep their places around the new order. A tab that is
            // on its way out is drawn but not the task's any more, so it goes
            // no further than the group that had to be told about it.
            onReorder([
              ...fileKeys.slice(0, start),
              ...keys.filter((key) => !collapsingKeys.has(key)),
              ...fileKeys.slice(start + liveCount),
            ]);
          }}
          ref={tabAreaRef}
          role="none"
          values={drawnKeys}
        >
          {drawnTabs.map(({ isClosing, tab }, index) => {
            const key = TaskPane.tabKey(tab);
            return (
              <PaneTab
                // The tab being read is held at a width the rest of the row has
                // given up on, so it still says which file the pane is showing
                // and still carries the close for it.
                density={key === selectedKey ? selectedDensity : density}
                isClosing={isClosing}
                isDragging={draggingKey === key}
                isReordering={isReordering}
                isSelected={key === selectedKey}
                key={key}
                nextIsSelected={drawnKeys[index + 1] === selectedKey}
                onClose={() => {
                  if (!prefersReducedMotion) {
                    setClosing((current) => [...current, { index, tab }]);
                  }
                  onClose(key);
                }}
                onDragEnd={() => {
                  setDraggingKey(undefined);
                }}
                onDragStart={() => {
                  setDraggingKey(key);
                }}
                onSelect={() => {
                  onSelect(key);
                }}
                onSelectRelative={(direction) => {
                  selectRelative(key, direction);
                }}
                showSeparator={index < drawnTabs.length - 1}
                tab={tab}
                value={key}
              />
            );
          })}
        </Reorder.Group>
      </div>

      <PaneToggle taskId={taskId} />
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

function PaneTab({
  density,
  isBusy,
  isClosing,
  isDragging,
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
  // The agent is working in the browser. Only the fixed tab is ever told this;
  // nothing drives a file tab from underneath the way the agent drives a page.
  isBusy?: boolean;
  // The tab has been closed and is collapsing out of the row. It is drawn from
  // the strip's own copy of it, so nothing outside still has it.
  isClosing?: boolean;
  // This tab is the one being carried.
  isDragging?: boolean;
  // Some tab on the strip is being carried, which is the one time a tab moving
  // to a new place is worth watching -- including for the tabs giving way to
  // it, which is why this is not the same question as the one above.
  isReordering?: boolean;
  isSelected: boolean;
  nextIsSelected: boolean;
  onClose?: () => void;
  onDragEnd?: () => void;
  onDragStart?: () => void;
  onSelect: () => void;
  onSelectRelative: (direction: -1 | 1) => void;
  showSeparator: boolean;
  tab: TaskPane.Tab;
  // Present for a tab inside the group that can be dragged, which is every
  // tab the task owns. Absent for the browser, which is drawn outside it.
  value?: string;
}) {
  const filename =
    tab.type === "file"
      ? tab.filePath.slice(tab.filePath.lastIndexOf("/") + 1)
      : "Browser";
  const isFixed = tab.type === "browser";
  const isClosable = tab.type === "file" && onClose !== undefined;

  // An even share of the row, whatever the tab has to put in it. A tab sized by
  // its own name is a row of tabs that are all different widths and all
  // truncated anyway, and nothing about which one is wider says anything.
  //
  // The floor under each state is what hands the selected tab its extra width:
  // every tab asks for the same share and the selected one cannot go under a
  // name's worth of it, so the row pays the difference without anything here
  // having to know a number.
  const sizing = cn(
    isFixed
      ? // The fixed tab takes no share. It is its name's width, or a square
        // with its icon in the middle of it.
        cn("shrink-0", density !== "full" && "w-7")
      : cn(
          "max-w-48 flex-1",
          { compact: "min-w-15", full: "min-w-20", icon: "min-w-7" }[density],
        ),
    // The icon is at the head of the tab only while there is a name for it to
    // be at the head of. On its own it sits in the middle, wherever the close
    // happens to be.
    density === "full" ? "gap-1.5 px-2" : "justify-center px-1",
  );

  const className = cn(
    // One weight in every state, so selecting a tab moves its color and nothing
    // else. A weight that changed with the selection would reflow the name
    // under the cursor and shift the row it sits in.
    "group/pane-tab relative flex h-7 cursor-default items-center rounded-md text-xs font-medium select-none",
    // Drawn inside the tab rather than around it. The strip is a 40px row with
    // 28px tabs and clips its overflow so the tabs can compress, which leaves
    // an outset ring shaved off top and bottom.
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
    sizing,
    isSelected
      ? "bg-accent text-accent-foreground"
      : cn(
          "text-muted-foreground",
          // Not while it is being carried, where the pointer holding it would
          // otherwise be drawing a hover over `CARRIED`.
          !isDragging && "hover:bg-accent/50",
        ),
    // Off the row rather than in it, so what it crosses reads as underneath.
    isDragging && "z-10 shadow-xs-soft",
    // The fixed tab is held further off the task's own than they are off each
    // other, and the margin is what holds it: the rule below is drawn in that
    // space rather than taking any.
    isFixed && showSeparator && "mr-3",
    // Between the tabs at all times, since a compressed strip is otherwise a
    // row of icons with nothing to say where one tab ends. Not against a tab
    // that is drawing a background of its own, which is edge enough.
    showSeparator &&
      !isSelected &&
      !nextIsSelected &&
      cn(
        "after:pointer-events-none after:absolute after:top-1/4 after:h-1/2 after:w-px after:bg-border after:content-[''] hover:after:hidden",
        isFixed ? "after:-right-2" : "after:-right-0.5",
      ),
    // On its way out, and out of reach on the way: the row is drawing it, the
    // task is not. `transition-all` because what moves is one collapse rather
    // than a list of properties, and naming them here would only say `COLLAPSED`
    // a second time.
    isClosing && "pointer-events-none transition-all duration-150 ease-out",
  );

  // Selecting on pointer-down rather than on click, and reading the middle
  // button there, is what the window's tab bar does; a tab that waits for the
  // full click feels heavier than the ones above it.
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === 1 && onClose) {
      onClose();
    } else if (event.button === 0) {
      onSelect();
    }
  };

  const contents = (
    <>
      {tab.type === "file" ? (
        <FileIcon className="size-4 shrink-0" filename={filename} />
      ) : isBusy ? (
        <ShinyGlobeIcon />
      ) : (
        <GlobeSimpleIcon className="size-4 shrink-0" />
      )}

      {/* The close sits over the name's last few pixels rather than beside it,
          so the name has the whole tab to run in and gives up its tail only
          while there is something drawn over it. The name is fully transparent
          everywhere the control is drawn, which is what keeps it from showing
          through.

          Off the strip rather than out of the tab once there is no room for it:
          the name is still what the tab is called, to a screen reader and to
          the tooltip the row carries. */}
      <span
        className={cn(
          "min-w-0",
          density === "full"
            ? cn(
                // The box runs to the end of the tab rather than to the end of
                // the text, so the fade below lands where the close is drawn
                // instead of eating the tail of a name with room to spare.
                isFixed ? "whitespace-nowrap" : "flex-1 truncate",
                // Only while the close is actually drawn, so a name short
                // enough to sit clear of it is not faded for nothing.
                isClosable &&
                  (isSelected
                    ? "tab-title-fade"
                    : "group-hover/pane-tab:tab-title-fade"),
              )
            : "sr-only",
        )}
      >
        {filename}
      </span>

      {/* The shimmer is the whole of what the mark is, and a shimmer is not
          available to a screen reader. So the state is said in words, off the
          strip, rather than left to the one channel that cannot carry it. */}
      {isBusy && (
        <span className="sr-only">Agent is working in the browser</span>
      )}

      {/* Held open for the selected tab, since the one being read is the one
          most likely to be closed. The browser has no close at all: it is the
          pane's zero state, so there is nothing behind it to fall back to, and
          neither does a tab compressed past the room for one -- at that width
          the icon is the whole tab, and closing is the middle button or the
          file's own menu. */}
      {isClosable && density !== "icon" && (
        <button
          aria-label={`Close ${filename}`}
          className={cn(
            "absolute top-1/2 right-1 size-4 -translate-y-1/2 items-center justify-center rounded-sm hover:bg-foreground/10",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
            isSelected ? "flex" : "hidden group-hover/pane-tab:flex",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          // The tab selects on pointer-down; stop it here so closing a
          // background tab does not first select it.
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

  // Standing on the row, being carried over it, or leaving it.
  let surface: React.CSSProperties | undefined;
  if (isClosing) {
    surface = COLLAPSED;
  } else if (isDragging) {
    surface = isSelected ? CARRIED_SELECTED : CARRIED;
  }

  const handlers = {
    // Out of the tree on the way out. What is collapsing is the row's picture
    // of a tab that has already gone, and there is nothing there to read, move
    // to, or land on.
    "aria-hidden": isClosing || undefined,
    "aria-selected": isSelected,
    className,
    // What this tab ended up with room for, which is not always what the tab
    // beside it did.
    "data-density": density,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
        return;
      }
      // Selecting as focus moves, which is right when showing a tab costs
      // nothing and is the only thing arrowing onto it could mean.
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        onSelectRelative(direction);
        // Selection is the parent's, focus is the DOM's, and the two have to
        // move together or the ring is left on the tab that was showing a
        // moment ago. Read from the rendered strip so the order is whatever
        // was actually drawn, dragged tabs included.
        focusSiblingTab(event.currentTarget, direction);
      }
    },
    onPointerDown,
    role: "tab",
    style: surface,
    // Roving: the strip is one stop in the page's tab order, and arrows move
    // within it. Otherwise every open file is another press of Tab to get past.
    // A tab that has been closed is not a stop at all, whatever it was.
    tabIndex: isClosing || !isSelected ? -1 : 0,
    // What the tab is called, for the widths where it cannot say so itself.
    title: filename,
  };

  // A div rather than a button, because the close control sits inside it and a
  // button inside a button is not a thing the DOM has.
  return value === undefined ? (
    <div {...handlers}>{contents}</div>
  ) : (
    // Position only. The default animates a size change by scaling the tab,
    // which stretches the icon inside it, and the sizes here change on their
    // own whenever the strip changes state.
    //
    // The move is worth watching under a drag, where a tab is being put
    // somewhere and the ones it displaces have to be seen giving way. Every
    // other move the strip makes is an arrival at a state -- selecting a tab,
    // switching tasks, dragging the pane wider -- and those land in place.
    //
    // Closing is on the drag's side of that, and is animated -- see `COLLAPSED`.
    // It is not animated from here, though: what moves is the tab's own width
    // rather than a box being carried to a new place, so the projection has
    // nothing to say about it and is left alone.
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

/**
 * The browser tab's icon while the agent is in there.
 *
 * The globe stays: it is what says the tab is a browser, and a tab that stops
 * looking like one to say something about it has traded the wrong thing. What
 * moves is the light on it -- the same traveling highlight `brand-shiny-text`
 * runs across a word, on the same period.
 *
 * The name beside it is left alone. The tab is a label the eye returns to for
 * what the tab is, and a word that changes color is read as different words
 * before it is read as the same ones lit; the icon carries the state and the
 * name goes on saying what the tab is called.
 *
 * Two copies of the icon stacked in one cell, because a highlight brighter than
 * the thing it crosses cannot be painted by dimming: the mask reveals the
 * brighter globe in a band, and the base one shows everywhere else.
 */
function ShinyGlobeIcon() {
  return (
    <span className="grid size-4 shrink-0 place-items-center">
      <GlobeSimpleIcon className="brand-shiny-icon col-start-1 row-start-1 size-4" />
      <GlobeSimpleIcon className="brand-shiny-icon-highlight col-start-1 row-start-1 size-4" />
    </span>
  );
}

/**
 * What the strip can draw, from the room it has and the number of tabs sharing
 * it -- the fixed tab included, since it takes a share of the row like the rest
 * and can give its name up like the rest.
 *
 * One state for the strip rather than one per tab, which is the whole point of
 * an even share: every tab has the same room, so a strip that took the name off
 * one of them and left it on the next would be saying something about them that
 * is not true. It reads as broken rather than as compressed.
 *
 * The exception is the tab being read, which is held at a width that can still
 * carry a name and a close while the rest of the row goes to icons. It is the
 * one tab whose name the reader already knows and the one they are most likely
 * to close, and a row that gives up on it first is a row that made the pane
 * harder to use in exchange for two more icons.
 *
 * Nothing is drawn under `MIN_TAB`. A strip that kept dividing what it had
 * would end in a row of clipped half-icons, so past that point the tabs that
 * fit are drawn whole and the rest are not drawn -- the same bargain the
 * browser strikes, where a full enough window leaves tabs you have to close
 * something to get back to.
 */
function stripLayout(available: number, count: number): StripLayout {
  // Not laid out yet: a pane that has not been sized, or a test with no layout
  // engine at all. A zero width is not a reading, so it takes nothing away.
  if (available <= 0 || count === 0) {
    return {
      density: "full",
      fixedIsNamed: true,
      selectedDensity: "full",
      visibleCount: count,
    };
  }

  const visibleCount = Math.min(
    count,
    Math.max(1, Math.floor((available + GAP) / (MIN_TAB + GAP))),
  );
  const content = available - GAP * (visibleCount - 1);
  const equalShare = content / visibleCount;

  // Room for every name, so there is nothing to hand out and no reason to take
  // the row apart unevenly.
  if (equalShare >= NAME_FITS) {
    return {
      density: "full",
      fixedIsNamed: true,
      selectedDensity: "full",
      visibleCount,
    };
  }

  // The most the selected tab can be given without taking another tab under the
  // width of its own icon. What the tabs are actually laid out by is the
  // `min-width` this picks for each of them, which is why it stops where the
  // next state down begins rather than anywhere in between.
  const reserved = Math.min(NAME_FITS, content - MIN_TAB * (visibleCount - 1));
  if (visibleCount === 1 || reserved < CLOSE_FITS) {
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

/** What a tab of a given width has the room to draw. */
function tabDensity(width: number): TabDensity {
  if (width >= NAME_FITS) {
    return "full";
  }
  return width >= CLOSE_FITS ? "compact" : "icon";
}
