import { type WindowTab } from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import { useTargetsAgentActivity } from "@/client/hooks/use-target-agent-activity";
import { getGuest } from "@/client/lib/browser-pool";
import { cn } from "@/client/lib/utils";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLineLeftIcon } from "@phosphor-icons/react/ArrowLineLeft";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ArrowsLeftRight";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/SquareSplitHorizontal";
import { StackIcon } from "@phosphor-icons/react/Stack";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { type ReactNode, useState } from "react";

import { tabTooltip } from "./app-tab-strip";
import { useAppsBySlug } from "./apps-by-slug";
import { useComputerVolumes } from "./computer-volumes";
import { useFileTabTitles } from "./file-tab-titles";
import { screenPresentation, screenLocation } from "./screen-presentation";
import { siteTabTitles } from "./site-tab-titles";
import { isHomeTab } from "./tab-model";
import { TabMenuAtPoint } from "./tab-menu-items";
import { NewTabButton, type StripTab, TabStrip } from "./tab-strip";

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
  isChatWorking,
  isIncoming = false,
  lead,
  onClose,
  onDuplicate,
  onNew,
  onReorder,
  onSelect,
  onTabDrag,
  onTabDragEnd,
  onTabDragStart,
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
  /** A tab in the pointer's hand, by its strip key, drawn with its left edge at this point. */
  heldAt?: { key: string; left: number } | undefined;
  /** The tab in hand is another window's, held over this strip. */
  isIncoming?: boolean;
  /** Whether the chat or any task of it is at work: a page's working mark drops the moment none is. */
  isChatWorking: boolean;
  /** What stands ahead of the tabs: room for the traffic lights while the sidebar is closed, and the chat's tab while the chat is the whole group. */
  lead?: ReactNode;
  onClose: (id: string) => void;
  /** A copy of the tab beside it in the pane: a page at its address, a screen at its own. */
  onDuplicate: (tab: WindowTab) => void;
  /** A new tab in the group. */
  onNew: () => void;
  /** The chat's tabs in a new order, by their strip keys, oldest first: none where the owner places a dragged tab itself. */
  onReorder?: (keys: string[]) => void;
  onSelect: (id: string) => void;
  /** A tab's drag, by its strip key, as `TabStrip` reports it. */
  onTabDrag?: (key: string, event: PointerEvent) => void;
  onTabDragEnd?: (key: string, event: PointerEvent) => void;
  onTabDragStart?: (key: string, event: PointerEvent, moved: number) => void;
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
  const driven = useTargetsAgentActivity(
    tabs.flatMap((tab) =>
      tab.kind === "page" ? [browserTargetOf(tab.id)] : [],
    ),
    isChatWorking,
  );
  const [menu, setMenu] = useState<{ key: string; x: number; y: number }>();
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
  const presented = tabs.map((tab, index): StripTab => {
    const named = whole[index] ?? { key: stripKeyOf(tab), title: "" };
    let tooltip: StripTab["tooltip"];
    if (tab.kind !== "page") {
      tooltip = tabTooltip(tab.href, named);
    } else if (named.url !== undefined) {
      tooltip = tabTooltip("", named);
    }
    let icon: ReactNode = null;
    if (tab.kind === "page") {
      icon = (
        <PageFavicon
          className="size-3.5"
          favicon={tab.favicon}
          hasTooltip={false}
          url={tab.url ?? tab.openedUrl ?? ""}
        />
      );
    } else if (!isHomeTab(tab)) {
      // A new tab is its name alone.
      icon = (
        <ScreenMark
          appsBySlug={appsBySlug}
          chatTitles={chatTitles}
          href={tab.href}
        />
      );
    }
    return {
      icon,
      isWorking: tab.kind === "page" && driven.has(browserTargetOf(tab.id)),
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
    >
      {lead}
      <TabStrip
        carriedKey={carriedKey}
        heldAt={heldAt}
        // The first tab starts at the location row's 6px inset, over its
        // back button.
        className="min-w-0 flex-1 pr-0 pl-1.5"
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
        {...(onReorder ? { onReorder } : {})}
        {...(onTabDrag ? { onTabDrag } : {})}
        {...(onTabDragEnd ? { onTabDragEnd } : {})}
        {...(onTabDragStart ? { onTabDragStart } : {})}
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
        onDismiss={() => {
          setMenu(undefined);
        }}
      >
        {menuTab && (
          <PaneTabMenu
            isChosen={menuTab.id === chosenId}
            onClose={onClose}
            onDuplicate={onDuplicate}
            {...(split ? { split } : {})}
            tab={menuTab}
            tabs={tabs}
          />
        )}
      </TabMenuAtPoint>
    </div>
  );
}

/** What a tab's menu does with the sides of its group, each for the tab it was raised on. */
export interface SplitMenuActions {
  /** Whether the group has a second side. */
  hasOtherSide: boolean;
  /** The tab to a new tab group of its own, up in the window. */
  onMoveToNewGroup: (tab: WindowTab) => void;
  /** The tab to a window of its own. */
  onMoveToNewWindow: (tab: WindowTab) => void;
  /** The tab to the other side, made where the group has one side. */
  onMoveToOtherSide: (tab: WindowTab) => void;
  /** A new chat on the other side, made where the group has one side. */
  onNewChatInSplit: (tab: WindowTab) => void;
  /** A copy of the tab on the other side, made where the group has one side. */
  onOpenInSplit: (tab: WindowTab) => void;
}

/**
 * A group tab's menu: the group's sides first (a copy on the other side,
 * the tab moved there, a new chat there, the tab to a group or a window of
 * its own), then the tab copied, and closing it or the tabs around it.
 * A page also reloads and copies its address.
 */
function PaneTabMenu({
  isChosen,
  onClose,
  onDuplicate,
  split,
  tab,
  tabs,
}: {
  isChosen: boolean;
  onClose: (id: string) => void;
  onDuplicate: (tab: WindowTab) => void;
  split?: SplitMenuActions;
  tab: WindowTab;
  tabs: WindowTab[];
}) {
  const { Item, Separator, Shortcut } = dropdownMenuComponents;
  const pageUrl = tab.kind === "page" ? (tab.url ?? tab.openedUrl) : undefined;
  const index = tabs.findIndex((each) => each.id === tab.id);
  const closeAll = (closing: readonly WindowTab[]) => {
    for (const each of closing) {
      onClose(each.id);
    }
  };
  // A side's only tab moved over would leave the side it was on empty and
  // the group one side again, standing where it was.
  const canMove = split !== undefined && (split.hasOtherSide || tabs.length > 1);
  return (
    <>
      {split && (
        <>
          <Item
            onClick={() => {
              split.onOpenInSplit(tab);
            }}
          >
            <SquareSplitHorizontalIcon className="size-4" />
            <span>Open in Split</span>
          </Item>
          {canMove && (
            <Item
              onClick={() => {
                split.onMoveToOtherSide(tab);
              }}
            >
              <ArrowsLeftRightIcon className="size-4" />
              <span>Move to Other Side</span>
            </Item>
          )}
          <Item
            onClick={() => {
              split.onNewChatInSplit(tab);
            }}
          >
            <ChatCircleIcon className="size-4" />
            <span>New Chat in Split</span>
          </Item>
          <Item
            onClick={() => {
              split.onMoveToNewGroup(tab);
            }}
          >
            <StackIcon className="size-4" />
            <span>Move to New Tab Group</span>
          </Item>
          <Item
            onClick={() => {
              split.onMoveToNewWindow(tab);
            }}
          >
            <AppWindowIcon className="size-4" />
            <span>Move to New Window</span>
          </Item>
          <Separator />
        </>
      )}
      {pageUrl !== undefined && (
        <>
          <Item
            onClick={() => {
              getGuest(browserTargetOf(tab.id))?.reload();
            }}
          >
            <ArrowClockwiseIcon className="size-4" />
            <span>Reload</span>
            {isChosen ? (
              <Shortcut>
                {formatAcceleratorText(WINDOW_SHORTCUTS.reloadPage.accelerator)}
              </Shortcut>
            ) : null}
          </Item>
          <Item
            onClick={() => {
              void navigator.clipboard.writeText(pageUrl);
            }}
          >
            <CopyIcon className="size-4" />
            <span>Copy URL</span>
          </Item>
        </>
      )}
      <Item
        onClick={() => {
          onDuplicate(tab);
        }}
      >
        <NewTabIcon className="size-4" />
        <span>Duplicate</span>
      </Item>
      <Separator />
      <Item
        onClick={() => {
          onClose(tab.id);
        }}
      >
        <XIcon className="size-4" />
        <span>Close</span>
        {isChosen ? (
          <Shortcut>
            {formatAcceleratorText(WINDOW_SHORTCUTS.closeTab.accelerator)}
          </Shortcut>
        ) : null}
      </Item>
      {tabs.length > 1 && (
        <Item
          onClick={() => {
            closeAll(tabs.filter((each) => each.id !== tab.id));
          }}
        >
          <XSquareIcon className="size-4" />
          <span>Close Other Tabs</span>
        </Item>
      )}
      {index > 0 && (
        <Item
          onClick={() => {
            closeAll(tabs.slice(0, index));
          }}
        >
          <ArrowLineLeftIcon className="size-4" />
          <span>Close Tabs to the Left</span>
        </Item>
      )}
      {index < tabs.length - 1 && (
        <Item
          onClick={() => {
            closeAll(tabs.slice(index + 1));
          }}
        >
          <ArrowLineRightIcon className="size-4" />
          <span>Close Tabs to the Right</span>
        </Item>
      )}
    </>
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
