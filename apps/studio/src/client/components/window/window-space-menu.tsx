import { toast } from "@/client/lib/toast";
import { type WindowTab } from "@/client/atoms/window";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { rpcClient } from "@/client/rpc/client";
import { type TabId } from "@/shared/tabs";
import {
  WINDOW_MENU_SHORTCUTS,
  WINDOW_SHORTCUTS,
} from "@/shared/window-shortcuts";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowUUpLeftIcon } from "@phosphor-icons/react/ArrowUUpLeft";
import { ArrowsMergeIcon } from "@phosphor-icons/react/ArrowsMerge";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { RectangleIcon } from "@phosphor-icons/react/Rectangle";
import { StackIcon } from "@phosphor-icons/react/Stack";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { appTabsAtom } from "./app-tabs";
import { closedTabsOf } from "./tab-model";

/** One thing on the window's closed list: a tab, or a whole tab group by its first tab. */
interface ClosedEntry {
  id: TabId;
  /** The tab it is named and marked by. */
  tab: WindowTab;
  /** How many tabs it brings back: one for a tab, every tab for a group. */
  tabCount: number;
}

/**
 * What this window closed lately that would come back, newest first: each
 * tab closed out of a group, and each group closed whole. A blank new tab is
 * never on the list (`requestClose`).
 */
export function useRecentlyClosed(): ClosedEntry[] {
  const { recentlyClosed } = useAtomValue(appTabsAtom);
  return recentlyClosed.flatMap((entry) => {
    const tabs = closedTabsOf(entry);
    const [first] = tabs;
    return first ? [{ id: entry.id, tab: first, tabCount: tabs.length }] : [];
  });
}

/**
 * What a right click on the window's empty space offers, as a browser's tab
 * bar does: something new to open (a tab in a side's strip, a tab group in
 * the sidebar), the last thing closed, what a side's strip does with the
 * group's sides, a new window, and the other windows' groups brought into
 * this one. Drawn with the dropdown's parts, for `TabMenuAtPoint`.
 */
export function WindowSpaceMenu({
  kind,
  onNew,
  onReopenLast,
  sides,
}: {
  /** Whether the space is a side's strip, whose new thing is a tab, or the sidebar, whose is a tab group. */
  kind: "group" | "tab";
  onNew: () => void;
  onReopenLast: () => void;
  /** What a side's strip does with its group's sides, as its tabs' menus do; a row is left out where its action is. */
  sides?:
    | {
        /** The side the strip heads has the keyboard, so the chords are its. */
        hasKeyboard: boolean;
        onCloseSplit: (() => void) | undefined;
        onJoinSides: (() => void) | undefined;
        onNewTabInSplit: () => void;
      }
    | undefined;
}) {
  const hasClosedTab = useRecentlyClosed().length > 0;
  const others = useQuery(
    rpcClient.window.live.others.experimental_liveOptions(),
  ).data;
  // Read as the menu opens, since it is mounted only while up.
  const hasClosedWindow = useQuery({
    ...rpcClient.window.canReopenClosed.queryOptions(),
    staleTime: 0,
  }).data;
  const { Item, Separator, Shortcut } = dropdownMenuComponents;
  const newShortcut =
    kind === "tab" ? WINDOW_SHORTCUTS.newTab : WINDOW_SHORTCUTS.newChat;
  return (
    <>
      <Item onClick={onNew}>
        {kind === "tab" ? (
          <NewTabIcon className="size-4" />
        ) : (
          <StackIcon className="size-4" />
        )}
        <span>{newShortcut.label}</span>
        <Shortcut>{formatAcceleratorText(newShortcut.accelerator)}</Shortcut>
      </Item>
      <Item
        disabled={!hasClosedTab && hasClosedWindow !== true}
        onClick={onReopenLast}
      >
        <ArrowUUpLeftIcon className="size-4" />
        <span>{WINDOW_SHORTCUTS.reopenTab.label}</span>
        <Shortcut>
          {formatAcceleratorText(WINDOW_SHORTCUTS.reopenTab.accelerator)}
        </Shortcut>
      </Item>
      {sides && (
        <>
          <Separator />
          <Item onClick={sides.onNewTabInSplit}>
            <PlusIcon className="size-4" />
            <span>{WINDOW_SHORTCUTS.newTabInSplit.label}</span>
            {sides.hasKeyboard ? (
              <Shortcut>
                {formatAcceleratorText(
                  WINDOW_SHORTCUTS.newTabInSplit.accelerator,
                )}
              </Shortcut>
            ) : null}
          </Item>
          {sides.onJoinSides && (
            <Item onClick={sides.onJoinSides}>
              <RectangleIcon className="size-4" />
              <span>Join Sides</span>
            </Item>
          )}
          {sides.onCloseSplit && (
            <Item onClick={sides.onCloseSplit}>
              <XIcon className="size-4" />
              <span>{WINDOW_SHORTCUTS.closeSplit.label}</span>
              {sides.hasKeyboard ? (
                <Shortcut>
                  {formatAcceleratorText(
                    WINDOW_SHORTCUTS.closeSplit.accelerator,
                  )}
                </Shortcut>
              ) : null}
            </Item>
          )}
        </>
      )}
      <Separator />
      <Item
        onClick={() => {
          void rpcClient.window.openNew.call().catch((error: unknown) => {
            toast.error("Couldn't open a new window", { cause: error });
          });
        }}
      >
        <AppWindowIcon className="size-4" />
        <span>{WINDOW_MENU_SHORTCUTS.newWindow.label}</span>
        <Shortcut>
          {formatAcceleratorText(WINDOW_MENU_SHORTCUTS.newWindow.accelerator)}
        </Shortcut>
      </Item>
      {others && others.length > 0 ? (
        <Item
          onClick={() => {
            void rpcClient.window.mergeAll.call().catch((error: unknown) => {
              toast.error("Couldn't merge the windows", { cause: error });
            });
          }}
        >
          <ArrowsMergeIcon className="size-4" />
          <span>Merge All Windows</span>
        </Item>
      ) : null}
    </>
  );
}

/**
 * Whether a right click landed on the empty space itself rather than on
 * something with a menu or an action of its own, which answered it first.
 */
export function isOnEmptySpace(event: React.MouseEvent): boolean {
  return !(
    event.defaultPrevented ||
    (event.target instanceof Element &&
      event.target.closest(
        "button, a, input, textarea, [role=tab], [role=button], [contenteditable=true]",
      ))
  );
}
