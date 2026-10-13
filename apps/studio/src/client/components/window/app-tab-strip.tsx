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
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { XIcon } from "@phosphor-icons/react/X";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";

import { INBOX_HREF } from "./app-tabs";
import { useAppTabPresentation, useClosedAppTabs } from "./closed-app-tabs";
import { ClosedTabsMenu } from "./closed-tabs-menu";
import { siteTabTitles } from "./site-tab-titles";
import { TabStrip } from "./tab-strip";

/**
 * The window's tabs across its bar, each named for where it stands: a chat
 * by its title, a site by its page, a folder, a file, the apps or an app.
 * Dragged to reorder, closed by the middle button, the cross or a
 * right click, and the plus at the end opens a new tab.
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
  const { closed, reopen } = useClosedAppTabs({ chatTitles, childTitles });
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
        newMenu={<ClosedTabsMenu closed={closed} onReopen={reopen} />}
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

/**
 * A tab's own menu: reload and copy it, then close it or the tabs around it.
 * In developer mode, a screen's tab can also be shown without it.
 */
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
  const isDeveloperMode = useDeveloperMode();
  const [tabsWithout, setTabsWithout] = useAtom(tabsWithoutDeveloperModeAtom);

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
