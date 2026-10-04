import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import { type TabId } from "@/shared/tabs";
import { APP_NAME } from "@instrument-org/shared";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { freshTabId } from "@/client/lib/tab-actions";
import { reopenClosed } from "@/client/lib/tabs-model";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

import {
  appTabsAtom,
  groupOfHref,
  INBOX_HREF,
  isChatHref,
  isSiteHref,
  putAwaySitesAtom,
} from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import { ClosedTabsMenu } from "./closed-tabs-menu";
import { pageTabTitle } from "./file-tabs";
import { screenPresentation } from "./screen-presentation";
import { siteTabTitles } from "./site-tab-titles";
import { TabStrip } from "./tab-strip";
import { windowTabsAtom } from "./window-tabs";

/**
 * The window's tabs across its bar, each named for where it stands: a chat
 * by its title, a site by its page, a folder, a file, the apps or an app,
 * Discover. Dragged to reorder, closed by the middle button, the cross or a
 * right click, and the plus at the end opens a chat.
 */
export function AppTabStrip({
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
  chatTitles: Map<StoreId.Session, string>;
  childTitles: Map<TaskId, string>;
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
  const appsBySlug = useAppsBySlug();
  const { activeByGroup, tabs: groupTabs } = useAtomValue(windowTabsAtom);
  const [{ recentlyClosed }, setAppTabs] = useAtom(appTabsAtom);
  // A closed site's page is kept aside rather than among the group's tabs,
  // and is what its entry in the closed list is named by.
  const putAway = useAtomValue(putAwaySitesAtom);
  const [menu, setMenu] = useState<{ id: TabId; x: number; y: number }>();
  const menuStyle = useWindowPointStyle(menu ?? { x: 0, y: 0 });
  const idOf = (key: string) => tabs.find((tab) => tab.id === key)?.id;

  /** A site's tab is named for the page its group has up. */
  const presentationOf = (
    href: string,
  ): { icon: ReactNode; title: string; url?: string | undefined } => {
    if (isSiteHref(href)) {
      const group = groupOfHref(href);
      const open = groupTabs.filter((tab) => tab.group === group);
      const own = open.length > 0 ? open : (putAway[group ?? ""] ?? []);
      const up =
        own.find((tab) => tab.id === activeByGroup[group ?? ""]) ?? own[0];
      if (up?.kind === "page") {
        return {
          icon: <TabIcon favicon={up.favicon} url={up.url} />,
          title: up.title || pageTabTitle(up) || "Page",
          url: up.url,
        };
      }
    }
    if (isChatHref(href) && groupOfHref(href) === undefined) {
      return { icon: <ChatCircleIcon className="size-3.5" />, title: "Chats" };
    }
    return screenPresentation(href, {
      appsBySlug,
      chatTitles,
      taskTitles: childTitles,
    });
  };

  // The closed tabs that would come back as they were: a site's page is kept
  // only for this launch, and one closed before it would reopen on nothing.
  const reopenable = recentlyClosed.flatMap((tab, entry) => {
    const group = isSiteHref(tab.pathname)
      ? groupOfHref(tab.pathname)
      : undefined;
    return group !== undefined && !putAway[group] ? [] : [{ entry, tab }];
  });

  const whole = tabs.map((tab) => ({
    key: tab.id,
    ...presentationOf(tab.pathname || INBOX_HREF),
  }));
  // Tabs of one site say only what tells them apart, the site's part of
  // their titles left to the favicon beside each.
  const short = siteTabTitles(whole);
  const presented = whole.map(({ url: _url, ...tab }) => ({
    ...tab,
    title: short.get(tab.key) ?? tab.title,
  }));
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
            closed={reopenable.map(({ tab }) =>
              presentationOf(tab.pathname || INBOX_HREF),
            )}
            onReopen={(row) => {
              const entry = reopenable[row]?.entry;
              if (entry !== undefined) {
                setAppTabs((current) =>
                  reopenClosed(current, { entry, id: freshTabId() }),
                );
              }
            }}
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

/** A tab's own menu: reload and copy it, then close it or the tabs around it. */
function TabMenu({
  id,
  isLast,
  isOnly,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onDuplicate,
  reload,
}: {
  id: TabId;
  isLast: boolean;
  isOnly: boolean;
  onClose: (id: TabId) => void;
  onCloseOthers: (id: TabId) => void;
  onCloseToRight: (id: TabId) => void;
  onDuplicate: (id: TabId) => void;
  reload: (() => void) | undefined;
}) {
  return (
    <DropdownMenuContent align="start" className="min-w-52" sideOffset={0}>
      {reload && (
        <DropdownMenuItem onClick={reload}>
          <ArrowClockwiseIcon className="size-4" />
          <span>Reload</span>
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
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          onClose(id);
        }}
      >
        <XIcon className="size-4" />
        <span>Close Tab</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={isOnly}
        onClick={() => {
          onCloseOthers(id);
        }}
      >
        <XSquareIcon className="size-4" />
        <span>Close Other Tabs</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={isLast}
        onClick={() => {
          onCloseToRight(id);
        }}
      >
        <ArrowLineRightIcon className="size-4" />
        <span>Close Tabs to the Right</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
