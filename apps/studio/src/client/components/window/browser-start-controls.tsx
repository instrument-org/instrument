import { useWindow } from "@/client/components/window/context";
import { ZoomStepper } from "@/client/components/zoom-controls";
import { useRef } from "react";
import { createPortal } from "react-dom";

import { BrowserDownloadsButton } from "./browser-downloads";
import { BrowserExtensionButtons } from "./browser-extension-buttons";
import { BrowserPageMenu } from "./browser-page-menu";

/**
 * The tail of the row over a browser screen that is no page (the start, the
 * Extensions page), drawn into the window's row so the browser reads the
 * same before a page is open. A page picked from its History opens through
 * `onOpenPage`.
 */
export function BrowserStartControls({
  onOpenPage,
}: {
  onOpenPage: (url: string) => void;
}) {
  const { rowTail } = useWindow();
  if (!rowTail) {
    return null;
  }
  return createPortal(<BrowserStartTail onOpenPage={onOpenPage} />, rowTail);
}

/**
 * What a page's row ends in, for a tab with no page loaded (a new tab, the
 * browser's start): the extensions' pill, the downloads, and the page's own
 * menu with the rows that need a page disabled. Its zoom is the window's,
 * which is what a zoom chord there changes.
 */
export function BrowserStartTail({
  onOpenPage,
}: {
  onOpenPage: (url: string) => void;
}) {
  // No page here starts a download, so none is drawn leaving from it.
  const noSurface = useRef<HTMLElement>(null);
  return (
    <>
      <BrowserExtensionButtons />
      <BrowserDownloadsButton surfaceRef={noSurface} targetId="" />
      <BrowserPageMenu
        bookmark={{ canBookmark: false }}
        onOpenHistory={onOpenPage}
        page={undefined}
        zoom={<ZoomStepper />}
      />
    </>
  );
}
