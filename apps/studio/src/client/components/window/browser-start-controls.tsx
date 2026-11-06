import { featuresAtom } from "@/client/atoms/features";
import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
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
import { useWindow } from "@/client/components/window/context";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/BookmarkSimple";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { FloppyDiskIcon } from "@phosphor-icons/react/FloppyDisk";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PrinterIcon } from "@phosphor-icons/react/Printer";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { useAtomValue } from "jotai";
import { createPortal } from "react-dom";

import {
  BrowserExtensionButtons,
  ManageItems,
} from "./browser-extension-buttons";

/**
 * The tail of the row over a browser screen that is no page (the start, the
 * Extensions page), drawn as the page's row is so the browser reads the
 * same before a page is open: the extensions' pill, and the menu with the
 * rows that need a page disabled, the way Chrome's is, and the rest live.
 */
export function BrowserStartControls() {
  const { rowTail } = useWindow();
  const hasExtensions = useAtomValue(featuresAtom).browser_extensions;
  if (!rowTail) {
    return null;
  }
  return createPortal(
    <>
      <BrowserExtensionButtons />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button aria-label="More actions" size="icon-sm" variant="ghost">
            <DotsThreeVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled>
            <BookmarkSimpleIcon className="size-4" />
            Add to bookmarks
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openClearBrowsingData}>
            <BroomIcon className="size-4" />
            Clear browsing data…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <PrinterIcon className="size-4" />
            Print…
            <DropdownMenuShortcut>
              {formatAcceleratorText(WINDOW_SHORTCUTS.printPage.accelerator)}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <MagnifyingGlassIcon className="size-4" />
            Find in page
            <DropdownMenuShortcut>
              {formatAcceleratorText(WINDOW_SHORTCUTS.findInPage.accelerator)}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FloppyDiskIcon className="size-4" />
            Save page as…
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <CopyIcon className="size-4" />
            Copy URL
          </DropdownMenuItem>
          {hasExtensions && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <PuzzlePieceIcon className="size-4" />
                  Extensions
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <ManageItems />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>,
    rowTail,
  );
}
