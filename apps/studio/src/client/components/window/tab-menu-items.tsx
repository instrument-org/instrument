import { JoinSidesIcon } from "@/client/components/icons/join-sides-icon";
import { TabGroupIcon } from "@/client/components/icons/tab-group-icon";
import { DuplicateIcon } from "@/client/components/icons/duplicate-icon";
import { useOpeningReleaseGuard } from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { type MenuComponents } from "@/client/components/ui/menu-components";
import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowLineLeftIcon } from "@phosphor-icons/react/ArrowLineLeft";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ArrowsLeftRight";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/SquareSplitHorizontal";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { type ReactNode } from "react";

import { type TabAction } from "./tab-actions";
import { MOVE_TO_NEW_TAB_GROUP } from "@instrument-org/workspace/client";

/**
 * The menu a right click on a tab raises, anchored at the pointer, in the
 * window's strip and a chat's pane alike: what a browser's tab menu offers,
 * the way the system's own menus draw it. Its rows are `TabMenuItems`, drawn
 * with `dropdownMenuComponents`, and the right-click's own release picks none
 * of them, as a context menu's does not.
 */
export function TabMenuAtPoint({
  at,
  children,
  onCloseAutoFocus,
  onDismiss,
}: {
  /** Where the right click was, on screen; nothing while the menu is down. */
  at: { x: number; y: number } | undefined;
  children: ReactNode;
  /** The menu handing the keyboard back as it closes, which a row that puts it somewhere of its own (a rename's field) stops. */
  onCloseAutoFocus?: (event: Event) => void;
  onDismiss: () => void;
}) {
  const style = useWindowPointStyle(at ?? { x: 0, y: 0 });
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      open={at !== undefined}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={style}
        />
      </DropdownMenuTrigger>
      {at && (
        <TabMenuContent {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}>
          {children}
        </TabMenuContent>
      )}
    </DropdownMenu>
  );
}

/** The menu's panel, mounted as it opens, which is when its guard starts. */
function TabMenuContent({
  children,
  onCloseAutoFocus,
}: {
  children: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const releaseGuard = useOpeningReleaseGuard();
  return (
    <DropdownMenuContent
      align="start"
      className="min-w-52"
      {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      sideOffset={0}
      {...releaseGuard}
    >
      {children}
    </DropdownMenuContent>
  );
}

/**
 * What a tab's menu offers, in every place a tab is drawn, in one order:
 * the tab's place among the group's sides and the window's groups (moved to
 * the other side, or a copy opened there where nothing would be left to
 * move; a new tab there; the two sides joined; the tab to a group or a
 * window of its own), then
 * the tab copied and what it offers for its address (`useTabActionsFor`:
 * kept as a bookmark, reloaded, its address copied), then closing it, the
 * tabs around it or its whole side,
 * and last what only this tab has, such as a chat's own items, under a
 * divider. Drawn with whichever menu's parts it is raised in, since a
 * menu's items only work in their own menu. A row is left out where its
 * action is.
 */
export function TabMenuItems({
  actions,
  components: { Item, Separator, Shortcut, Sub, SubContent, SubTrigger },
  isSelected,
  moveToWindow,
  onClose,
  onCloseOthers,
  onCloseSplit,
  onCloseToLeft,
  onCloseToRight,
  onDuplicate,
  onJoinSides,
  onMoveToNewGroup,
  onMoveToNewWindow,
  onMoveToOtherSide,
  onNewChatInSplit,
  onOpenInSplit,
  own,
}: {
  /** What the tab offers for its address (`useTabActionsFor`). */
  actions: TabAction[];
  components: MenuComponents;
  /** The tab up on the side with the keyboard, whose chords the rows show. */
  isSelected: boolean;
  /** The other open windows the tab can move to, each by its title; none while this is the only window. */
  moveToWindow?:
    | {
        onMove: (windowId: string) => void;
        windows: readonly { id: string; title: string }[];
      }
    | undefined;
  onClose: () => void;
  onCloseOthers: (() => void) | undefined;
  /** The whole side the tab is on closed; none for a group of one side. */
  onCloseSplit?: (() => void) | undefined;
  onCloseToLeft: (() => void) | undefined;
  onCloseToRight: (() => void) | undefined;
  onDuplicate: () => void;
  /** The group's two sides made one; none for a group of one side. */
  onJoinSides: (() => void) | undefined;
  onMoveToNewGroup: (() => void) | undefined;
  onMoveToNewWindow: (() => void) | undefined;
  /** The tab across to the other side, made where the group has one side. */
  onMoveToOtherSide: (() => void) | undefined;
  onNewChatInSplit: (() => void) | undefined;
  /** A copy of the tab on the other side, for a tab with nothing beside it to leave behind. */
  onOpenInSplit: (() => void) | undefined;
  /** What only this tab has, after the rest under a divider: a chat's own items. */
  own?: ReactNode;
}) {
  const placing =
    onMoveToOtherSide ??
    onJoinSides ??
    onOpenInSplit ??
    onNewChatInSplit ??
    onMoveToNewGroup ??
    onMoveToNewWindow ??
    moveToWindow;
  return (
    <>
      {onMoveToOtherSide ? (
        <Item onClick={onMoveToOtherSide}>
          <ArrowsLeftRightIcon className="size-4" />
          <span>Move to Other Side</span>
        </Item>
      ) : onOpenInSplit ? (
        <Item onClick={onOpenInSplit}>
          <SquareSplitHorizontalIcon className="size-4" />
          <span>Open in Split</span>
        </Item>
      ) : null}
      {onNewChatInSplit && (
        <Item onClick={onNewChatInSplit}>
          <PlusIcon className="size-4" />
          <span>New Tab in Split</span>
          {isSelected ? (
            <Shortcut>
              {formatAcceleratorText(
                WINDOW_SHORTCUTS.newTabInSplit.accelerator,
              )}
            </Shortcut>
          ) : null}
        </Item>
      )}
      {onJoinSides && (
        <Item onClick={onJoinSides}>
          <JoinSidesIcon className="size-4" />
          <span>Join Sides</span>
        </Item>
      )}
      {onMoveToNewGroup && (
        <Item onClick={onMoveToNewGroup}>
          <TabGroupIcon className="size-4" />
          <span>{MOVE_TO_NEW_TAB_GROUP}</span>
        </Item>
      )}
      {moveToWindow ? (
        <Sub>
          <SubTrigger>
            <AppWindowIcon className="size-4" />
            <span>Move to Another Window</span>
          </SubTrigger>
          <SubContent>
            {onMoveToNewWindow && (
              <>
                <Item onClick={onMoveToNewWindow}>
                  <span>New Window</span>
                </Item>
                <Separator />
              </>
            )}
            {moveToWindow.windows.map((other) => (
              <Item
                key={other.id}
                onClick={() => {
                  moveToWindow.onMove(other.id);
                }}
              >
                <span className="truncate">{other.title}</span>
              </Item>
            ))}
          </SubContent>
        </Sub>
      ) : onMoveToNewWindow ? (
        <Item onClick={onMoveToNewWindow}>
          <AppWindowIcon className="size-4" />
          <span>Move to New Window</span>
        </Item>
      ) : null}
      {placing && <Separator />}
      <Item onClick={onDuplicate}>
        <DuplicateIcon className="size-4" />
        <span>Duplicate</span>
      </Item>
      {actions.map((action) => (
        <Item key={action.id} onClick={action.run}>
          {action.icon}
          <span>{action.label}</span>
          {isSelected && action.chord !== undefined ? (
            <Shortcut>{formatAcceleratorText(action.chord)}</Shortcut>
          ) : null}
        </Item>
      ))}
      <Separator />
      <Item onClick={onClose}>
        <XIcon className="size-4" />
        <span>Close</span>
        {isSelected ? (
          <Shortcut>
            {formatAcceleratorText(WINDOW_SHORTCUTS.closeTab.accelerator)}
          </Shortcut>
        ) : null}
      </Item>
      {onCloseOthers && (
        <Item onClick={onCloseOthers}>
          <XSquareIcon className="size-4" />
          <span>Close Other Tabs</span>
        </Item>
      )}
      {onCloseToLeft && (
        <Item onClick={onCloseToLeft}>
          <ArrowLineLeftIcon className="size-4" />
          <span>Close Tabs to the Left</span>
        </Item>
      )}
      {onCloseToRight && (
        <Item onClick={onCloseToRight}>
          <ArrowLineRightIcon className="size-4" />
          <span>Close Tabs to the Right</span>
        </Item>
      )}
      {onCloseSplit && (
        <Item onClick={onCloseSplit}>
          <XIcon className="size-4" />
          <span>{WINDOW_SHORTCUTS.closeSplit.label}</span>
          {isSelected ? (
            <Shortcut>
              {formatAcceleratorText(WINDOW_SHORTCUTS.closeSplit.accelerator)}
            </Shortcut>
          ) : null}
        </Item>
      )}
      {own && (
        <>
          <Separator />
          {own}
        </>
      )}
    </>
  );
}
