import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/window";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { ResizeHandle } from "@/client/components/resize-handle";
import {
  ActiveTabProvider,
  useIsActiveTab,
} from "@/client/hooks/use-active-tab";
import {
  onPagePress,
  pageHoldingKeyboard,
  takeKeyboardOnArrival,
} from "@/client/lib/browser-pool";
import {
  dropCaretOutside,
  keepCaretOnKeyboardSide,
  placeCaretAfterPress,
  setHomeFocus,
} from "@/client/lib/keyboard-home";
import { SIDE_MOTION } from "@/client/lib/motion";
import { afterNextPaint } from "@/client/lib/tab-view-state";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { noop } from "radashi";
import { useAtom, useAtomValue } from "jotai";
import { motion, useReducedMotion } from "motion/react";
import {
  type ComponentProps,
  type CSSProperties,
  memo,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type PageChromeSlots } from "./browser-tabs";
import { useWindow } from "./context";
import { GroupItem } from "./group-item";
import { isKeptScreen, keptScreensAtom, withoutClosed } from "./kept-screens";
import { SidebarToggle } from "./inbox-toggle";
import { usePageHost } from "./page-hosts";
import { PaneTabs, type SplitMenuActions, stripKeyOf } from "./pane-tabs";
import { PaneTopContext } from "./pane-top";
import { TabRowControl } from "./tab-location-row";
import {
  pressSideTab,
  useSidePagesTarget,
  useSideStrip,
  useStripLandsHere,
  useStripTarget,
} from "./drag/use-group-drag";
import { RecentlyClosedMenu } from "./recently-closed-menu";
import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";
import { ShellContext, useShell } from "./shell-context";
import { useSideCaret } from "./use-side-caret";
import { useSideMotion } from "./side-motion";
import { windowTabGroupsAtom } from "./open-groups";
import { useTabGroupActions } from "./tab-groups";
import { useGroupTabMoves } from "./tab-drag";
import { type GroupLayout, type GroupSide } from "./tab-model";
import { ShowSidePanelControl } from "./side-panel";
import { useSidePanel } from "./side-panel-state";
import {
  leftWidthAt,
  scrollToShow,
  shareAt,
  SIDE_WIDTH_MIN,
  sideShare,
} from "./side-widths";
import { useTabSurface } from "./tab-surface";
import { WINDOW_CARD, WINDOW_CARD_GAP } from "./window-frame";
import {
  groupOnScreenAtom,
  HeldTabsContext,
  heldTabsAtomOf,
  newScreenId,
  useGroupLayout,
  useWindowTabs,
} from "./window-tabs";
import {
  heldHintAtom,
  tabChordLabel,
  tabChordNumbers,
} from "./held-chord-hints";

/**
 * One tab group, as the window's tab shows it: one side or two, each a card
 * of its own with its tabs across its head, the toolbar and bookmarks under
 * them, and what its tab up shows. A chat is a tab like any other, on
 * either side. Two sides share the row by the gutter between them, which
 * stops at each side's narrowest; past that the group scrolls sideways.
 * The keyboard is on one side at a time: a press anywhere in a side, its
 * page included, takes it there.
 */
export function GroupView({ group }: { group: string | undefined }) {
  const isActive = useIsActiveTab();
  const { allTabs } = useWindowTabs();
  const [kept, setKept] = useAtom(keptScreensAtom);
  useEffect(() => {
    const open = new Set(allTabs.map((tab) => tab.id));
    setKept((current) => withoutClosed(current, open));
  }, [allTabs, setKept]);
  // The groups with a screen kept stay drawn behind the one up, each where
  // it was first drawn: a group moved among them would be taken out of the
  // document and put back, and lose where its screens were scrolled.
  const keptGroups = new Set(
    allTabs.flatMap((tab) =>
      tab.group !== undefined && kept.includes(tab.id) && isKeptScreen(tab)
        ? [tab.group]
        : [],
    ),
  );
  const [drawn, setDrawn] = useState<readonly string[]>([]);
  const wanted = [
    ...drawn.filter((each) => each === group || keptGroups.has(each)),
    ...[...(group === undefined ? [] : [group]), ...keptGroups].filter(
      (each, index, all) =>
        !drawn.includes(each) && all.indexOf(each) === index,
    ),
  ];
  if (
    wanted.length !== drawn.length ||
    wanted.some((each, index) => each !== drawn[index])
  ) {
    setDrawn(wanted);
  }
  useEffect(() => {
    rpcClient.window.noteDrawn
      .call({ drawnGroups: wanted.length, keptScreens: kept.length })
      .catch(() => {
        // A count for the log alone; the next change sends a fresh one.
      });
  }, [wanted.length, kept.length]);
  return (
    <div
      className={
        group === undefined
          ? "relative flex min-h-0 min-w-0 flex-1"
          : GROUP_GROUNDS
      }
      // The group draws its own cards, so the window's card stands back.
      {...(isActive && group !== undefined ? { "data-own-cards": "" } : {})}
    >
      {wanted.map((each) => {
        const isUp = each === group;
        return (
          <div
            // Invisible and transparent, as a window tab behind the one up
            // is, and never taken out of the layout: a screen out of sight
            // keeps its size, and with it where it was scrolled.
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0",
              !isUp && "invisible opacity-0",
            )}
            inert={!isUp}
            key={each}
            {...(isUp ? { "data-group-up": "" } : {})}
          >
            <DrawnGroup group={each} isActive={isActive} isUp={isUp} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A group as it is drawn: the one up reads the window as it is, and one kept
 * drawn behind it reads the window as it stood for that group, its tabs
 * changing only as its own do (`heldTabsAtomOf`) and the window's shell as it
 * was when the group was last up. Nothing done in another group draws a
 * group out of sight again, as a browser draws nothing of a tab behind the
 * one in front.
 *
 * Kept by hand (`memo`): the window draws one per group in a loop the React
 * Compiler keeps nothing of, on every change to its tabs.
 */
const DrawnGroup = memo(function DrawnGroup({
  group,
  isActive,
  isUp,
}: {
  group: string;
  /** Whether the window's tab is the one in front. */
  isActive: boolean;
  isUp: boolean;
}) {
  const held = useMemo(() => heldTabsAtomOf(group), [group]);
  const shell = useShell();
  const [shellWhenUp, setShellWhenUp] = useState(shell);
  if (isUp && shellWhenUp !== shell) {
    setShellWhenUp(shell);
  }
  return (
    <HeldTabsContext value={isUp ? null : held}>
      <ShellContext value={isUp ? shell : shellWhenUp}>
        <ActiveTabProvider isActive={isActive && isUp}>
          <GroupSides group={group} isUp={isUp} />
        </ActiveTabProvider>
      </ShellContext>
    </HeldTabsContext>
  );
});

/** Scrolls a group's row the least that shows the side with the keyboard. */
function showSideWithKeyboard(scroller: HTMLElement) {
  const side = scroller.querySelector<HTMLElement>(
    "[data-group-side][data-keyboard]",
  );
  if (!side) {
    return;
  }
  scroller.scrollLeft = scrollToShow({
    end: side.offsetLeft + side.offsetWidth,
    scroll: scroller.scrollLeft,
    start: side.offsetLeft,
    view: scroller.clientWidth,
  });
}

/** The sides of a group in their row, the gutter between, scrolling sideways below their narrowest. */
function GroupSides({
  group,
  isUp,
}: {
  group: string;
  /** Whether the group is the one on screen, rather than kept drawn behind it. */
  isUp: boolean;
}) {
  const windowTabs = useWindowTabs();
  const layout = useGroupLayout(group);
  const [dragged, setDragged] = useState<number>();
  // The share a drag last reached, read as it ends: the handle keeps the
  // callbacks of the render the press began in, so `dragged` there is stale.
  const draggedNow = useRef<number>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isTwo = layout.sides.length === 2;
  useSidePagesTarget({
    group,
    isOn: useIsActiveTab(),
    layout,
    scroller: () => scrollerRef.current,
  });

  // The row's width, which the gutter stands along.
  const [rowWidth, setRowWidth] = useState(0);
  // Measured before the first paint: where the gutter stands depends on it.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    setRowWidth(row.offsetWidth);
    const observer = new ResizeObserver(() => {
      setRowWidth(row.offsetWidth);
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, []);
  // The side with the keyboard is in view when a group comes up in the row
  // and as the row's view changes width (a zoom, the window, the sidebar), as
  // a page keeps what has the keyboard in view.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) {
      showSideWithKeyboard(scroller);
    }
  }, [group]);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const observer = new ResizeObserver(() => {
      showSideWithKeyboard(scroller);
    });
    observer.observe(scroller);
    return () => {
      observer.disconnect();
    };
  }, []);
  /** The room the two sides share past the gutter, in layout px, as last measured. */
  const room = Math.max(rowWidth - WINDOW_CARD_GAP, 0);
  /** The same room measured now, for a drag. */
  const roomNow = () =>
    (rowRef.current?.offsetWidth ?? rowWidth) - WINDOW_CARD_GAP;
  const own = windowTabs.groupOwn[group];
  const shareOfTwo = sideShare({
    chatSide: own?.chatSide,
    room,
    share: dragged ?? own?.share,
  });
  // A side closing shrinks from where it stood, which the group forgets as
  // it goes back to one side.
  const [lastShare, setLastShare] = useState(shareOfTwo);
  if (isTwo && lastShare !== shareOfTwo) {
    setLastShare(shareOfTwo);
  }
  const share = isTwo ? shareOfTwo : lastShare;
  /** Where the gap between the sides is laid out, from the row's left. */
  const gutterAt = leftWidthAt(share, room);
  const motionSides = useSideMotion(group, layout);
  const isMoving =
    motionSides.entering.size > 0 || motionSides.leaving.length > 0;
  // The sides opening start to grow once they have been drawn at nothing: what a side shows takes a moment to put up, and a motion
  // started before it was would be over by the first frame anyone sees.
  const enteringNow =
    motionSides.entering.size === 0 ? "" : String(motionSides.round);
  const [started, setStarted] = useState({ for: "" });
  useEffect(() => {
    if (enteringNow === "") {
      return;
    }
    let isGone = false;
    void afterNextPaint().then(() => {
      if (!isGone) {
        setStarted({ for: enteringNow });
      }
    });
    return () => {
      isGone = true;
    };
  }, [enteringNow]);
  const startedKeys = new Set(
    started.for === enteringNow && enteringNow !== ""
      ? [...motionSides.entering]
      : [],
  );
  /** How much of the row a side at `at` takes of two. */
  const growOf = (at: 0 | 1) => (at === 0 ? share : 1 - share);
  /** A side's width in two, as it stands once the row settles. */
  const widthAt = (at: 0 | 1) => {
    const left = leftWidthAt(share, room);
    return at === 0 ? left : room - left;
  };
  // The sides as drawn, in their places, with a side closing still in its
  // place as it shrinks away.
  const drawnSides: {
    at: 0 | 1;
    key: number;
    leaving: boolean;
    side?: GroupSide;
  }[] = layout.sides.map((side, index) => ({
    at: index === 1 ? 1 : 0,
    key: motionSides.keys[index] ?? index,
    leaving: false,
    side,
  }));
  for (const gone of motionSides.leaving) {
    drawnSides.splice(gone.at === 0 ? 0 : drawnSides.length, 0, {
      at: gone.at,
      key: gone.key,
      leaving: true,
    });
  }
  const keepShare = (next: number | undefined) => {
    windowTabs.setGroupOwn(group, { share: next });
  };

  return (
    <div
      // Two pixels of room past the cards, which the focused side's line
      // (`FOCUSED_SIDE`) is drawn in, taken back by the margin.
      className="relative -m-0.5 min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden p-0.5"
      style={
        {
          "--gutter-at": `${gutterAt}px`,
        } as CSSProperties // A custom property, which CSSProperties does not name.
      }
      // A page in a side is cut to what the row shows of it (`useBrowserSlot`).
      data-guest-clip=""
      // The groups take turns in this one scroller. The router's scroll
      // restoration finds a scroller by this id and writes the offset it read
      // on one page to it on the next, so naming the group keeps one group's
      // offset off another's row.
      data-scroll-restoration-id={`group-sides-${group}`}
      ref={scrollerRef}
    >
      <div
        className="flex h-full"
        data-group-sides=""
        ref={rowRef}
        style={{
          minWidth:
            isTwo && !isMoving
              ? SIDE_WIDTH_MIN * 2 + WINDOW_CARD_GAP
              : SIDE_WIDTH_MIN,
        }}
      >
        {drawnSides.map((each, index) => {
          const width = widthAt(each.at);
          const isMovingSide =
            each.leaving || motionSides.entering.has(each.key);
          const neighbor = drawnSides[index === 0 ? 1 : index - 1];
          const isNeighborMoving =
            neighbor !== undefined &&
            (neighbor.leaving || motionSides.entering.has(neighbor.key));
          // The gap between two sides goes with the one moving, so it opens
          // and closes with it; otherwise it leads the later side.
          let gap: "end" | "start" | undefined;
          if (drawnSides.length > 1) {
            if (isMovingSide) {
              gap = index === 0 ? "end" : "start";
            } else if (!isNeighborMoving && index > 0) {
              gap = "start";
            }
          }
          const isEntering = motionSides.entering.has(each.key);
          const isStarted = startedKeys.has(each.key);
          const isNeighborEntering =
            neighbor !== undefined && motionSides.entering.has(neighbor.key);
          const basis = gap === undefined ? "0px" : `${WINDOW_CARD_GAP}px`;
          // Where its place is going. A side opening waits at nothing for its
          // first frame (`startedKeys`), and the side beside it waits whole
          // with it, so the two always fill the row between them.
          let to: SidePlace;
          if (each.leaving) {
            to = { flexBasis: "0px", flexGrow: 0 };
          } else if (isEntering) {
            to = isStarted
              ? { flexBasis: basis, flexGrow: growOf(each.at) }
              : { flexBasis: "0px", flexGrow: 0 };
          } else if (
            isNeighborEntering &&
            neighbor &&
            !startedKeys.has(neighbor.key)
          ) {
            to = { flexBasis: basis, flexGrow: 1 };
          } else {
            to = { flexBasis: basis, flexGrow: isTwo ? growOf(each.at) : 1 };
          }
          const moving = (
            <SideMotion
              from={
                isEntering
                  ? { flexBasis: "0px", flexGrow: 0 }
                  : each.leaving
                    ? { flexBasis: basis, flexGrow: growOf(each.at) }
                    : undefined
              }
              gap={gap}
              glides={isMovingSide || isNeighborMoving}
              isMoving={isMovingSide}
              key={each.leaving ? `leaving:${each.key}` : `side:${each.key}`}
              onEnd={() => {
                if (isMovingSide && (!isEntering || isStarted)) {
                  motionSides.settle(each.key);
                }
              }}
              opensFrom={each.at === 0 ? "start" : "end"}
              to={to}
            >
              {each.leaving || each.side === undefined ? (
                <div
                  className={cn("h-full shrink-0", WINDOW_CARD)}
                  data-side-leaving=""
                  style={{ width }}
                />
              ) : (
                <SideCard
                  group={group}
                  hasKeyboard={isUp && layout.focused === each.at}
                  isFirst={each.at === 0}
                  isUp={isUp}
                  isLast={each.at === layout.sides.length - 1}
                  layout={layout}
                  place={`${group}:${each.at}:${isTwo ? growOf(each.at) : 1}`}
                  side={each.side}
                  sideIndex={each.at}
                  style={
                    motionSides.entering.has(each.key)
                      ? { flexShrink: 0, width }
                      : { flex: "1 1 0px" }
                  }
                />
              )}
            </SideMotion>
          );
          return moving;
        })}
      </div>
      {isTwo &&
        !isMoving && (
          // The gap between the cards is the gutter, standing over the row at
          // the left side's edge.
          <ResizeHandle
            anchor={() => {
              const row = rowRef.current;
              return row ? row.getBoundingClientRect().left : undefined;
            }}
            className="top-0 bottom-0 left-(--gutter-at)"
            getWidth={() => leftWidthAt(share, roomNow())}
            grows="right"
            label="Resize sides"
            max={Math.max(room - SIDE_WIDTH_MIN, SIDE_WIDTH_MIN)}
            min={SIDE_WIDTH_MIN}
            onReset={() => {
              setDragged(undefined);
              keepShare(undefined);
            }}
            onResize={(width) => {
              draggedNow.current = shareAt(width, roomNow());
              setDragged(draggedNow.current);
            }}
            onResizeEnd={() => {
              if (draggedNow.current !== undefined) {
                keepShare(draggedNow.current);
              }
              draggedNow.current = undefined;
              setDragged(undefined);
              document.documentElement.removeAttribute("data-tab-held");
            }}
            onResizeStart={() => {
              // The pages under the pointer let it pass while the gutter moves.
              document.documentElement.toggleAttribute("data-tab-held", true);
            }}
            value={gutterAt}
          />
        )}
    </div>
  );
}

/** A side's place in the row: its share of the room, and the gap it carries. */
// A type rather than an interface, which motion's targets need indexable.
type SidePlace = { flexBasis: string; flexGrow: number };

/**
 * A side's place in the row, which grows from nothing at its end of the row
 * as the side opens and shrinks back as it closes, the side beside it
 * giving room or taking it back on the same curve (`SIDE_MOTION`, `glides`),
 * so the two fill the row between them every frame. While it moves its card
 * stands at the width it settles at, cut to the place, so the side slides
 * in whole rather than unfolding, and a page in it is cut there too
 * (`data-guest-clip`). The gap beside it, when it has one, is part of it.
 */
function SideMotion({
  children,
  from,
  gap,
  glides,
  isMoving,
  onEnd,
  opensFrom,
  to,
}: {
  children: ReactNode;
  /** Where its place starts, for a side opening or closing. */
  from: SidePlace | undefined;
  gap: "end" | "start" | undefined;
  /** Whether a change of its place moves on the side's curve rather than at once, as a gutter dragged moves it. */
  glides: boolean;
  /** Whether this side is the one opening or closing. */
  isMoving: boolean;
  onEnd: () => void;
  /** The end of the row the side opens from and closes into. */
  opensFrom: "end" | "start";
  to: SidePlace;
}) {
  const isReduced = useReducedMotion() === true;
  return (
    <motion.div
      animate={to}
      className={cn(
        "flex h-full shrink",
        isMoving && "overflow-hidden",
        opensFrom === "start" && isMoving && "justify-end",
      )}
      {...(isMoving ? { "data-guest-clip": "" } : {})}
      initial={from ?? false}
      onAnimationComplete={onEnd}
      style={{
        minWidth:
          isMoving || glides
            ? 0
            : SIDE_WIDTH_MIN + (gap === undefined ? 0 : WINDOW_CARD_GAP),
      }}
      transition={isReduced || !glides ? { duration: 0 } : SIDE_MOTION}
    >
      {gap === "start" && <div className="w-2 shrink-0" />}
      {children}
      {gap === "end" && <div className="w-2 shrink-0" />}
    </motion.div>
  );
}

/**
 * How the side with the keyboard is marked while a group shows two, so
 * typing has a visible home: an ink line round its card in the theme's own
 * ring color, softened a little, the same ink a place letting go opens
 * something in is edged with (`DROP_LOOK.open`).
 */
const FOCUSED_SIDE = "outline-2 outline-ring/75";

/**
 * One side of a group: a card with the side's tabs across its head, ending
 * in the new tab control, over what its tab up shows. The side with the
 * keyboard draws its page in the window's slot; the other in a slot of its
 * own (`usePageHost`).
 */
function SideCard({
  group,
  hasKeyboard,
  isFirst,
  isLast,
  isUp,
  layout,
  place,
  side,
  sideIndex,
  style,
}: {
  group: string;
  hasKeyboard: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Whether the side's group is the one on screen. */
  isUp: boolean;
  layout: GroupLayout;
  /** Where the side stands, which changes as its page's host moves. */
  place: string;
  side: GroupSide;
  sideIndex: 0 | 1;
  style: CSSProperties;
}) {
  const shell = useShell();
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const moves = useGroupTabMoves();
  const listedGroups = useAtomValue(windowTabGroupsAtom);
  const isActive = useIsActiveTab();
  // While the tab chord's modifier is held, each tab wears the keys that
  // pick it, numbered across both sides as the chords count them.
  const heldHint = useAtomValue(heldHintAtom);
  const isOnScreen = useAtomValue(groupOnScreenAtom) === group;
  const chords =
    heldHint === "tabs" && isActive && isOnScreen
      ? new Map(
          [
            ...tabChordNumbers(
              layout.sides.flatMap((each) => each.tabs.map((tab) => tab.id)),
            ),
          ].map(([id, number]) => [id, tabChordLabel(number)]),
        )
      : undefined;
  const { tabs } = side;
  const up = tabs.find((tab) => tab.id === side.up);
  const cardRef = useRef<HTMLDivElement>(null);
  const strip = () =>
    cardRef.current?.querySelector<HTMLElement>("[data-group-tabs]");
  useStripTarget({
    group,
    isOn: isActive,
    page: () =>
      cardRef.current?.querySelector(`[data-side-page="${sideIndex}"]`),
    side: sideIndex,
    strip,
    tabs,
  });
  const isLandedOn = useStripLandsHere(group, sideIndex);
  // What is held over the strip stands among its tabs where it would land.
  const drawn = useSideStrip({ group, side: sideIndex, tabs });

  // What the side draws: its tab up while its group is on screen, and the
  // screens kept behind it. In the order of their ids, which no move among
  // the tabs changes, so none is taken out of the document and put back.
  const kept = useAtomValue(keptScreensAtom);
  const screens = tabs
    .filter(
      (tab) =>
        (isUp && tab.id === up?.id) ||
        (kept.includes(tab.id) && isKeptScreen(tab)),
    )
    .toSorted((a, b) => (a.id < b.id ? -1 : 1));

  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  const isPage = up?.kind === "page" && pageHost !== null;
  useTabSurface(
    "slot",
    hasKeyboard && isPage && pageHost
      ? { chrome: pageChrome, host: pageHost, isShown: true }
      : null,
  );
  usePageHost(
    `side:${group}`,
    isUp && !hasKeyboard && isPage && up
      ? {
          chrome: pageChrome ?? false,
          into: pageHost,
          isActive,
          place,
          tabId: up.id,
        }
      : undefined,
  );

  const otherSide: 0 | 1 = sideIndex === 0 ? 1 : 0;

  // A page's side is worked from the page, which the window hands the
  // keyboard to by handing it to the page (`keyboard-home.ts`).
  const pageUp = up?.kind === "page" ? up.id : undefined;
  useEffect(() => {
    if (!pageHost || pageUp === undefined) {
      return;
    }
    const target = browserTargetOf(pageUp);
    return setHomeFocus(pageHost, {
      focus: () => {
        takeKeyboardOnArrival(target);
      },
      holds: () => pageHoldingKeyboard() === target,
    });
  }, [pageHost, pageUp]);

  // The caret goes with the keyboard. A press on this side lets go of the
  // caret the other side has, for the press to place. A side taking the
  // keyboard otherwise (a tab moved, opened or brought up here, or another
  // group shown) takes that caret, or a caret on nothing, into its home: its page, a chat's
  // composer, or a file. With a menu up, that waits for the caret the menu
  // hands back as it goes.
  const isPressed = useRef(false);
  const isCaretOnOtherSide = () => {
    const card = cardRef.current;
    const now = document.activeElement;
    if (!card || !(now instanceof HTMLElement)) {
      return false;
    }
    if (now.tagName === "WEBVIEW") {
      const target = pageHoldingKeyboard();
      return (
        layout.sides[otherSide]?.tabs.some(
          (tab) => tab.kind === "page" && browserTargetOf(tab.id) === target,
        ) === true
      );
    }
    const holder = now.closest("[data-group-side]");
    return (
      holder !== null &&
      holder !== card &&
      holder.closest("[data-group-sides]") ===
        card.closest("[data-group-sides]")
    );
  };
  useSideCaret({
    cardRef,
    hasKeyboard: hasKeyboard && isActive,
    isCaretOnOtherSide,
    isPressed,
    shown: up && `${group}/${up.id}`,
  });

  // Which side has the keyboard is the group's state (`focusSide`), which
  // changes only on purpose: here, for every kind of tab rather than by each,
  // a press of the pointer anywhere on the side, on the way down (below), or
  // in one of its pages, which a guest standing over the side takes and main
  // reports (`onPagePress`). A caret landing in the side otherwise (a field
  // or a page focusing itself) changes nothing, and goes back to the side
  // with the keyboard; a page is sent back by the browser pool.
  const takeKeyboard = () => {
    if (!hasKeyboard) {
      windowTabs.focusSide(group, sideIndex);
    }
  };
  const pageTakesKeyboard = useEffectEvent(takeKeyboard);
  const pagesKey = tabs
    .flatMap((tab) => (tab.kind === "page" ? [browserTargetOf(tab.id)] : []))
    .join(" ");
  useEffect(() => {
    if (pagesKey === "") {
      return;
    }
    const targets = new Set(pagesKey.split(" "));
    return onPagePress((target) => {
      if (targets.has(target)) {
        pageTakesKeyboard();
      }
    });
  }, [pagesKey]);

  /** A copy of a tab, a page at its address or a screen at its own, placed in the group. */
  const copyOf = (
    tab: WindowTab,
    placing: { after?: string; side: 0 | 1 | "same" },
  ) => {
    const from = { reason: "asked", tab: tab.id } as const;
    if (tab.kind === "page") {
      const url = tab.url ?? tab.openedUrl;
      if (url !== undefined) {
        appWindow.browser?.open(url, {
          from,
          group,
          ...placing,
        });
      }
      return;
    }
    windowTabs.openScreen(tab.href, {
      ...(placing.after === undefined ? {} : { after: placing.after }),
      from,
      group,
      select: true,
      side: placing.side,
    });
  };
  const groupTabCount = layout.sides.reduce(
    (count, each) => count + each.tabs.length,
    0,
  );
  // The window's only tab is in a window of its own already.
  const isWindowsOnlyTab =
    groupTabCount === 1 &&
    (listedGroups ?? []).every((listed) => listed === group);
  const [firstHere] = tabs;
  // What the side's strip and its menus do, each one function for as long as
  // the side is drawn: they close over the tabs as they are, which change
  // with every switch, and the strip draws every tab again for a new one.
  const splitWays = useSteadyCallbacks<
    Omit<SplitMenuActions, "group" | "hasKeyboard" | "hasOtherSide">
  >({
    onCloseSplit:
      layout.sides.length === 2 && firstHere
        ? () => {
            shell.closeSide(firstHere.id);
          }
        : undefined,
    onJoinSides:
      layout.sides.length === 2
        ? () => {
            windowTabs.joinSides(group);
          }
        : undefined,
    onMoveToNewGroup:
      groupTabCount > 1
        ? (tab) => {
            groups.make({
              moving: tab.id,
              ...(windowTabs.groupOwn[group]?.pinned
                ? {}
                : { place: { after: group } }),
            });
          }
        : undefined,
    onMoveToNewWindow: isWindowsOnlyTab
      ? undefined
      : (tab) => {
          moves.toNewWindow(tab.id);
        },
    onMoveToWindow: (tab, windowId) => {
      moves.toWindow(tab.id, windowId);
    },
    onMoveToOtherSide: (tab) => {
      windowTabs.moveTo({ group, id: tab.id, select: true, side: otherSide });
    },
    // Right after the other side's tab up, where + and ⌘T put one there.
    onNewChatInSplit: () => {
      const upThere = layout.sides[otherSide]?.up;
      windowTabs.openIn(
        { group, href: NEW_TAB_HREF, id: newScreenId(), kind: "screen" },
        {
          from: { reason: "newTab" },
          group,
          select: true,
          side: otherSide,
          ...(upThere === undefined ? {} : { after: upThere }),
        },
      );
    },
    onOpenInSplit: (tab) => {
      copyOf(tab, { side: otherSide });
    },
  });
  const stripWays = useSteadyCallbacks<
    Pick<
      ComponentProps<typeof PaneTabs>,
      "onDuplicate" | "onNew" | "onSelect" | "onTabPress"
    >
  >({
    onDuplicate: (tab) => {
      copyOf(tab, { after: tab.id, side: "same" });
    },
    onNew: () => {
      windowTabs.openScreen(NEW_TAB_HREF, {
        from: { reason: "newTab" },
        group,
        select: true,
        side: sideIndex,
      });
    },
    onSelect: (id) => {
      windowTabs.select(id);
    },
    onTabPress: (key, event) => {
      const tab = tabs.find((each) => stripKeyOf(each) === key);
      if (tab) {
        pressSideTab(event, { group, side: sideIndex, tab });
      }
    },
  });
  const split: SplitMenuActions = {
    ...splitWays,
    group,
    hasKeyboard,
    hasOtherSide: layout.sides.length === 2,
  };

  // A pane of one tab draws no strip: its tab's own row is its top, with
  // the sidebar's toggle at its start and the pane's corner at its end
  // (`PaneTop`). One held over it or carried off it keeps the strip, and a
  // piece of the window held over that row brings it up to land in.
  const hasStrip =
    drawn.tabs.length > 1 ||
    drawn.heldAt !== undefined ||
    drawn.carriedKey !== undefined ||
    isLandedOn;
  const newTabHere = () => {
    windowTabs.openScreen(NEW_TAB_HREF, {
      from: { reason: "newTab" },
      group,
      select: true,
      side: sideIndex,
    });
  };
  // The side panel's button for a group of one side while the panel is
  // closed there, since its own × closes it; in a split, each side's × in
  // its place, since the window shows two sides at most and a split shows
  // the panel only when it was open first. A page, a folder or a file opens
  // a chat beside it from its field instead (`onChatBeside`).
  const sidePanel = useSidePanel(group);
  const splitControl =
    layout.sides.length === 2 ? (
      <TabRowControl
        chord="closeSplit"
        disabled={split.onCloseSplit === undefined}
        icon={<XIcon className="size-4" />}
        label="Close Split"
        onClick={() => {
          split.onCloseSplit?.();
        }}
      />
    ) : sidePanel.isOpen ? null : (
      <ShowSidePanelControl
        onClick={() => {
          sidePanel.setOpen(true);
        }}
      />
    );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col",
        WINDOW_CARD,
        layout.sides.length === 2 && hasKeyboard && FOCUSED_SIDE,
      )}
      data-group-side={sideIndex}
      {...(layout.sides.length === 2 && {
        "aria-label": sideIndex === 0 ? "Left side" : "Right side",
        role: "region",
      })}
      {...(hasKeyboard ? { "data-keyboard": "" } : {})}
      {...(isUp && up?.kind === "page" ? { "data-page-tab": up.id } : {})}
      data-tab-up={up?.id}
      ref={cardRef}
      onPointerDownCapture={() => {
        isPressed.current = true;
        window.addEventListener(
          "pointerup",
          () => {
            isPressed.current = false;
            const card = cardRef.current;
            if (card) {
              placeCaretAfterPress(card);
            }
          },
          { capture: true, once: true },
        );
        if (!hasKeyboard) {
          if (
            isCaretOnOtherSide() &&
            document.activeElement instanceof HTMLElement
          ) {
            document.activeElement.blur();
          }
          const card = cardRef.current;
          if (card) {
            dropCaretOutside(card);
          }
          takeKeyboard();
        }
      }}
      // A drop the side's own page takes (a folder in Files, a composer)
      // gives the side the keyboard, as a press in it does; one the window's
      // drag lands goes through its moves, which give it there.
      onDropCapture={takeKeyboard}
      onFocusCapture={() => {
        const card = cardRef.current;
        if (card && !isPressed.current && !hasKeyboard) {
          keepCaretOnKeyboardSide(card);
        }
      }}
      style={style}
    >
      {hasStrip && (
        <PaneTabs
          carriedKey={drawn.carriedKey}
          chatTitles={shell.chatTitles}
          chords={chords}
          chosenId={drawn.chosenId ?? up?.id}
          className={SIDE_TABS}
          heldAt={drawn.heldAt}
          lead={isFirst ? <SidebarToggle /> : undefined}
          onClose={shell.requestClose}
          onDuplicate={stripWays.onDuplicate}
          onNew={stripWays.onNew}
          onSelect={stripWays.onSelect}
          newMenu={<RecentlyClosedMenu />}
          reopen={shell.reopenTab}
          onTabPress={stripWays.onTabPress}
          side={sideIndex}
          split={split}
          tabs={drawn.tabs}
          taskTitles={shell.childTitles}
          trailing={
            <>
              {/* Room a full strip keeps to drag the window by. */}
              {isLast && isMacOS() && (
                <div aria-hidden className="w-10 shrink-0" />
              )}
              {splitControl}
            </>
          }
        />
      )}
      {/* The width a screen in this side gets, for `@container/app-content`
          variants: the side's own, not the window's. */}
      <div
        className="@container/app-content relative min-h-0 flex-1"
        data-side-page={sideIndex}
      >
        {screens.map((tab) => {
          const isTabUp = isUp && tab.id === up?.id;
          return (
            <div
              // The tab up, and behind it the screens kept drawn: out of
              // sight as a group behind the one up is (`GroupView`).
              className={cn(
                "absolute inset-0",
                !isTabUp && "invisible opacity-0",
              )}
              inert={!isTabUp}
              key={tab.id}
            >
              <PaneTopContext
                value={
                  hasStrip || !isTabUp
                    ? null
                    : {
                        corner: (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <TabRowControl
                              chord="newTab"
                              disabled={false}
                              icon={<PlusIcon className="size-4" />}
                              label="New Tab"
                              onClick={newTabHere}
                            />
                            {splitControl}
                          </div>
                        ),
                        lead: isFirst ? <SidebarToggle /> : undefined,
                      }
                }
              >
                <GroupItem
                  closeTab={shell.requestClose}
                  group={group}
                  {...(layout.sides.length === 1
                    ? { onChatBeside: split.onNewChatInSplit }
                    : {})}
                  hasKeyboard={hasKeyboard && isTabUp}
                  isShown={isTabUp}
                  onPageChrome={isTabUp ? setPageChrome : noop}
                  onPageHost={isTabUp ? setPageHost : noop}
                  up={tab}
                />
              </PaneTopContext>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The group's grounds: a strip darker than the toolbar under it, as a
 * browser's tab strip is (`group-strip`).
 */
export const GROUP_GROUNDS =
  "relative flex min-h-0 min-w-0 flex-1 [--group-strip:color-mix(in_oklab,var(--gray-200)_70%,var(--background))] dark:[--group-strip:color-mix(in_oklab,black_16%,var(--background))]";

/** A side's tabs, on the card's own ground, the tab up lifted off it. */
export const SIDE_TABS = "[--tab-selected:var(--card)]";
