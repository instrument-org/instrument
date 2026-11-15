import { type WindowTab } from "@/client/atoms/window";
import {
  addressOfTab,
  useAddBookmark,
  useBookmarkActions,
} from "@/client/bookmarks/actions";
import { PageFavicon } from "@/client/components/favicon";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import { draftsAtom } from "@/client/drafts/store";
import { useTargetsAgentActivity } from "@/client/hooks/use-target-agent-activity";
import { getGuest } from "@/client/lib/browser-pool";
import { cn } from "@/client/lib/utils";
import {
  browserTargetOf,
  parseBrowserTargetId,
} from "@instrument-org/workspace/client";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useRef, useState } from "react";

import { tabTooltip } from "./app-tab-strip";
import { useAppsBySlug } from "./apps-by-slug";
import {
  ChatTabItems,
  ChatTabRenameField,
  DraftTabItems,
} from "./chat-tab-menu";
import { chatListOptions } from "./chat-list-query";
import { chatDotOf, ChatMarkIcon } from "./chat-mark";
import { type Chat } from "./chats";
import { useComputerVolumes } from "./computer-volumes";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { useFileTabTitles } from "./file-tab-titles";
import { CaptureTabIcon, usePageCaptures } from "./page-capture-mark";
import { screenPresentation, screenLocation } from "./screen-presentation";
import { siteTabTitles } from "./site-tab-titles";
import { chatOfTab, draftOfTab } from "./tab-model";
import { TabMenuAtPoint, TabMenuItems } from "./tab-menu-items";
import { type StripTab, TabStrip } from "./tab-strip";
import { useBookmarkEdits } from "./web-start";
import { isOnEmptySpace, WindowSpaceMenu } from "./window-space-menu";

type Presentation = Parameters<typeof screenPresentation>[1];

function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

/** A tab as the strip orders it. */
export function stripKeyOf(tab: WindowTab): string {
  return tab.stripKey ?? tab.id;
}

/**
 * A tab group's tabs, across the head of the work's card: what its agent
 * browses and the person opened, oldest at the left, narrowing to icons when
 * there are many. They are the window's own strip, so they open, close,
 * reorder and answer the keyboard as the window's tabs do. The new tab
 * control follows them, and the row keeps what it is given at its right end.
 */
export function PaneTabs({
  carriedKey,
  side = 0,
  split,
  chatTitles,
  className,
  chosenId,
  heldAt,
  isIncoming = false,
  lead,
  onClose,
  onDuplicate,
  onNew,
  onSelect,
  newMenu,
  onTabPress,
  reopen,
  tabs,
  taskTitles,
  trailing,
}: {
  /** A tab being carried off the row, by its strip key, which gives its place up to the tabs beside it. */
  carriedKey?: string | undefined;
  chatTitles: Presentation["chatTitles"];
  chosenId: string | undefined;
  /** The row's ground and the room at its ends, as the card it heads draws them. */
  className?: string;
  /** A tab in the pointer's hand, by its strip key, drawn with its left edge `grabX` left of the pointer. */
  heldAt?: { grabX: number; key: string } | undefined;
  /** The tab in hand is another window's, held over this strip. */
  isIncoming?: boolean;
  /** What stands ahead of the tabs: room for the traffic lights while the sidebar is closed, and the chat's tab while the chat is the whole group. */
  lead?: ReactNode;
  onClose: (id: string) => void;
  /** A copy of the tab beside it in the pane: a page at its address, a screen at its own. */
  onDuplicate: (tab: WindowTab) => void;
  /** A new tab in the group. */
  onNew: () => void;
  onSelect: (id: string) => void;
  /** A press on a tab, by its strip key, which may become a drag. */
  onTabPress?: (key: string, event: React.PointerEvent<HTMLElement>) => void;
  /** What a right click on the plus offers: the tabs and groups closed lately (`RecentlyClosedMenu`). */
  newMenu?: ReactNode;
  /** The last thing the window closed back, as Shift+Cmd+T does; with it, the row's empty space has the window's menu. */
  reopen?: (() => void) | undefined;
  /** Which side of its group the strip heads, which a drag along it reads it by (`data-group-tabs`). */
  side?: 0 | 1;
  /** What a tab's menu does with the group's sides; none for a strip of no group's. */
  split?: SplitMenuActions;
  tabs: WindowTab[];
  taskTitles: Presentation["taskTitles"];
  /** What the row keeps at its right end: the room for the caption buttons off the Mac. */
  trailing?: ReactNode;
}) {
  const appsBySlug = useAppsBySlug();
  const volumes = useComputerVolumes();
  const fileTitles = useFileTabTitles(
    tabs.map((tab) => (tab.kind === "page" ? undefined : tab.href)),
  );
  const captures = usePageCaptures();
  const { data: chats } = useQuery(chatListOptions());
  const driven = useTargetsAgentActivity(
    // A bookmark held over the strip stands in as a page with no browser
    // view of its own, under an id that is no tab's.
    tabs.flatMap((tab) => {
      const target = tab.kind === "page" ? parseBrowserTargetId(tab.id) : null;
      return target ? [target] : [];
    }),
  );
  const [menu, setMenu] = useState<{ key: string; x: number; y: number }>();
  const [spaceMenu, setSpaceMenu] = useState<{ x: number; y: number }>();
  // What a row of the menu does once the menu has let go of the keyboard,
  // for a row that puts it somewhere of its own: a rename's field.
  const afterMenu = useRef<(() => void) | null>(null);
  // The chat tab being renamed in place, by its strip key.
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<{ chat: Chat; tabId: string }>();
  const tabOf = (key: string) => tabs.find((tab) => stripKeyOf(tab) === key);

  const whole = tabs.map((tab) => {
    const key = stripKeyOf(tab);
    if (tab.kind === "page") {
      const url = tab.url ?? tab.openedUrl;
      return { key, title: tab.title || hostOf(url ?? ""), url };
    }
    return {
      key,
      title: screenPresentation(tab.href, {
        appsBySlug,
        chatTitles,
        ...(fileTitles ? { fileTitles } : {}),
        taskTitles,
        ...(volumes ? { volumes } : {}),
      }).title,
    };
  });
  // Pages of one site say only what tells them apart, as the window's do.
  const short = siteTabTitles(whole);
  const drivenIds: ReadonlySet<string> = new Set(driven.keys());
  const presented = tabs.map((tab, index): StripTab => {
    const named = whole[index] ?? { key: stripKeyOf(tab), title: "" };
    let tooltip: StripTab["tooltip"];
    if (tab.kind !== "page") {
      tooltip = tabTooltip(tab.href, named);
    } else if (named.url !== undefined) {
      tooltip = tabTooltip("", named);
    }
    const chat = chatOfTab(tab);
    let icon: ReactNode = null;
    // A page using the microphone or camera wears that in place of its
    // favicon, so the tab in a call is the one to look for.
    const capture =
      tab.kind === "page"
        ? captures.find(
            ({ targetId, using }) =>
              (using.audio || using.video) &&
              targetId === browserTargetOf(tab.id),
          )
        : undefined;
    if (capture) {
      icon = <CaptureTabIcon paused={capture.paused} using={capture.using} />;
    } else if (tab.kind === "page") {
      icon = (
        <PageFavicon
          className="size-3.5"
          favicon={tab.favicon}
          hasTooltip={false}
          url={tab.url ?? tab.openedUrl ?? ""}
        />
      );
    } else {
      // A chat's tab wears its dot while it is not the tab up on this side.
      icon = (
        <ChatMarkIcon
          dot={
            chat === undefined || tab.id === chosenId
              ? undefined
              : chatDotOf(chats?.find((each) => each.id === chat))
          }
          icon={
            <ScreenMark
              appsBySlug={appsBySlug}
              chatTitles={chatTitles}
              href={tab.href}
            />
          }
        />
      );
    }
    return {
      ...(chat !== undefined && renaming === named.key
        ? {
            field: (
              <ChatTabRenameField
                chatId={chat}
                onDone={() => {
                  setRenaming(undefined);
                }}
              />
            ),
          }
        : {}),
      icon,
      isWorking: tab.kind === "page" && drivenIds.has(tab.id),
      key: named.key,
      title: short.get(named.key) ?? named.title,
      ...(tooltip ? { tooltip } : {}),
    };
  });
  const chosen = tabs.find((tab) => tab.id === chosenId);
  const menuTab = menu ? tabOf(menu.key) : undefined;

  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center pr-1.5 [-webkit-app-region:drag] [&_[role=tab]]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]",
        className,
      )}
      data-group-tabs={side}
      {...(isIncoming ? { "data-incoming": "" } : {})}
      onContextMenu={
        reopen &&
        ((event) => {
          if (!isOnEmptySpace(event)) {
            return;
          }
          event.preventDefault();
          setSpaceMenu({ x: event.clientX, y: event.clientY });
        })
      }
    >
      {lead}
      <TabStrip
        carriedKey={carriedKey}
        heldAt={heldAt}
        // The first tab starts at the location row's 6px inset, over its
        // back button.
        className="min-w-0 flex-1 pr-0 pl-1.5"
        {...(split ? { groupKey: split.group } : {})}
        label={
          split?.hasOtherSide
            ? side === 0
              ? "Left side tabs"
              : "Right side tabs"
            : "Tabs"
        }
        {...(newMenu ? { newMenu } : {})}
        onNew={onNew}
        onClose={(key) => {
          const tab = tabOf(key);
          if (tab) {
            onClose(tab.id);
          }
        }}
        onContextMenu={(key, event) => {
          event.preventDefault();
          setMenu({ key, x: event.clientX, y: event.clientY });
        }}
        {...(onTabPress ? { onTabPress } : {})}
        onSelect={(key) => {
          const tab = tabOf(key);
          if (tab) {
            onSelect(tab.id);
          }
        }}
        overflow="squeeze"
        selectedKey={chosen ? stripKeyOf(chosen) : undefined}
        tabs={presented}
      />
      {trailing}
      <TabMenuAtPoint
        at={menu}
        onCloseAutoFocus={(event) => {
          const next = afterMenu.current;
          if (next) {
            afterMenu.current = null;
            event.preventDefault();
            next();
          }
        }}
        onDismiss={() => {
          setMenu(undefined);
        }}
      >
        {menuTab && (
          <PaneTabMenu
            isChosen={menuTab.id === chosenId}
            onClose={onClose}
            onDelete={(chat) => {
              setDeleting({ chat, tabId: menuTab.id });
            }}
            onDuplicate={onDuplicate}
            onRename={() => {
              const key = stripKeyOf(menuTab);
              afterMenu.current = () => {
                setRenaming(key);
              };
            }}
            {...(split ? { split } : {})}
            tab={menuTab}
            tabs={tabs}
            title={whole[tabs.indexOf(menuTab)]?.title ?? ""}
          />
        )}
      </TabMenuAtPoint>
      {reopen && (
        <TabMenuAtPoint
          at={spaceMenu}
          onDismiss={() => {
            setSpaceMenu(undefined);
          }}
        >
          <WindowSpaceMenu kind="tab" onNew={onNew} onReopenLast={reopen} />
        </TabMenuAtPoint>
      )}
      {deleting && (
        <DeleteChatDialog
          chat={deleting.chat}
          onDeleted={() => {
            onClose(deleting.tabId);
          }}
          onOpenChange={(open) => {
            if (!open) {
              setDeleting(undefined);
            }
          }}
          open
        />
      )}
    </div>
  );
}

/** What a tab's menu does with the sides of its group, each for the tab it was raised on. */
export interface SplitMenuActions {
  /** Whether the group has a second side. */
  hasOtherSide: boolean;
  /** The group this strip is a side of. */
  group: string;
  /** The group's two sides made one; none for a group of one side. */
  onJoinSides: (() => void) | undefined;
  /** The tab to a new tab group of its own, up in the window; none for a group's only tab, which would make the same group again. */
  onMoveToNewGroup: ((tab: WindowTab) => void) | undefined;
  /** The tab to a window of its own; none for the window's only tab. */
  onMoveToNewWindow: ((tab: WindowTab) => void) | undefined;
  /** The tab to the other side, made where the group has one side. */
  onMoveToOtherSide: (tab: WindowTab) => void;
  /** The tab to another open window, by its id. */
  onMoveToWindow: (tab: WindowTab, windowId: string) => void;
  /** A new chat on the other side, made where the group has one side. */
  onNewChatInSplit: (tab: WindowTab) => void;
  /** A copy of the tab on the other side, made where the group has one side. */
  onOpenInSplit: (tab: WindowTab) => void;
}

/**
 * A group tab's menu (`TabMenuItems`): the tab moved to the other side, or a
 * copy of it opened there when it is the group's only tab and moving it
 * would leave nothing behind; then the rest of what places it, copies it
 * and closes it or the tabs around it. A chat's tab has the chat's own
 * items after those, and a new chat's tab with a draft has the draft's.
 */
function PaneTabMenu({
  isChosen,
  onClose,
  onDelete,
  onDuplicate,
  onRename,
  split,
  tab,
  tabs,
  title,
}: {
  isChosen: boolean;
  onClose: (id: string) => void;
  /** Asks before the chat a chat tab is on goes to the trash. */
  onDelete: (chat: Chat) => void;
  onDuplicate: (tab: WindowTab) => void;
  /** Renames the chat a chat tab is on, in the tab, once the menu is down. */
  onRename: () => void;
  split?: SplitMenuActions;
  tab: WindowTab;
  tabs: WindowTab[];
  /** What the tab is called, which a bookmark of it is named. */
  title: string;
}) {
  const bookmarks = useBookmarkActions();
  const addBookmark = useAddBookmark();
  const bookmarkEdits = useBookmarkEdits();
  const address = addressOfTab(tab);
  const kept =
    address === undefined ? undefined : bookmarks.bookmarkOf(address);
  const pageUrl = tab.kind === "page" ? (tab.url ?? tab.openedUrl) : undefined;
  const index = tabs.findIndex((each) => each.id === tab.id);
  const closing = (closed: readonly WindowTab[]) =>
    closed.length === 0
      ? undefined
      : () => {
          for (const each of closed) {
            onClose(each.id);
          }
        };
  // A side's only tab moved over would leave the side it was on empty and
  // the group one side again, standing where it was: a copy goes instead.
  const canMove =
    split !== undefined && (split.hasOtherSide || tabs.length > 1);
  const chat = chatOfTab(tab);
  const draftId = draftOfTab(tab);
  const draft = useAtomValue(draftsAtom).find((each) => each.id === draftId);
  const { onJoinSides, onMoveToNewGroup, onMoveToNewWindow, onMoveToWindow } =
    split ?? {};
  const otherWindows = useQuery(
    rpcClient.window.live.others.experimental_liveOptions(),
  ).data;
  return (
    <TabMenuItems
      bookmark={
        address === undefined
          ? undefined
          : {
              isKept: kept !== undefined,
              onToggle: () => {
                if (kept) {
                  bookmarkEdits.remove(kept);
                } else {
                  addBookmark({ title, url: address });
                }
              },
            }
      }
      components={dropdownMenuComponents}
      isSelected={isChosen}
      onClose={() => {
        onClose(tab.id);
      }}
      onCloseOthers={closing(tabs.filter((each) => each.id !== tab.id))}
      onCloseToLeft={closing(tabs.slice(0, Math.max(index, 0)))}
      onCloseToRight={closing(index === -1 ? [] : tabs.slice(index + 1))}
      onCopyUrl={
        pageUrl === undefined
          ? undefined
          : () => {
              void navigator.clipboard.writeText(pageUrl);
            }
      }
      onDuplicate={() => {
        onDuplicate(tab);
      }}
      onJoinSides={onJoinSides}
      onMoveToNewGroup={
        onMoveToNewGroup &&
        (() => {
          onMoveToNewGroup(tab);
        })
      }
      onMoveToNewWindow={
        onMoveToNewWindow &&
        (() => {
          onMoveToNewWindow(tab);
        })
      }
      moveToWindow={
        onMoveToWindow && otherWindows && otherWindows.length > 0
          ? {
              onMove: (windowId) => {
                onMoveToWindow(tab, windowId);
              },
              windows: otherWindows,
            }
          : undefined
      }
      onMoveToOtherSide={
        split && canMove
          ? () => {
              split.onMoveToOtherSide(tab);
            }
          : undefined
      }
      onNewChatInSplit={
        split &&
        (() => {
          split.onNewChatInSplit(tab);
        })
      }
      onOpenInSplit={
        split && !canMove
          ? () => {
              split.onOpenInSplit(tab);
            }
          : undefined
      }
      onReload={
        pageUrl === undefined
          ? undefined
          : () => {
              getGuest(browserTargetOf(tab.id))?.reload();
            }
      }
      own={
        chat !== undefined ? (
          <ChatTabItems
            chatId={chat}
            components={dropdownMenuComponents}
            group={split?.group}
            onArchived={() => {
              onClose(tab.id);
            }}
            onDelete={onDelete}
            onRename={onRename}
            tabId={tab.id}
          />
        ) : draft !== undefined ? (
          <DraftTabItems components={dropdownMenuComponents} draft={draft} />
        ) : undefined
      }
    />
  );
}

/** A screen's small mark: a file's type, a folder, or the screen's own icon. */
export function ScreenMark({
  appsBySlug,
  chatTitles,
  href,
}: {
  appsBySlug: Presentation["appsBySlug"];
  chatTitles: Presentation["chatTitles"];
  href: string;
}) {
  const location = screenLocation(href, { appsBySlug, chatTitles });
  if (location.kind === "file") {
    return <FileTypeIcon className="size-3.5" fileName={location.name} />;
  }
  if (location.kind === "folder") {
    return <FileSystemFolderGlyph className="h-3 w-auto" />;
  }
  return screenPresentation(href, { appsBySlug, chatTitles }).icon;
}
