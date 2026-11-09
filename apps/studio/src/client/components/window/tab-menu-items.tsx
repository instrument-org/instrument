import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
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
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLineRightIcon } from "@phosphor-icons/react/ArrowLineRight";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { type ReactNode } from "react";

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
  onDismiss,
}: {
  /** Where the right click was, on screen; nothing while the menu is down. */
  at: { x: number; y: number } | undefined;
  children: ReactNode;
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
      {at && <TabMenuContent>{children}</TabMenuContent>}
    </DropdownMenu>
  );
}

/** The menu's panel, mounted as it opens, which is when its guard starts. */
function TabMenuContent({ children }: { children: ReactNode }) {
  const releaseGuard = useOpeningReleaseGuard();
  return (
    <DropdownMenuContent
      align="start"
      className="min-w-52"
      sideOffset={0}
      {...releaseGuard}
    >
      {children}
    </DropdownMenuContent>
  );
}

/**
 * What a tab's menu offers, the same in the window's strip and a chat's
 * pane: reload a page, copy the tab, put it somewhere else, copy its
 * address, then close it or the tabs around it. Drawn with whichever menu's
 * parts it is raised in, since a menu's items only work in their own menu.
 * A row is left out where its action is.
 */
export function TabMenuItems({
  components: { Item, Separator, Shortcut },
  isClosedByChord,
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
  /** Whether Close Tab's chord closes this tab, which Close Tab's row then shows; the tab up's, unless said. */
  isClosedByChord?: boolean;
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
        {(isClosedByChord ?? isSelected) ? (
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
