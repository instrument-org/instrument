import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import {
  tabsWithoutDeveloperModeAtom,
  useDeveloperMode,
} from "@/client/hooks/use-developer-mode";
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
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { displayPath } from "@/client/lib/path-utils";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { expandHomePath } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { XIcon } from "@phosphor-icons/react/X";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";

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
import { type StripTab, TabStrip } from "./tab-strip";
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
  const menuStyle = useWindowPointStyle(menu ?? { x: 0, y: 0 });
  const idOf = (key: string) => tabs.find((tab) => tab.id === key)?.id;

  const whole = tabs.map((tab) => ({
    key: tab.id,
    ...presentationOf(tab.pathname || INBOX_HREF),
  }));
  // Tabs of one site say only what tells them apart, the site's part of
  // their titles left to the favicon beside each.
  const short = siteTabTitles(whole);
  const presented = whole.map(({ url: _url, ...tab }, index) => {
    const { dot, isWorking } = chatTabMark(
      tabs[index]?.pathname || INBOX_HREF,
      chatMarks,
      { isUp: tab.key === selectedId },
    );
    const tooltip = tabTooltip(
      tabs[index]?.pathname || INBOX_HREF,
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

  return (
    <>
      <TabStrip
        className="min-w-0 flex-1"
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
          onReorder(
            keys.flatMap((key) => {
              const id = idOf(key);
              return id ? [id] : [];
            }),
          );
        }}
        onSelect={(key) => {
          const id = idOf(key);
          if (id) {
            onSelect(id);
          }
        }}
        selectedKey={selectedId ?? undefined}
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
            reload={onReload(menu.id)}
          />
        )}
      </DropdownMenu>
    </>
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
