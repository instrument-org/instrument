import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { OpenInAppMenuItems } from "@/client/components/open-in-app";
import { TOOLBAR_ICON_BUTTON_CLASSNAME } from "@/client/components/toolbar-control";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import { ManageItems } from "@/client/components/window/browser-extension-buttons";
import { BrowserHistoryMenu } from "@/client/components/window/browser-history-menu";
import { BookmarksSubmenu } from "@/client/components/window/bookmarks-submenu";
import { type OpenInAppTarget } from "@/client/hooks/use-open-in-app";
import {
  EMULATED_DEVICES,
  type EmulatedDevice,
} from "@/client/lib/emulated-devices";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DeviceMobileIcon } from "@phosphor-icons/react/DeviceMobile";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { ExportIcon } from "@phosphor-icons/react/Export";
import { FloppyDiskIcon } from "@phosphor-icons/react/FloppyDisk";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PrinterIcon } from "@phosphor-icons/react/Printer";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { TerminalWindowIcon } from "@phosphor-icons/react/TerminalWindow";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

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
  viewAs: {
    device: EmulatedDevice | null;
    onChange: (device: EmulatedDevice | null) => void;
  };
};

/**
 * The browser's ⋮, the same over a page and over a tab with no page loaded
 * (a new tab, the browser's start): History, Bookmarks, Extensions, ads and
 * zoom work anywhere, and the rows that act on a page show disabled until
 * there is one (`page`), the way Chrome's menu reads on its new tab page.
 */
export function BrowserPageMenu({
  afterBlockAds,
  bookmark,
  editSource,
  onOpenChange,
  onOpenHistory,
  open,
  openInBrowserTab,
  page,
  zoom,
}: {
  /** Run once the ad choice is saved: a page reloads to show it. */
  afterBlockAds?: () => void;
  /** The Bookmarks submenu, and whether the tab has an address to keep; absent where nothing keeps bookmarks. */
  bookmark?: { canBookmark: boolean };
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
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setBlockAds = useMutation(
    rpcClient.preferences.setBlockAds.mutationOptions(),
  );
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
      {...(onOpenChange ? { onOpenChange } : {})}
      {...(open === undefined ? {} : { open })}
    >
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
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm">Zoom</span>
              {zoom}
            </div>
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
            <ManageItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!page}>
            <DeviceMobileIcon className="size-4" />
            View as
            {page?.viewAs.device && (
              <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
                {page.viewAs.device.label}
              </span>
            )}
          </DropdownMenuSubTrigger>
          {page && (
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={(value) => {
                  page.viewAs.onChange(
                    EMULATED_DEVICES.find((device) => device.id === value) ??
                      null,
                  );
                }}
                value={page.viewAs.device?.id ?? "actual-size"}
              >
                <DropdownMenuRadioItem value="actual-size">
                  Actual size
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {EMULATED_DEVICES.map((device) => (
                  <DropdownMenuRadioItem key={device.id} value={device.id}>
                    {device.label}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {device.width}×{device.height}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          )}
        </DropdownMenuSub>
        <DropdownMenuItem disabled={!page} onSelect={page?.hardReload}>
          <ArrowCounterClockwiseIcon className="size-4" />
          Hard reload
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={preferences?.blockAds ?? true}
          onCheckedChange={(enabled) => {
            setBlockAds.mutate(
              { enabled },
              afterBlockAds ? { onSuccess: afterBlockAds } : {},
            );
          }}
        >
          <ShieldCheckIcon className="size-4" />
          Block ads
        </DropdownMenuCheckboxItem>
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
