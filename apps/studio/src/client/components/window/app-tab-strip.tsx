import { windowTabsAtom } from "@/client/atoms/window";
import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import { type TabId } from "@/shared/tabs";
import { APP_NAME } from "@instrument-org/shared";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
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
import { TabStrip } from "./tab-strip";

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
  onNew,
  onReorder,
  onSelect,
  selectedId,
  tabs,
}: {
  chatTitles: Map<StoreId.Session, string>;
  childTitles: Map<TaskId, string>;
  onClose: (id: TabId) => void;
  onNew: () => void;
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
  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const idOf = (key: string) => tabs.find((tab) => tab.id === key)?.id;

  /** A site's tab is named for the page its group has up. */
  const presentationOf = (href: string): { icon: ReactNode; title: string } => {
    if (isSiteHref(href)) {
      const group = groupOfHref(href);
      const open = groupTabs.filter((tab) => tab.group === group);
      const own = open.length > 0 ? open : (putAway[group ?? ""] ?? []);
      const up =
        own.find((tab) => tab.id === activeByGroup?.[group ?? ""]) ?? own[0];
      if (up?.kind === "page") {
        return {
          icon: <TabIcon favicon={up.favicon} url={up.url} />,
          title: up.title || pageTabTitle(up) || "Page",
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

  const presented = tabs.map((tab) => ({
    key: tab.id,
    ...presentationOf(tab.pathname || INBOX_HREF),
  }));
  // The window is called what its tab up is, alone, as a document window is:
  // the OS already names the app beside it in the Dock, the switcher and
  // Mission Control.
  const selectedTitle = presented.find((tab) => tab.key === selectedId)?.title;
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
      {menu && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          role="menu"
          style={menuStyle}
        >
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              onClose(menu.id);
              setMenu(undefined);
            }}
            role="menuitem"
            type="button"
          >
            Close tab
          </button>
        </div>
      )}
    </>
  );
}
