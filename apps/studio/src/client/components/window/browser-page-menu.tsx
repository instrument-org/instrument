import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { OpenInAppMenuItems } from "@/client/components/open-in-app";
import { TOOLBAR_ICON_BUTTON_CLASSNAME } from "@/client/components/toolbar-control";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import {
  FoldedExtensionsItems,
  ManageItems,
} from "@/client/components/window/browser-extension-buttons";
import { BrowserHistoryMenu } from "@/client/components/window/browser-history-menu";
import { BookmarksSubmenu } from "@/client/components/window/bookmarks-submenu";
import {
  PageViewAsMenu,
  ZoomMenuRow,
} from "@/client/components/window/page-menu-items";
import { type OpenInAppTarget } from "@/client/hooks/use-open-in-app";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { isMacOS } from "@/client/lib/utils";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { ExportIcon } from "@phosphor-icons/react/Export";
import { FloppyDiskIcon } from "@phosphor-icons/react/FloppyDisk";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PrinterIcon } from "@phosphor-icons/react/Printer";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { TerminalWindowIcon } from "@phosphor-icons/react/TerminalWindow";
import { type ReactNode } from "react";

import { useFoldedRowItems } from "./folded-row-items";

/** What the menu does to the page loaded under it. */
export type MenuPage = {
  copyUrl: () => void;
  devTools: () => void;
  find: () => void;
  hardReload: () => void;
  /** The apps that could open the page's file, when it is one. */
  openIn?: OpenInAppTarget | undefined;
  print: () => void;
  save: () => void;
  share: () => void;
  /** The page's guest, whose View as the menu sets. */
  targetId: BrowserTargetId;
};

/**
 * The browser's ⋮, the same over a page and over a tab with no page loaded
 * (a new tab, the browser's start): History, Bookmarks, Extensions and zoom
 * work anywhere, and the rows that act on a page show disabled until
 * there is one (`page`), the way Chrome's menu reads on its new tab page.
 */
export function BrowserPageMenu({
  bookmark,
  editPage,
  editSource,
  onOpenChange,
  onOpenHistory,
  open,
  openInBrowserTab,
  page,
  zoom,
}: {
  /** The Bookmarks submenu, and whether the tab has an address to keep; absent where nothing keeps bookmarks. */
  bookmark?: { canBookmark: boolean };
  /** The page's Edit row, drawn beside Edit source. */
  editPage?: ReactNode;
  editSource?: (() => void) | undefined;
  onOpenChange?: (open: boolean) => void;
  /** A page picked from History. */
  onOpenHistory: (url: string) => void;
  open?: boolean;
  /** Opens the page in a browser tab of the window's own, for a chat's page. */
  openInBrowserTab?: (() => void) | undefined;
  page: MenuPage | undefined;
  /** The zoom stepper of what is under the menu. */
  zoom?: ReactNode;
}) {
  // Over a row that folds its controls, they come first here (`ROW_FOLDS`).
  const folded = useFoldedRowItems({
    extensions: (row, onPress) => (
      <FoldedExtensionsItems
        onPress={onPress}
        row={row}
        targetId={page?.targetId}
      />
    ),
  });
  const shortcut = (name: "findInPage" | "printPage") => (
    <DropdownMenuShortcut>
      {formatAcceleratorText(WINDOW_SHORTCUTS[name].accelerator)}
    </DropdownMenuShortcut>
  );
  return (
    <DropdownMenu
      // Non-modal so clicking into the guest `<webview>` (a separate
      // WebContents) isn't blocked by the modal body `pointer-events: none`.
      modal={false}
      onOpenChange={(isOpen) => {
        folded.onOpenChange(isOpen);
        onOpenChange?.(isOpen);
      }}
      {...(open === undefined ? {} : { open })}
    >
      <DropdownMenuTrigger asChild>
        <Button
          {...folded.triggerProps}
          aria-label="More actions"
          className={TOOLBAR_ICON_BUTTON_CLASSNAME}
          size="icon-sm"
          variant="ghost"
        >
          <DotsThreeVerticalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={folded.onCloseAutoFocus}
      >
        {folded.items}
        {openInBrowserTab && (
          <>
            <DropdownMenuItem disabled={!page} onSelect={openInBrowserTab}>
              <BrowsersIcon className="size-4" />
              Open in Browser Tab
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <BrowserHistoryMenu onOpen={onOpenHistory} />
        {bookmark && (
          <BookmarksSubmenu
            canBookmark={bookmark.canBookmark}
            onOpenPage={onOpenHistory}
          />
        )}
        <DropdownMenuItem onSelect={openClearBrowsingData}>
          <BroomIcon className="size-4" />
          Clear browsing data…
        </DropdownMenuItem>
        {zoom && (
          <>
            <DropdownMenuSeparator />
            <ZoomMenuRow>{zoom}</ZoomMenuRow>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!page} onSelect={page?.print}>
          <PrinterIcon className="size-4" />
          Print…
          {shortcut("printPage")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!page} onSelect={page?.find}>
          <MagnifyingGlassIcon className="size-4" />
          Find in page
          {shortcut("findInPage")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!page} onSelect={page?.save}>
          <FloppyDiskIcon className="size-4" />
          Save page as…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!page} onSelect={page?.copyUrl}>
          <CopyIcon className="size-4" />
          Copy URL
        </DropdownMenuItem>
        {isMacOS() && (
          <DropdownMenuItem disabled={!page} onSelect={page?.share}>
            <ExportIcon className="size-4" />
            Share…
          </DropdownMenuItem>
        )}
        {/* In a row of the window's the app is the address field's own
            button, and the menu names it too, with the others that could
            open a page's file. */}
        {typeof chrome === "object" && page?.openIn && (
          <OpenInAppMenuItems
            menuComponents={dropdownMenuComponents}
            target={page.openIn}
          />
        )}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PuzzlePieceIcon className="size-4" />
            Extensions
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {folded.extensionItems ?? <ManageItems />}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <PageViewAsMenu disabled={!page} targetId={page?.targetId} />
        <DropdownMenuItem disabled={!page} onSelect={page?.hardReload}>
          <ArrowCounterClockwiseIcon className="size-4" />
          Hard reload
        </DropdownMenuItem>
        {editPage}
        {editSource && (
          <DropdownMenuItem onSelect={editSource}>
            <CodeIcon className="size-4" />
            Edit source
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!page} onSelect={page?.devTools}>
          <TerminalWindowIcon className="size-4" />
          Developer tools
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
