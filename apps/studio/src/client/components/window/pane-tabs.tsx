import { type WindowTab } from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import { useTargetsAgentActivity } from "@/client/hooks/use-target-agent-activity";
import { getGuest } from "@/client/lib/browser-pool";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { type ReactNode, useContext, useState } from "react";

import { tabTooltip } from "./app-tab-strip";
import { useAppsBySlug } from "./apps-by-slug";
import { useComputerVolumes } from "./computer-volumes";
import { WindowContext } from "./context";
import { useFileTabTitles } from "./file-tab-titles";
import { screenPresentation, screenLocation } from "./screen-presentation";
import { siteTabTitles } from "./site-tab-titles";
import { tasksOfHref } from "./tab-location";
import { TabMenuAtPoint, TabMenuItems } from "./tab-menu-items";
import { NewTabButton, type StripTab, TabStrip } from "./tab-strip";

type Presentation = Parameters<typeof screenPresentation>[1];

function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

/** A tab as the strip orders it. */
function keyOf(tab: WindowTab): string {
  return tab.stripKey ?? tab.id;
}

/**
 * A chat's tabs, across the head of the pane beside it, the one place they
 * show: what its agent browses and the person opened, oldest at the left,
 * narrowing to icons when there are many and scrolling sideways past that.
 * They are the window's own strip, so they open, close, reorder and answer the keyboard as
 * the window's tabs do. The × at the row's far end puts the whole pane away and
 * keeps the tabs.
 */
export function PaneTabs({
  chatTitles,
  chosenId,
  isChatWorking,
  lead,
  onClose,
  onDuplicate,
  onNew,
  onReorder,
  onSelect,
  onTabDrag,
  onTabDragEnd,
  tabs,
  taskTitles,
  trailing,
}: {
  chatTitles: Presentation["chatTitles"];
  chosenId: string | undefined;
  /** Whether the chat or any task of it is at work: a page's working mark drops the moment none is. */
  isChatWorking: boolean;
  /** What stands ahead of the tabs: room for the traffic lights while the sidebar is closed. */
  lead?: ReactNode;
  onClose: (id: string) => void;
  /** A copy of the tab beside it in the pane: a page at its address, a screen at its own. */
  onDuplicate: (tab: WindowTab) => void;
  /** A new tab in the group. */
  onNew: () => void;
  /** The chat's tabs in a new order, by their strip keys, oldest first. */
  onReorder: (keys: string[]) => void;
  onSelect: (id: string) => void;
  /** Where a tab dragged out of the row is, by its id, for the sidebar to take it. */
  onTabDrag?: (id: string, event: PointerEvent) => void;
  onTabDragEnd?: (id: string, event: PointerEvent) => void;
  tabs: WindowTab[];
  taskTitles: Presentation["taskTitles"];
  /** What the row keeps at its right end: the chat's button while its column is closed. */
  trailing?: ReactNode;
}) {
  const appsBySlug = useAppsBySlug();
  const volumes = useComputerVolumes();
  const fileTitles = useFileTabTitles(
    tabs.map((tab) => (tab.kind === "page" ? undefined : tab.href)),
  );
  const driven = useTargetsAgentActivity(
    tabs.flatMap((tab) =>
      tab.kind === "page" ? [browserTargetOf(tab.id)] : [],
    ),
    isChatWorking,
  );
  const [menu, setMenu] = useState<{ key: string; x: number; y: number }>();
  const tabOf = (key: string) => tabs.find((tab) => keyOf(tab) === key);

  const whole = tabs.map((tab) => {
    const key = keyOf(tab);
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
  const presented = tabs.map((tab, index): StripTab => {
    const named = whole[index] ?? { key: keyOf(tab), title: "" };
    let tooltip: StripTab["tooltip"];
    if (tab.kind !== "page") {
      tooltip = tabTooltip(tab.href, named);
    } else if (named.url !== undefined) {
      tooltip = tabTooltip("", named);
    }
    return {
      icon:
        tab.kind === "page" ? (
          <PageFavicon
            className="size-3.5"
            favicon={tab.favicon}
            hasTooltip={false}
            url={tab.url ?? tab.openedUrl ?? ""}
          />
        ) : (
          <ScreenMark
            appsBySlug={appsBySlug}
            chatTitles={chatTitles}
            href={tab.href}
          />
        ),
      isWorking: tab.kind === "page" && driven.has(browserTargetOf(tab.id)),
      key: named.key,
      title: short.get(named.key) ?? named.title,
      ...(tooltip ? { tooltip } : {}),
    };
  });
  const chosen = tabs.find((tab) => tab.id === chosenId);
  const menuTab = menu ? tabOf(menu.key) : undefined;

  return (
    <div className="flex h-10 shrink-0 items-center pr-2 [-webkit-app-region:drag] [&_[role=tab]]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]">
      {lead}
      <TabStrip
        // The pane's own card is the ground a tab up stands on. The first tab
        // starts at the location row's 6px inset, over its back button.
        className="min-w-0 flex-1 pr-0 pl-1.5 [--tab-selected:var(--card)]"
        label="What this chat has open"
        newControl={<NewTabButton onClick={onNew} title="New tab" />}
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
        onReorder={onReorder}
        {...(onTabDrag
          ? {
              onTabDrag: (key: string, event: PointerEvent) => {
                const tab = tabOf(key);
                if (tab) {
                  onTabDrag(tab.id, event);
                }
              },
            }
          : {})}
        {...(onTabDragEnd
          ? {
              onTabDragEnd: (key: string, event: PointerEvent) => {
                const tab = tabOf(key);
                if (tab) {
                  onTabDragEnd(tab.id, event);
                }
              },
            }
          : {})}
        onSelect={(key) => {
          const tab = tabOf(key);
          if (tab) {
            onSelect(tab.id);
          }
        }}
        overflow="squeeze"
        selectedKey={chosen ? keyOf(chosen) : undefined}
        tabs={presented}
      />
      {trailing}
      <TabMenuAtPoint
        at={menu}
        onDismiss={() => {
          setMenu(undefined);
        }}
      >
        {menuTab && (
          <PaneTabMenu
            isChosen={menuTab.id === chosenId}
            onClose={onClose}
            onDuplicate={onDuplicate}
            tab={menuTab}
            tabs={tabs}
          />
        )}
      </TabMenuAtPoint>
    </div>
  );
}

/**
 * A pane tab's menu: the window's rows, with a copy of the tab opened
 * elsewhere in place of moving it, since the tab is its chat's.
 */
function PaneTabMenu({
  isChosen,
  onClose,
  onDuplicate,
  tab,
  tabs,
}: {
  isChosen: boolean;
  onClose: (id: string) => void;
  onDuplicate: (tab: WindowTab) => void;
  tab: WindowTab;
  tabs: WindowTab[];
}) {
  const windowContext = useContext(WindowContext);
  const pageUrl = tab.kind === "page" ? (tab.url ?? tab.openedUrl) : undefined;
  // Elsewhere, a copy: a page at its address, a screen at its own. A task
  // stands only in its chat, so it has no tab of the window's own.
  const openElsewhere = (where: "tab" | "window") => {
    if (!windowContext) {
      return;
    }
    const options = where === "tab" ? { newTab: true } : { newWindow: true };
    if (tab.kind === "page") {
      if (pageUrl !== undefined) {
        windowContext.openPage(pageUrl, options);
      }
    } else {
      windowContext.openScreen(tab.href, options);
    }
  };
  const canGoElsewhere =
    windowContext !== null && (tab.kind !== "page" || pageUrl !== undefined);
  const index = tabs.findIndex((each) => each.id === tab.id);
  return (
    <TabMenuItems
      components={dropdownMenuComponents}
      isSelected={isChosen}
      onClose={() => {
        onClose(tab.id);
      }}
      onCloseOthers={
        tabs.length > 1
          ? () => {
              for (const other of tabs) {
                if (other.id !== tab.id) {
                  onClose(other.id);
                }
              }
            }
          : undefined
      }
      onCloseToRight={
        index === tabs.length - 1
          ? undefined
          : () => {
              for (const later of tabs.slice(index + 1)) {
                onClose(later.id);
              }
            }
      }
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
      onOpenInNewWindow={
        canGoElsewhere
          ? () => {
              openElsewhere("window");
            }
          : undefined
      }
      onOpenInTabBar={
        canGoElsewhere &&
        (tab.kind === "page" || tasksOfHref(tab.href) === undefined)
          ? () => {
              openElsewhere("tab");
            }
          : undefined
      }
      onReload={
        tab.kind === "page"
          ? () => {
              getGuest(browserTargetOf(tab.id))?.reload();
            }
          : undefined
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
