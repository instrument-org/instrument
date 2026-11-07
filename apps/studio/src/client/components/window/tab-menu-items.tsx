import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { type MenuComponents } from "@/client/components/ui/menu-components";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { type ReactNode } from "react";

/**
 * What a tab's menu offers, the same in the window's strip and a chat's
 * pane: reload a page, copy the tab, put it somewhere else, copy its
 * address, then close it or the tabs around it. Drawn with whichever menu's
 * parts it is raised in, since a menu's items only work in their own menu.
 * A row is left out where its action is.
 */
export function TabMenuItems({
  components: { Item, Separator, Shortcut },
  isSelected,
  moving,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCopyUrl,
  onDuplicate,
  onOpenInNewWindow,
  onOpenInTabBar,
  onReload,
  own,
}: {
  components: MenuComponents;
  /** The tab up, whose chords the rows show. */
  isSelected: boolean;
  /** Where the tab itself can move to, which only the window's strip offers. */
  moving?: ReactNode;
  onClose: () => void;
  onCloseOthers: (() => void) | undefined;
  onCloseToRight: (() => void) | undefined;
  onCopyUrl?: (() => void) | undefined;
  onDuplicate: () => void;
  /** A copy in a window of its own. */
  onOpenInNewWindow?: (() => void) | undefined;
  /** A copy in the window's own strip, from a pane's. */
  onOpenInTabBar?: (() => void) | undefined;
  onReload: (() => void) | undefined;
  /** What only this strip's tabs have, ahead of closing. */
  own?: ReactNode;
}) {
  return (
    <>
      {onReload && (
        <Item onClick={onReload}>
          <ArrowClockwiseIcon className="size-4" />
          <span>Reload</span>
          {isSelected ? (
            <Shortcut>
              {formatAcceleratorText(WINDOW_SHORTCUTS.reloadPage.accelerator)}
            </Shortcut>
          ) : null}
        </Item>
      )}
      <Item onClick={onDuplicate}>
        <NewTabIcon className="size-4" />
        <span>Duplicate Tab</span>
      </Item>
      {onOpenInTabBar && (
        <Item onClick={onOpenInTabBar}>
          <BrowsersIcon className="size-4" />
          <span>Open in Window Tab Bar</span>
        </Item>
      )}
      {onOpenInNewWindow && (
        <Item onClick={onOpenInNewWindow}>
          <AppWindowIcon className="size-4" />
          <span>Open in New Window</span>
        </Item>
      )}
      {moving}
      {onCopyUrl && (
        <Item onClick={onCopyUrl}>
          <CopyIcon className="size-4" />
          <span>Copy URL</span>
        </Item>
      )}
      {own}
      <Separator />
      <Item onClick={onClose}>
        <XIcon className="size-4" />
        <span>Close Tab</span>
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
      {onCloseToRight && (
        <Item onClick={onCloseToRight}>
          <ArrowLineRightIcon className="size-4" />
          <span>Close Tabs to the Right</span>
        </Item>
      )}
    </>
  );
}
