import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { filePreviewAtom } from "@/client/atoms/file-preview";
import { InAppOnboarding } from "@/client/components/onboarding/in-app-onboarding";
import { StudioModals } from "@/client/components/studio-modals/studio-modals";
import { Toaster } from "@/client/components/ui/sonner";
import { UpdatedToast } from "@/client/components/updated-toast";
import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { useAtomValue } from "jotai";
import { lazy, type ReactNode, type Ref, Suspense } from "react";

import { useAppTabs } from "./app-tabs";
import { LinkSurface } from "./link-surface";

// A pasted file opened from a composer, at its full size: loaded the first
// time one is opened, since most windows never open one.
const LazyFilePreviewModal = lazy(() =>
  import("@/client/components/file-preview-modal").then((m) => ({
    default: m.FilePreviewModal,
  })),
);

// The developer panel's Tools: the router's and the query cache's devtools,
// the analytics toolbar, and page annotation, loaded only once asked for.
const DevTools = lazy(() =>
  import("@/client/components/dev-tools").then((m) => ({
    default: m.DevTools,
  })),
);

const Agentation = import.meta.env.DEV
  ? lazy(() =>
      import("agentation").then((m) => ({
        default: m.Agentation,
      })),
    )
  : null;

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
  /** Laid over the whole window, for the draft windows that float over it. */
  overlay?: ReactNode;
  /** The rail down the window's left edge, outside the row the columns share. */
  rail?: ReactNode;
  /** The row the columns share, for whoever sizes them against it. */
  rowRef?: Ref<HTMLDivElement>;
}) {
  const isFilePreviewOpen = useAtomValue(filePreviewAtom).isOpen;
  const isDeveloperMode = useDeveloperMode();
  const activeDevToolsPanel = useAtomValue(devToolsPanelAtom);
  const appTabs = useAppTabs();
  return (
    // The band across the top is the window's, so every menu, popover and
    // tooltip is held below it: on macOS the traffic lights are drawn over that
    // strip of web contents and what lands under them cannot be clicked at all.
    <ChromeInsetProvider top={TOOLBAR_HEIGHT}>
      {/* `h-full` rather than the viewport: this is drawn inside `ZoomRoot`,
        which is already the real window scaled to the zoom the UI is laid out
        at, so a viewport height would apply that zoom a second time. */}
      {/* Marked once the window is up, which is when it has its bar: the
        packaged-app smoke test waits for this rather than a loading frame. */}
      <div
        className="relative flex h-full flex-col bg-ground"
        data-testid={bar ? "app-page" : undefined}
      >
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
            the row is sized against the width the columns actually share. */}
          {/* Two planes: the rail and the bar on the window's own ground,
            and everything else on one card inset from it, rounded, with room
            left at its right and foot. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className="relative mr-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-xs [--guest-bottom-radius:var(--radius-2xl)]"
              ref={rowRef}
            >
              <div className="flex min-h-0 min-w-0 flex-1">
                {/* A plain link anywhere in the window stays in it. */}
                <LinkSurface>{children}</LinkSurface>
              </div>
            </div>
          </div>
        </div>
        {/* Over the whole window, so a draft or a popped-out chat stands on
          the window's own foot and right edge rather than inside the card's
          margin, and a grown one is centered over the bar and the rail too. */}
        {overlay}
        <InAppOnboarding />
        <StudioModals />
        {isFilePreviewOpen && (
          <Suspense fallback={null}>
            <LazyFilePreviewModal />
          </Suspense>
        )}
        {isDeveloperMode && (
          <Suspense fallback={null}>
            <DevTools />
          </Suspense>
        )}
        {Agentation &&
          isDeveloperMode &&
          activeDevToolsPanel === "agentation" && (
            <Suspense fallback={null}>
              <Agentation />
            </Suspense>
          )}
        {/* Top right, clear of the drafts at the foot, and below the bar on
          every platform: the bar holds the traffic lights or the window
          controls, and a toast over it covers the window's own chrome. */}
        <Toaster
          mobileOffset={{ top: TOOLBAR_HEIGHT + 16 }}
          offset={{ top: TOOLBAR_HEIGHT + 16 }}
          position="top-right"
        />
        <UpdatedToast
          onWhatsNew={() => {
            appTabs.open("/release-notes");
          }}
        />
      </div>
    </ChromeInsetProvider>
  );
}
