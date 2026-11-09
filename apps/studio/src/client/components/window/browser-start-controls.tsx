import { TOOLBAR_ICON_BUTTON_CLASSNAME } from "@/client/components/toolbar-control";
import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { rpcClient } from "@/client/rpc/client";
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
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { createPortal } from "react-dom";

import { BrowserDownloadsButton } from "./browser-downloads";
import { BrowserHistoryMenu } from "./browser-history-menu";

import {
  BrowserExtensionButtons,
  ManageItems,
} from "./browser-extension-buttons";

/**
 * The tail of the row over a browser screen that is no page (the start, the
 * Extensions page), drawn as the page's row is so the browser reads the
 * same before a page is open: the extensions' pill, the downloads, and the
 * menu with the rows that need a page disabled, the way Chrome's is, and
 * the rest live. A page picked from its History opens through `onOpenPage`.
 */
export function BrowserStartControls({
  onOpenPage,
}: {
  onOpenPage: (url: string) => void;
}) {
  const { rowTail } = useWindow();
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setBlockAds = useMutation(
    rpcClient.preferences.setBlockAds.mutationOptions(),
  );
  // No page here starts a download, so none is drawn leaving from it.
  const noSurface = useRef<HTMLElement>(null);
  if (!rowTail) {
    return null;
  }
  return createPortal(
    <>
      <BrowserExtensionButtons />
      <BrowserDownloadsButton surfaceRef={noSurface} targetId="" />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More actions"
            className={TOOLBAR_ICON_BUTTON_CLASSNAME}
            size="icon-sm"
            variant="ghost"
          >
            <DotsThreeVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <BrowserHistoryMenu onOpen={onOpenPage} />
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
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={preferences?.blockAds ?? true}
            onCheckedChange={(enabled) => {
              setBlockAds.mutate({ enabled });
            }}
          >
            <ShieldCheckIcon className="size-4" />
            Block ads
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>,
    rowTail,
  );
}
