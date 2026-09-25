import { filePreviewAtom } from "@/client/atoms/file-preview";
import { FileSystemIconSpriteSheet } from "@/client/components/extend/file-system";
import { StudioModals } from "@/client/components/studio-modals/studio-modals";
import { Toaster } from "@/client/components/ui/sonner";
import { UpdatedToast } from "@/client/components/updated-toast";
import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { useAtomValue } from "jotai";
import { lazy, type ReactNode, type Ref, Suspense } from "react";

// A pasted file opened from a composer, at its full size: loaded the first
// time one is opened, since most windows never open one.
const LazyFilePreviewModal = lazy(() =>
  import("@/client/components/file-preview-modal").then((m) => ({
    default: m.FilePreviewModal,
  })),
);

/**
 * The window's chrome: no title bar, so it drags by its top-left corner,
 * which is the chat pane's top, past the traffic lights.
 */
export function WindowFrame({
  bar,
  children,
  overlay,
  rail,
  rowRef,
}: {
  bar?: ReactNode;
  children: ReactNode;
  /** Laid over the row, for the draft windows that float over it. */
  overlay?: ReactNode;
  /** The rail down the window's left edge, outside the row the columns share. */
  rail?: ReactNode;
  /** The row the columns share, for whoever sizes them against it. */
  rowRef?: Ref<HTMLDivElement>;
}) {
  const isFilePreviewOpen = useAtomValue(filePreviewAtom).isOpen;
  return (
    // The band across the top is the window's, so every menu, popover and
    // tooltip is held below it: on macOS the traffic lights are drawn over that
    // strip of web contents and what lands under them cannot be clicked at all.
    <ChromeInsetProvider top={TOOLBAR_HEIGHT}>
      {/* `h-full` rather than the viewport: this is drawn inside `ZoomRoot`,
        which is already the real window scaled to the zoom the UI is laid out
        at, so a viewport height would apply that zoom a second time. */}
      <div className="relative flex h-full flex-col bg-ground">
        {/* The file browser's own type icons, drawn by reference, so a file
          named anywhere in the window (a thread's marks, say) wears the same
          colored mark it has in the computer view. */}
        <FileSystemIconSpriteSheet />
        {/* The bar is the window's own row and reserves the band the traffic
          lights are drawn in, so no column below has to leave a gap for them. */}
        {bar ?? (
          <div
            className="shrink-0 [-webkit-app-region:drag]"
            style={{ height: `${TOOLBAR_HEIGHT}px` }}
          />
        )}
        <div className="flex min-h-0 flex-1">
          {rail}
          {/* Measured on its own, past the rail, so a column sized against
            the row is sized against the width the columns actually share.
            The overlay shares its width and its edges, so a draft window
            stands against the row's own corner. */}
          {/* Two planes: the rail and the bar on the window's own ground,
            and everything else on one card inset from it, rounded, with room
            left at its right and foot. */}
          <div
            className="relative mr-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-xs [--guest-bottom-radius:var(--radius-2xl)]"
            ref={rowRef}
          >
            <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
            {overlay}
          </div>
        </div>
        <StudioModals />
        {isFilePreviewOpen && (
          <Suspense fallback={null}>
            <LazyFilePreviewModal />
          </Suspense>
        )}
        <Toaster position="bottom-right" />
        {/* No action beside it: the release notes are a screen this window has
          not got, and the version it is now on is the part worth saying. */}
        <UpdatedToast />
      </div>
    </ChromeInsetProvider>
  );
}
