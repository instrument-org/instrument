import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/window";
import {
  sideShareByGroupAtom,
  sidebarOpenAtom,
} from "@/client/atoms/tab-groups";
import { ResizeHandle } from "@/client/components/resize-handle";
import { CaptionRoom } from "@/client/components/window-controls";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { pageHoldingKeyboard } from "@/client/lib/browser-pool";
import { cn } from "@/client/lib/utils";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { type PageChromeSlots } from "./browser-tabs";
import { chatListOptions } from "./chat-list-query";
import { useWindow } from "./context";
import { heldFilesAtom, stripWithHeldFiles } from "./file-drops";
import { GroupItem } from "./group-item";
import { SidebarToggleRoom } from "./inbox-toggle";
import { usePageHost } from "./page-hosts";
import { PaneTabs, type SplitMenuActions } from "./pane-tabs";
import { useShell } from "./shell-context";
import { tabCarryViewAtom } from "./tab-carry-view";
import { useTabGroupActions } from "./tab-groups";
import {
  groupTabLandingAtom,
  incomingGroupTab,
  useGroupTabCarry,
  useGroupTabMoves,
} from "./tab-drag";
import { chatOfTab, type GroupLayout, type GroupSide } from "./tab-model";
import { useTabSurface } from "./tab-surface";
import { WINDOW_CARD, WINDOW_CARD_GAP } from "./window-frame";
import { newScreenId, useWindowTabs } from "./window-tabs";

/**
 * A side's narrowest, in layout px: room for a chat's composer and for the
 * toolbar's arrows, reload and an address worth reading. A group too narrow
 * for its sides at this scrolls sideways rather than squeezing either.
 */
export const SIDE_WIDTH_MIN = 440;

/** How near the middle, in layout px, a dragged gutter settles on it. */
const SIDE_SNAP_PX = 15;

/** The left side's share of a group of two sides that has none kept. */
const SIDE_SHARE_DEFAULT = 0.5;

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
  if (group === undefined) {
    return <div className="relative flex min-h-0 min-w-0 flex-1" />;
  }
  return (
    <div
      className={GROUP_GROUNDS}
      // The group draws its own cards, so the window's card stands back.
      {...(isActive ? { "data-own-cards": "" } : {})}
    >
      <GroupSides group={group} />
    </div>
  );
}

/** The sides of a group in their row, the gutter between, scrolling sideways below their narrowest. */
function GroupSides({ group }: { group: string }) {
  const windowTabs = useWindowTabs();
  const layout = windowTabs.layoutOf(group);
  const [shares, setShares] = useAtom(sideShareByGroupAtom);
  const [dragged, setDragged] = useState<number>();
  // The share a drag last reached, read as it ends: the handle keeps the
  // callbacks of the render the press began in, so `dragged` there is stale.
  const draggedNow = useRef<number>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isTwo = layout.sides.length === 2;
  const share = dragged ?? shares[group] ?? SIDE_SHARE_DEFAULT;

  // A page pressed on the other side takes the keyboard there: the guest
  // stands over its side rather than in it, so the side hears no press.
  const { focusSide } = windowTabs;
  const sidesNow = useRef(layout);
  useEffect(() => {
    sidesNow.current = layout;
  });
  useEffect(() => {
    const onFocus = () => {
      const target = pageHoldingKeyboard();
      if (target === null) {
        return;
      }
      const { focused, sides } = sidesNow.current;
      const at = sides.findIndex((side) =>
        side.tabs.some(
          (tab) => tab.kind === "page" && browserTargetOf(tab.id) === target,
        ),
      );
      if (at !== -1 && at !== focused) {
        focusSide(group, at === 1 ? 1 : 0);
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
    };
  }, [focusSide, group]);

  // The row's width, which the gutter stands along.
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setRowWidth(row.offsetWidth);
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, []);
  /** The room the two sides share past the gutter, in layout px, as last measured. */
  const room = Math.max(rowWidth - WINDOW_CARD_GAP, 0);
  /** The same room measured now, for a drag. */
  const roomNow = () =>
    (rowRef.current?.offsetWidth ?? rowWidth) - WINDOW_CARD_GAP;
  const shareOf = (width: number) => {
    const total = roomNow();
    if (total <= 0) {
      return SIDE_SHARE_DEFAULT;
    }
    const clamped = Math.min(
      Math.max(width, SIDE_WIDTH_MIN),
      Math.max(total - SIDE_WIDTH_MIN, SIDE_WIDTH_MIN),
    );
    return Math.abs(clamped - total / 2) <= SIDE_SNAP_PX
      ? SIDE_SHARE_DEFAULT
      : clamped / total;
  };
  const keepShare = (next: number) => {
    setShares((current) => {
      if (next === SIDE_SHARE_DEFAULT) {
        return Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== group),
        );
      }
      return { ...current, [group]: next };
    });
  };

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      style={
        {
          "--gutter-at": `${share * room}px`,
        } as CSSProperties // A custom property, which CSSProperties does not name.
      }
      // A page in a side is cut to what the row shows of it (`useBrowserSlot`).
      data-guest-clip=""
      ref={scrollerRef}
    >
      <div
        className="flex h-full"
        ref={rowRef}
        style={{
          minWidth: isTwo
            ? SIDE_WIDTH_MIN * 2 + WINDOW_CARD_GAP
            : SIDE_WIDTH_MIN,
        }}
      >
        {layout.sides.map((side, index) => {
          const at = index === 1 ? 1 : 0;
          const grow = isTwo ? (at === 0 ? share : 1 - share) : 1;
          return (
            <SideCard
              group={group}
              hasKeyboard={layout.focused === at}
              isFirst={at === 0}
              isLast={index === layout.sides.length - 1}
              key={at}
              layout={layout}
              side={side}
              sideIndex={at}
              style={{ flex: `${grow} 1 0px`, minWidth: SIDE_WIDTH_MIN }}
            />
          );
        })}
      </div>
      {isTwo && (
        // The gap between the cards is the gutter, standing over the row at
        // the left side's edge.
        <ResizeHandle
          anchor={() => {
            const row = rowRef.current;
            return row ? row.getBoundingClientRect().left : undefined;
          }}
          className="top-0 bottom-0 left-(--gutter-at)"
          getWidth={() => share * roomNow()}
          grows="right"
          label="Resize sides"
          max={Math.max(room - SIDE_WIDTH_MIN, SIDE_WIDTH_MIN)}
          min={SIDE_WIDTH_MIN}
          onReset={() => {
            setDragged(undefined);
            keepShare(SIDE_SHARE_DEFAULT);
          }}
          onResize={(width) => {
            draggedNow.current = shareOf(width);
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
          value={share * room}
        />
      )}
    </div>
  );
}

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
  layout,
  side,
  sideIndex,
  style,
}: {
  group: string;
  hasKeyboard: boolean;
  isFirst: boolean;
  isLast: boolean;
  layout: GroupLayout;
  side: GroupSide;
  sideIndex: 0 | 1;
  style: CSSProperties;
}) {
  const shell = useShell();
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const moves = useGroupTabMoves();
  const isSidebarOpen = useAtomValue(sidebarOpenAtom);
  const isActive = useIsActiveTab();
  const { tabs } = side;
  const up = tabs.find((tab) => tab.id === side.up);
  const carry = useGroupTabCarry({ group, side: sideIndex, tabs });
  // Another window's tab held over the strip stands among its tabs at the
  // pointer, on the first side, which takes it.
  const incoming = incomingGroupTab(
    useAtomValue(tabCarryViewAtom),
    useAtomValue(groupTabLandingAtom),
    windowTabs.allTabs,
  );
  const landsHere = isFirst ? incoming : undefined;
  // Files dragged in and held over the strip, or over a new tab, stand
  // where they would land.
  const withFiles = stripWithHeldFiles(
    group,
    tabs,
    useAtomValue(heldFilesAtom),
  );
  const stripTabs = landsHere
    ? tabs
        .filter((tab) => tab.id !== landsHere.tab.id)
        .toSpliced(landsHere.index, 0, landsHere.tab)
    : (withFiles?.tabs ?? tabs);

  // Whether the chat any of the group's tabs is on, or a task of it, works.
  const chats = layout.sides.flatMap((each) =>
    each.tabs.flatMap((tab) => {
      const chat = chatOfTab(tab);
      return chat === undefined ? [] : [chat];
    }),
  );
  const { data: isChatWorking = false } = useQuery({
    ...chatListOptions(),
    select: (list) =>
      list.some((chat) => chats.includes(chat.id) && chat.working),
  });

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
    !hasKeyboard && isPage && up
      ? {
          chrome: pageChrome ?? false,
          into: pageHost,
          isActive,
          place: `${group}:${sideIndex}:${String(style.flex)}`,
          tabId: up.id,
        }
      : undefined,
  );

  const otherSide: 0 | 1 = sideIndex === 0 ? 1 : 0;
  /** A copy of a tab, a page at its address or a screen at its own, placed in the group. */
  const copyOf = (
    tab: WindowTab,
    placing: { after?: string; side: 0 | 1 | "same" },
  ) => {
    if (tab.kind === "page") {
      const url = tab.url ?? tab.openedUrl;
      if (url !== undefined) {
        appWindow.browser?.open(url, {
          group,
          ...placing,
        });
      }
      return;
    }
    windowTabs.openScreen(tab.href, {
      ...(placing.after === undefined ? {} : { after: placing.after }),
      group,
      select: true,
      side: placing.side,
    });
  };
  const split: SplitMenuActions = {
    hasOtherSide: layout.sides.length === 2,
    onMoveToNewGroup: (tab) => {
      groups.make({ moving: tab.id });
    },
    onMoveToNewWindow: (tab) => {
      moves.toNewWindow(tab.id);
    },
    onMoveToOtherSide: (tab) => {
      windowTabs.moveTo({ group, id: tab.id, select: true, side: otherSide });
    },
    onNewChatInSplit: () => {
      windowTabs.openIn(
        { group, href: NEW_TAB_HREF, id: newScreenId(), kind: "screen" },
        { group, select: true, side: "other", ...(up ? { after: up.id } : {}) },
      );
    },
    onOpenInSplit: (tab) => {
      copyOf(tab, { side: otherSide });
    },
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col",
        WINDOW_CARD,
        !isLast && "mr-2",
      )}
      data-group-side={sideIndex}
      {...(hasKeyboard ? { "data-keyboard": "" } : {})}
      onPointerDownCapture={() => {
        if (!hasKeyboard) {
          windowTabs.focusSide(group, sideIndex);
        }
      }}
      style={style}
    >
      <PaneTabs
        carriedKey={carry.carriedKey}
        chatTitles={shell.chatTitles}
        chosenId={
          landsHere ? landsHere.tab.id : (withFiles?.chosenId ?? up?.id)
        }
        className={SIDE_TABS}
        heldAt={
          landsHere ? landsHere.heldAt : (withFiles?.heldAt ?? carry.held)
        }
        isChatWorking={isChatWorking}
        isIncoming={landsHere !== undefined}
        lead={isFirst && !isSidebarOpen ? <SidebarToggleRoom /> : undefined}
        onClose={shell.requestClose}
        onDuplicate={(tab) => {
          copyOf(tab, { after: tab.id, side: "same" });
        }}
        onNew={() => {
          windowTabs.openScreen(NEW_TAB_HREF, {
            ...(up ? { after: up.id } : {}),
            group,
            select: true,
            ...(up ? {} : { side: sideIndex }),
          });
        }}
        onSelect={(id) => {
          windowTabs.select(id);
        }}
        onTabDrag={carry.onDrag}
        onTabDragEnd={carry.onDragEnd}
        onTabDragStart={carry.onDragStart}
        side={sideIndex}
        split={split}
        tabs={stripTabs}
        taskTitles={shell.childTitles}
        trailing={isLast ? <CaptionRoom /> : undefined}
      />
      <div className="relative min-h-0 flex-1">
        {up && (
          <GroupItem
            closeTab={shell.requestClose}
            group={group}
            hasKeyboard={hasKeyboard}
            isChatWorking={isChatWorking}
            isShown
            key={up.id}
            onPageChrome={setPageChrome}
            onPageHost={setPageHost}
            up={up}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The group's grounds: a strip darker than the toolbar under it, as a
 * browser's tab strip is (`group-strip`).
 */
const GROUP_GROUNDS =
  "relative flex min-h-0 min-w-0 flex-1 [--group-strip:color-mix(in_oklab,var(--gray-200)_70%,var(--background))] dark:[--group-strip:color-mix(in_oklab,black_16%,var(--background))]";

/** A side's tabs, on the card's own ground, the tab up lifted off it. */
const SIDE_TABS = "[--tab-selected:var(--card)]";
