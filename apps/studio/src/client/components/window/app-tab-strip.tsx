import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import {
  tabsWithoutDeveloperModeAtom,
  useDeveloperMode,
} from "@/client/hooks/use-developer-mode";
import { afterNextPaint } from "@/client/lib/tab-view-state";
import { type TabId } from "@/shared/tabs";
import { APP_NAME } from "@instrument-org/shared";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { displayPath } from "@/client/lib/path-utils";
import { rpcClient } from "@/client/rpc/client";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { expandHomePath } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { XIcon } from "@phosphor-icons/react/X";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { zoomAtom } from "@/client/atoms/zoom";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { getDefaultStore, useAtom, useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { appTabsAtom, INBOX_HREF } from "./app-tabs";
import { ChatMarkIcon } from "./chat-mark";
import { chatTabMark, type RailChatMark } from "./chats";
import { useAppTabPresentation, useClosedAppTabs } from "./closed-app-tabs";
import { ClosedTabsMenu } from "./closed-tabs-menu";
import { chatListOptions } from "./chat-list-query";
import { Peek } from "./chat-row";
import { RECENTS_ROOT } from "./computer-page";
import {
  folderOf,
  joinHostPath,
  parentFolderOf,
  segmentsOf,
} from "./host-path";
import { siteTabTitles } from "./site-tab-titles";
import { isOffRow, type PointerSample, recentPath } from "./tab-pull";
import { type StripTab, TabStrip } from "./tab-strip";
import {
  keepOnlyTab,
  letTabGo,
  stripIndexAt,
  type TabMoveDestination,
  type TabStanding,
} from "./move-tab";
import {
  isTabHeldHere,
  measureCarryIndex,
  showTabCarryView,
  tabCarryIndexAtom,
  tabCarryViewAtom,
  tabsInView,
  useTabCarryView,
} from "./tab-carry-view";
import { matchScreen } from "./window-href";

/**
 * The window's tabs across its bar, each named for where it stands: a chat
 * by its title, a site by its page, a folder, a file, the apps or an app.
 * Dragged to reorder, closed by the middle button, the cross or a
 * right click, and the plus at the end opens a new tab.
 */
export function AppTabStrip({
  chatMarks,
  chatTitles,
  childTitles,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onDuplicate,
  onMove,
  onNew,
  onReload,
  onReorder,
  onSelect,
  selectedId,
  standingOf,
  tabs,
}: {
  /** Each chat's mark, as the rail would wear it for that chat alone. */
  chatMarks: Map<ChatId, RailChatMark>;
  chatTitles: Map<ChatId, string>;
  childTitles: Map<StoreId.Session, string>;
  onClose: (id: TabId) => void;
  onCloseOthers: (id: TabId) => void;
  onCloseToRight: (id: TabId) => void;
  onDuplicate: (id: TabId) => void;
  onMove: (id: TabId, to: TabMoveDestination) => Promise<void>;
  onNew: () => void;
  /** The tab's own reload, for a site's page; undefined where a tab has none. */
  onReload: (id: TabId) => (() => void) | undefined;
  onReorder: (ids: TabId[]) => void;
  onSelect: (id: TabId) => void;
  selectedId: null | TabId;
  /** A tab as it stands now, as it would be handed to another window. */
  standingOf: (id: TabId) => TabStanding | undefined;
  tabs: { id: TabId; pathname: string }[];
}) {
  const presentationOf = useAppTabPresentation({ chatTitles, childTitles });
  const { closed, firstIsReopenedByKey, reopen } = useClosedAppTabs({
    chatTitles,
    childTitles,
  });
  const [menu, setMenu] = useState<{ id: TabId; x: number; y: number }>();
  const menuStyle = useWindowPointStyle(menu ?? { x: 0, y: 0 });
  const idOf = (key: string) => tabs.find((tab) => tab.id === key)?.id;

  useTabCarryView();
  const carryView = useAtomValue(tabCarryViewAtom);
  const carryIndex = useAtomValue(tabCarryIndexAtom);
  // Measured from the strip as drawn, so the tab comes to rest where the
  // pointer is once it has joined the strip, moved or not.
  useLayoutEffect(() => {
    measureCarryIndex(carryView);
  }, [carryView, carryIndex]);
  const shownTabs = tabsInView(tabs, carryView, carryIndex);
  const shownSelectedId = isTabHeldHere(carryView)
    ? carryView.heldId
    : selectedId;

  const whole = shownTabs.map((tab) => ({
    key: tab.id,
    ...presentationOf(tab.pathname || INBOX_HREF),
  }));
  // Tabs of one site say only what tells them apart, the site's part of
  // their titles left to the favicon beside each.
  const short = siteTabTitles(whole);
  const presented = whole.map(({ url: _url, ...tab }, index) => {
    const { dot, isWorking } = chatTabMark(
      shownTabs[index]?.pathname || INBOX_HREF,
      chatMarks,
      { isUp: tab.key === shownSelectedId },
    );
    const tooltip = tabTooltip(
      shownTabs[index]?.pathname || INBOX_HREF,
      whole[index],
    );
    return {
      ...tab,
      icon: <ChatMarkIcon dot={dot} icon={tab.icon} />,
      isWorking,
      title: short.get(tab.key) ?? tab.title,
      ...(tooltip ? { tooltip } : {}),
    };
  });
  // The window is called what its tab up is, alone, as a document window is:
  // the OS already names the app beside it in the Dock, the switcher and
  // Mission Control. Whole, since the window's title stands alone.
  const selectedTitle = whole.find((tab) => tab.key === shownSelectedId)?.title;
  useEffect(() => {
    document.title = selectedTitle ?? APP_NAME;
  }, [selectedTitle]);

  const reorderKeys = (keys: string[]) => {
    onReorder(
      keys.flatMap((key) => {
        const id = idOf(key);
        return id ? [id] : [];
      }),
    );
  };

  const carry = useTabCarry({
    isOnlyTab: tabs.length === 1,
    onCancel: (keys) => {
      reorderKeys(keys);
    },
    onPlace: (key, left) => {
      const id = idOf(key);
      if (id) {
        const others = tabs.filter((tab) => tab.id !== id);
        const at = stripIndexAt(left, others, id);
        if (tabs[at]?.id !== id) {
          reorderKeys(others.map((tab) => tab.id).toSpliced(at, 0, id));
        }
      }
    },
    onSelect: (key) => {
      const id = idOf(key);
      if (id) {
        onSelect(id);
      }
    },
    order: presented.map((tab) => tab.key),
    standingOf: (key) => {
      const id = idOf(key);
      return id ? standingOf(id) : undefined;
    },
  });

  return (
    <div className="contents" data-app-tab-strip="">
      <TabStrip
        carriedKey={carry.carriedKey}
        className="min-w-0 flex-1"
        groupKey={carryView.kind}
        heldAwayKey={
          isTabHeldHere(carryView) ? carryView.heldId : carry.canceledKey
        }
        onClose={(key) => {
          const id = idOf(key);
          if (id) {
            onClose(id);
          }
        }}
        onContextMenu={(key, event) => {
          event.preventDefault();
          const id = idOf(key);
          if (id) {
            setMenu({ id, x: event.clientX, y: event.clientY });
          }
        }}
        newMenu={
          <ClosedTabsMenu
            closed={closed}
            firstIsReopenedByKey={firstIsReopenedByKey}
            onReopen={reopen}
          />
        }
        onNew={onNew}
        onReorder={(keys) => {
          if (carry.followsReorder()) {
            reorderKeys(keys);
          }
        }}
        onSelect={(key) => {
          const id = idOf(key);
          if (id) {
            onSelect(id);
          }
        }}
        onTabDrag={carry.onDrag}
        onTabDragEnd={carry.onDragEnd}
        onTabDragStart={carry.onDragStart}
        selectedKey={shownSelectedId ?? undefined}
        tabs={presented}
      />
      {/* The menu a right click on a tab raises, anchored at the pointer:
          what a browser's tab menu offers, marks and all, the way the
          system's own menus draw them. */}
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(undefined);
          }
        }}
        open={menu !== undefined}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-0"
            style={menuStyle}
          />
        </DropdownMenuTrigger>
        {menu && (
          <TabMenu
            id={menu.id}
            isLast={tabs.at(-1)?.id === menu.id}
            isOnly={tabs.length === 1}
            isSelected={selectedId === menu.id}
            onClose={onClose}
            onCloseOthers={onCloseOthers}
            onCloseToRight={onCloseToRight}
            onDuplicate={onDuplicate}
            onMove={onMove}
            reload={onReload(menu.id)}
          />
        )}
      </DropdownMenu>
    </div>
  );
}

/** One drag of a tab, from its first movement to its release. */
interface TabDrag {
  canceled: boolean;
  /** Off its row, it leaves its strip for a window that follows the pointer. */
  collapsesOffRow: boolean;
  /** It has been off its row, so where it stands comes from the pointer (`onPlace`). */
  hasLeftRow: boolean;
  /** Its window went off with it: the pointer's place in the window no longer says where it is. */
  isHeldAway: boolean;
  /** Its neighbor came up in its place, since the tab went to another window. */
  isNeighborUp: boolean;
  isOffRow: boolean;
  key: string;
  orderAtStart: string[];
  path: PointerSample[];
  pointInTab: number;
  /** Its window goes with it, so it is off its row until main says otherwise. */
  staysOffRow: boolean;
  stopListening: () => void;
  /** Where a pointer event read the window as the drag started. */
  windowX: number;
}

/**
 * A tab's drag past what the strip's own reorder can see. The reorder goes on
 * holding the pointer, whose events keep arriving past the window's edge while
 * the button is down, and the main process, which sees every window, is told
 * from the first movement so a window is ready to go up. Pulled off the row, the
 * window goes with the tab and the rest stay put in the spare window beneath, or
 * the tab goes to the spare window where that would lose less. Back on the row
 * both undo. The strip keeps its order while the tab is off, and Escape gives
 * back the order and the tab from the start of the drag. The reorder's measures
 * date from the press and a strip since drawn differently, and one reorder it is
 * refused stops it until the order changes, so a tab back on its row is placed by
 * where its left edge is (`onPlace`).
 */
function useTabCarry({
  isOnlyTab,
  onCancel,
  onPlace,
  onSelect,
  order,
  standingOf,
}: {
  isOnlyTab: boolean;
  onCancel: (keys: string[]) => void;
  onPlace: (key: string, left: number) => void;
  onSelect: (key: string) => void;
  order: string[];
  standingOf: (key: string) => TabStanding | undefined;
}) {
  const zoom = useAtomValue(zoomAtom);
  const [carriedKey, setCarriedKey] = useState<string>();
  // Escape puts the window back at once, with the button yet to come up: the tab
  // stays where it stands until it does.
  const [canceledKey, setCanceledKey] = useState<string>();
  const dragging = useRef<TabDrag>(undefined);

  const showWhereItIs = (drag: TabDrag) => {
    const isGone = drag.isOffRow && drag.collapsesOffRow && !drag.canceled;
    setCarriedKey(isGone ? drag.key : undefined);
    if (isGone && !drag.isNeighborUp) {
      const at = drag.orderAtStart.indexOf(drag.key);
      const neighbor = drag.orderAtStart[at + 1] ?? drag.orderAtStart[at - 1];
      if (neighbor !== undefined) {
        drag.isNeighborUp = true;
        onSelect(neighbor);
      }
    } else if (!isGone && drag.isNeighborUp) {
      drag.isNeighborUp = false;
      onSelect(drag.key);
    }
  };

  const onDragStart = (key: string, event: PointerEvent) => {
    const pressed = document.querySelector(
      `[data-app-tab-strip] [data-tab-key="${key}"]`,
    );
    if (!pressed) {
      return;
    }
    const pointInTab = event.clientX - pressed.getBoundingClientRect().left;
    // A page runs in a process of its own, which takes a pointer that crosses
    // it, and the release with it, unless the press has been captured.
    pressed.setPointerCapture(event.pointerId);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      const drag = dragging.current;
      if (keyEvent.key === "Escape" && drag && !drag.canceled) {
        drag.canceled = true;
        showWhereItIs(drag);
        onCancel(drag.orderAtStart);
        setCanceledKey(drag.key);
        void rpcClient.window.endTabDrag.call({ canceled: true }).then(() => {
          showTabCarryView({ kind: "row" });
        });
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    const drag: TabDrag = {
      canceled: false,
      collapsesOffRow: false,
      hasLeftRow: isOnlyTab,
      isHeldAway: false,
      isNeighborUp: false,
      // A window's only tab has no row to be on: the window goes with it.
      isOffRow: isOnlyTab,
      key,
      orderAtStart: order,
      path: [],
      pointInTab,
      staysOffRow: false,
      stopListening: () => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
      },
      windowX: event.screenX - event.clientX,
    };
    dragging.current = drag;
    // The press selected the tab, which is what a tab's page has to show.
    void afterNextPaint().then(async () => {
      const moving = standingOf(key);
      const strip = document
        .querySelector("[data-app-tab-strip] [role=tablist]")
        ?.getBoundingClientRect();
      if (dragging.current !== drag || drag.canceled || !moving || !strip) {
        return;
      }
      const started = await rpcClient.window.startTabDrag.call({
        // In the window that goes with it, the tab stands first in the strip, so
        // the pointer holds it there at the same point of the tab it pressed.
        grab: { x: strip.left + pointInTab, y: event.clientY },
        isOffRow: drag.isOffRow,
        isOnlyTab,
        moving,
      });
      if (dragging.current === drag) {
        drag.collapsesOffRow = started.collapsesOffRow;
        drag.staysOffRow = started.staysOffRow;
        showWhereItIs(drag);
      }
    });
  };

  const onDrag = (key: string, event: PointerEvent) => {
    const drag = dragging.current;
    if (drag?.key !== key || drag.canceled) {
      return;
    }
    const isHeldAway = isTabHeldHere(getDefaultStore().get(tabCarryViewAtom));
    if (drag.isHeldAway !== isHeldAway) {
      drag.isHeldAway = isHeldAway;
      if (!isHeldAway) {
        // Main has put the window back on the row, which it alone can tell.
        drag.isOffRow = isOnlyTab;
        drag.path = [];
      }
    }
    drag.path = recentPath(drag.path, {
      at: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    });
    // Where the window goes with the tab, the pointer stays where it is on the
    // window, so a tab off its row is off it until main says otherwise.
    drag.isOffRow =
      isOnlyTab ||
      (drag.staysOffRow && drag.isOffRow) ||
      isOffRow({
        path: drag.path,
        // The whole bar, since main takes all of it for the strip: anywhere on
        // it the tab is back in its row.
        strip: { bottom: TOOLBAR_HEIGHT * zoom, top: 0 },
        wasOff: drag.isOffRow,
        windowWidth: window.innerWidth,
      });
    drag.hasLeftRow ||= drag.isOffRow;
    // An event still on its way as the window comes back reads it where it was.
    if (
      drag.hasLeftRow &&
      !drag.isOffRow &&
      Math.abs(event.screenX - event.clientX - drag.windowX) <= 1
    ) {
      onPlace(key, event.clientX - drag.pointInTab);
    }
    showWhereItIs(drag);
    void rpcClient.window.moveTabDrag.call({
      isOffRow: drag.isOffRow,
      x: event.screenX,
      y: event.screenY,
    });
  };

  const onDragEnd = (key: string, event: PointerEvent) => {
    const drag = dragging.current;
    if (drag?.key !== key) {
      return;
    }
    dragging.current = undefined;
    drag.stopListening();
    if (drag.canceled) {
      setCanceledKey(undefined);
      return;
    }
    const store = getDefaultStore();
    void rpcClient.window.endTabDrag
      .call({
        canceled: false,
        point: { x: event.screenX, y: event.screenY },
      })
      .then((end) => {
        if (end.kind === "keepsTab") {
          keepOnlyTab(key);
        } else if (end.kind === "takesStrip") {
          store.set(appTabsAtom, end.model);
        } else if (end.kind === "losesTab") {
          letTabGo(key);
        } else if (end.kind === "none" && drag.isNeighborUp) {
          onSelect(key);
        }
        // A window closing goes on showing what it shows until it has gone.
        if (end.kind !== "closes") {
          showTabCarryView({ kind: "row" });
        }
        setCarriedKey(undefined);
      });
  };

  const followsReorder = () => {
    const drag = dragging.current;
    return !drag || (!drag.hasLeftRow && !drag.canceled);
  };

  return {
    canceledKey,
    carriedKey,
    followsReorder,
    onDrag,
    onDragEnd,
    onDragStart,
  };
}

/**
 * What hovering a window tab says: its whole name over what the tab has no
 * room for. A page's address, a file's or folder's folder, a chat's latest
 * line. A tab that says all it has (Chats, Apps, Browser, a new tab) keeps
 * the bare name.
 */
export function tabTooltip(
  href: string,
  presentation: { title: string; url?: string | undefined } | undefined,
): StripTab["tooltip"] {
  if (!presentation) {
    return undefined;
  }
  const { title, url } = presentation;
  if (url !== undefined) {
    return { detail: url.replace(/^https?:\/\//, ""), title };
  }
  const screen = matchScreen(href);
  if (screen.kind === "chat") {
    return { detail: <ChatTabLine chat={screen.chat} />, title };
  }
  if (screen.kind !== "computer") {
    return undefined;
  }
  const home = window.api.homeDir;
  let folder: null | string;
  if (screen.file !== undefined) {
    folder = folderOf(expandHomePath(screen.file, home));
  } else if (screen.root === COMPUTER_ROOT || screen.root === RECENTS_ROOT) {
    // The computer and Recents are no folder, so they are in none.
    return undefined;
  } else {
    // The top of a disk is in no folder either.
    folder = parentFolderOf(
      expandHomePath(joinHostPath(screen.root, screen.path), home),
    );
  }
  return folder === null
    ? undefined
    : { detail: segmentsOf(displayPath(folder)).join(" › "), title };
}

/** A chat's latest line, as its row in the inbox says it. */
function ChatTabLine({ chat }: { chat: ChatId }) {
  const chats = useQuery(chatListOptions());
  const found = chats.data?.find((each) => each.id === chat);
  return found ? <Peek chat={found} /> : null;
}

/**
 * A tab's own menu: reload and copy it, then close it or the tabs around it.
 * In developer mode, a screen's tab can also be shown without it. The tab up
 * names the window's keys beside Reload and Close Tab, since those keys act
 * on it and on no other.
 */
function TabMenu({
  id,
  isLast,
  isOnly,
  isSelected,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onDuplicate,
  onMove,
  reload,
}: {
  id: TabId;
  isLast: boolean;
  isOnly: boolean;
  isSelected: boolean;
  onClose: (id: TabId) => void;
  onCloseOthers: (id: TabId) => void;
  onCloseToRight: (id: TabId) => void;
  onDuplicate: (id: TabId) => void;
  onMove: (id: TabId, to: TabMoveDestination) => void;
  reload: (() => void) | undefined;
}) {
  const others = useQuery(
    rpcClient.window.live.others.experimental_liveOptions(),
  ).data;
  const isDeveloperMode = useDeveloperMode();
  const [tabsWithout, setTabsWithout] = useAtom(tabsWithoutDeveloperModeAtom);

  return (
    <DropdownMenuContent align="start" className="min-w-52" sideOffset={0}>
      {reload && (
        <DropdownMenuItem onClick={reload}>
          <ArrowClockwiseIcon className="size-4" />
          <span>Reload</span>
          {isSelected ? (
            <DropdownMenuShortcut>
              {formatAcceleratorText(WINDOW_SHORTCUTS.reloadPage.accelerator)}
            </DropdownMenuShortcut>
          ) : null}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onClick={() => {
          onDuplicate(id);
        }}
      >
        <NewTabIcon className="size-4" />
        <span>Duplicate Tab</span>
      </DropdownMenuItem>
      {isOnly ? null : (
        <DropdownMenuItem
          onClick={() => {
            onMove(id, { kind: "new" });
          }}
        >
          <AppWindowIcon className="size-4" />
          <span>Move to New Window</span>
        </DropdownMenuItem>
      )}
      {others && others.length > 0 ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowSquareOutIcon className="size-4" />
            <span>Move to Window</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {others.map((other) => (
              <DropdownMenuItem
                key={other.id}
                onClick={() => {
                  onMove(id, { id: other.id, kind: "window" });
                }}
              >
                <span className="truncate">{other.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {/* A site's page shows nothing developer mode adds, so only a
          screen's tab offers it. */}
      {isDeveloperMode && !reload && (
        <DropdownMenuCheckboxItem
          checked={!tabsWithout.has(id)}
          className="text-dev-700 dark:text-dev-300"
          onCheckedChange={(checked) => {
            const next = new Set(tabsWithout);
            if (checked) next.delete(id);
            else next.add(id);
            setTabsWithout(next);
          }}
        >
          <WrenchIcon className="size-4 text-dev-700 dark:text-dev-300" />
          <span>Developer Mode in This Tab</span>
        </DropdownMenuCheckboxItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          onClose(id);
        }}
      >
        <XIcon className="size-4" />
        <span>Close Tab</span>
        {isSelected ? (
          <DropdownMenuShortcut>
            {formatAcceleratorText(WINDOW_SHORTCUTS.closeTab.accelerator)}
          </DropdownMenuShortcut>
        ) : null}
      </DropdownMenuItem>
      {isOnly ? null : (
        <DropdownMenuItem
          onClick={() => {
            onCloseOthers(id);
          }}
        >
          <XSquareIcon className="size-4" />
          <span>Close Other Tabs</span>
        </DropdownMenuItem>
      )}
      {isLast ? null : (
        <DropdownMenuItem
          onClick={() => {
            onCloseToRight(id);
          }}
        >
          <ArrowLineRightIcon className="size-4" />
          <span>Close Tabs to the Right</span>
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}
