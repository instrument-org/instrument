import {
  tabsWithoutDeveloperModeAtom,
  useDeveloperMode,
} from "@/client/hooks/use-developer-mode";
import { type TabId } from "@/shared/tabs";
import { APP_NAME } from "@instrument-org/shared";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { displayPath } from "@/client/lib/path-utils";
import { rpcClient } from "@/client/rpc/client";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { expandHomePath } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useState } from "react";

import { INBOX_HREF } from "./app-tabs";
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
import { useTabCarry } from "./use-tab-carry";
import { type StripTab, TabStrip } from "./tab-strip";
import { moveTabOut } from "./move-tab";
import { TabMenuAtPoint, TabMenuItems } from "./tab-menu-items";
import {
  measureCarryIndex,
  stripIndexAt,
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
  onNew,
  onReload,
  onReorder,
  onSelect,
  selectedId,
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
  onNew: () => void;
  /** The tab's own reload, for a site's page; undefined where a tab has none. */
  onReload: (id: TabId) => (() => void) | undefined;
  onReorder: (ids: TabId[]) => void;
  onSelect: (id: TabId) => void;
  selectedId: null | TabId;
  tabs: { id: TabId; pathname: string }[];
}) {
  const presentationOf = useAppTabPresentation({ chatTitles, childTitles });
  const { closed, firstIsReopenedByKey, reopen } = useClosedAppTabs({
    chatTitles,
    childTitles,
  });
  const [menu, setMenu] = useState<{ id: TabId; x: number; y: number }>();
  const idOf = (key: string) => tabs.find((tab) => tab.id === key)?.id;

  useTabCarryView();
  const carryView = useAtomValue(tabCarryViewAtom);
  const carryIndex = useAtomValue(tabCarryIndexAtom);
  // Measured from the strip as drawn, so the tab comes to rest where the
  // pointer is once it has joined the strip, moved or not.
  useLayoutEffect(() => {
    measureCarryIndex(carryView, tabs);
  }, [carryView, carryIndex, tabs]);
  const shownTabs = tabsInView(tabs, carryView, carryIndex);
  const incoming = carryView.kind === "incoming" ? carryView : undefined;
  const shownSelectedId = incoming ? incoming.tab.id : selectedId;
  const heldHere = carryView.kind === "reshaping" ? carryView.held : incoming;

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
  const selectedTitle = whole.find((tab) => tab.key === selectedId)?.title;
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
  });

  return (
    <div className="contents" data-app-tab-strip="">
      <TabStrip
        carriedKey={carry.carriedKey}
        className="min-w-0 flex-1"
        heldAt={
          heldHere
            ? {
                key: heldHere.tab.id,
                left: heldHere.clientX - heldHere.pointInTab,
              }
            : carry.held
        }
        isStill={carryView.kind === "reshaping"}
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
      <TabMenuAtPoint
        at={menu}
        onDismiss={() => {
          setMenu(undefined);
        }}
      >
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
            reload={onReload(menu.id)}
          />
        )}
      </TabMenuAtPoint>
    </div>
  );
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
  if (folder === null) {
    return undefined;
  }
  // A page named by its own title says its file's name after the folder.
  const name =
    screen.file === undefined ? undefined : segmentsOf(screen.file).at(-1);
  const crumbs = segmentsOf(displayPath(folder));
  return {
    detail: (name !== undefined && name !== title
      ? [...crumbs, name]
      : crumbs
    ).join(" › "),
    title,
  };
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
  reload: (() => void) | undefined;
}) {
  const others = useQuery(
    rpcClient.window.live.others.experimental_liveOptions(),
  ).data;
  const isDeveloperMode = useDeveloperMode();
  const [tabsWithout, setTabsWithout] = useAtom(tabsWithoutDeveloperModeAtom);

  return (
    <TabMenuItems
      components={dropdownMenuComponents}
      isSelected={isSelected}
      moving={
        others && others.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <AppWindowIcon className="size-4" />
              <span>Move Tab to Another Window</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {isOnly ? null : (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      void moveTabOut(id, { kind: "new" });
                    }}
                  >
                    <span>New Window</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {others.map((other) => (
                <DropdownMenuItem
                  key={other.id}
                  onClick={() => {
                    void moveTabOut(id, { id: other.id, kind: "window" });
                  }}
                >
                  <span className="truncate">{other.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : isOnly ? null : (
          <DropdownMenuItem
            onClick={() => {
              void moveTabOut(id, { kind: "new" });
            }}
          >
            <AppWindowIcon className="size-4" />
            <span>Move Tab to New Window</span>
          </DropdownMenuItem>
        )
      }
      onClose={() => {
        onClose(id);
      }}
      onCloseOthers={
        isOnly
          ? undefined
          : () => {
              onCloseOthers(id);
            }
      }
      onCloseToRight={
        isLast
          ? undefined
          : () => {
              onCloseToRight(id);
            }
      }
      onDuplicate={() => {
        onDuplicate(id);
      }}
      onReload={reload}
      own={
        // A site's page shows nothing developer mode adds, so only a
        // screen's tab offers it.
        isDeveloperMode && !reload ? (
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
        ) : null
      }
    />
  );
}
