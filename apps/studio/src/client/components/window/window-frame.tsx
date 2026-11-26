import {
  DEVELOPER_STRIP_HEIGHT,
  useDeveloperStripShown,
} from "@/client/atoms/developer-strip";
import { SetupHost } from "@/client/components/setup/setup-host";
import { useIsSetupUp } from "@/client/components/setup/use-setup-state";
import { StudioModals } from "@/client/components/studio-modals/studio-modals";
import { BELL_TOASTER, Toaster } from "@/client/components/ui/sonner";
import { PageOpenContext } from "@/client/components/page-open-context";
import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { TOOLBAR_HEIGHT, windowCardTop } from "@/shared/constants";
import { type CSSProperties, type ReactNode, type Ref } from "react";

import { cn, isMacOS } from "@/client/lib/utils";
import { FeedbackBar } from "./feedback-bar";
import { LinkSurface } from "./link-surface";

// The toasts' corner, 12px in from the window's own lower left, over the
// sidebar when it is open.
const WINDOW_CORNER = { bottom: 12, left: 12 };
// The bell's popover's width (`w-95`), so a toast is the row it becomes.
const BELL_WIDTH = 380;
/** The sidebar's foot, `h-11` in `group-sidebar.tsx`, which the bell sits in. */
const SIDEBAR_FOOT_HEIGHT = 44;

/** The card everything past the rail stands on: rounded, lifted off the window's ground. */
export const WINDOW_CARD =
  "overflow-hidden rounded-[18px] bg-background shadow-xs";

/** The ground left between the card and the window's edges, in layout px, and between two cards side by side. */
export { WINDOW_CARD_GAP } from "@/shared/constants";

/**
 * The window's chrome: no title bar, so it drags by its top-left corner,
 * which is the chat pane's top, past the traffic lights.
 */
export function WindowFrame({
  bar,
  children,
  corner,
  hasBar = true,
  rail,
  rowRef,
}: {
  bar?: ReactNode;
  children: ReactNode;
  /** Laid over the window's top left corner, where it stays whatever comes and goes under it. */
  corner?: ReactNode;
  /** Whether the window keeps a row across its top; without one, the columns reach the top and drag the window there themselves. */
  hasBar?: boolean;
  /** The rail down the window's left edge, outside the row the columns share. */
  rail?: ReactNode;
  /** The row the columns share, for whoever sizes them against it. */
  rowRef?: Ref<HTMLDivElement>;
}) {
  // Setup covers the window, so the app behind it takes no input, and what
  // the app would put up over itself (a dialog, a toast)
  // waits rather than landing over setup.
  const isSetupUp = useIsSetupUp();
  const isStripShown = useDeveloperStripShown();
  const cardTop = windowCardTop(isMacOS());
  // Toasts are placed from the viewport's foot, which the developer band sits on.
  const toastCorner = {
    ...WINDOW_CORNER,
    bottom: WINDOW_CORNER.bottom + (isStripShown ? DEVELOPER_STRIP_HEIGHT : 0),
  };
  // Just over the sidebar's foot, where the bell is, in line with its rows.
  const bellCorner = {
    bottom:
      (isStripShown ? DEVELOPER_STRIP_HEIGHT : 0) + SIDEBAR_FOOT_HEIGHT + 4,
    left: 8,
  };
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
        data-testid={bar || !hasBar ? "app-page" : undefined}
        inert={isSetupUp}
      >
        {/* The bar is the window's own row and reserves the band the traffic
          lights are drawn in, so no column below has to leave a gap for them. */}
        {hasBar &&
          (bar ?? (
            <div
              className="shrink-0 [-webkit-app-region:drag]"
              style={{ height: `${TOOLBAR_HEIGHT}px` }}
            />
          ))}
        {/* The ground over the card drags the window too. */}
        {!hasBar && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 [-webkit-app-region:drag]"
            style={{ height: cardTop }}
          />
        )}
        <div className="flex min-h-0 flex-1">
          {rail}
          {/* Measured on its own, past the rail, so a column sized against
            the row is sized against the width the columns actually share. */}
          {/* Two planes: the rail and the bar on the window's own ground,
            and everything else on one card inset from it, rounded, with room
            left at its right and foot. A view that draws cards of its own
            (`data-own-cards`) stands in the card's place, which keeps only
            its bounds. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className={cn(
                "relative mr-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col [--background:var(--pane)] [--guest-bottom-radius:18px]",
                WINDOW_CARD,
                "has-[[data-own-cards]]:overflow-visible has-[[data-own-cards]]:bg-transparent has-[[data-own-cards]]:shadow-none",
                // Clear of the rail too, which comes and goes beside it.
                !hasBar && "ml-2",
              )}
              style={hasBar ? undefined : { marginTop: cardTop }}
              ref={rowRef}
            >
              <div className="flex min-h-0 min-w-0 flex-1">
                {/* A plain link anywhere in the window stays in it. */}
                <LinkSurface>{children}</LinkSurface>
              </div>
            </div>
          </div>
        </div>
        {corner}
        {!isSetupUp && (
          <>
            {/* Feedback put down, at the right end of the window's own foot. */}
            <FeedbackBar />
            {/* Settings, the report and the other dialogs belong to no
              chat, so a page they link to opens in the default browser
              rather than beside whatever chat is on screen behind them. */}
            <PageOpenContext value={null}>
              <StudioModals />
            </PageOpenContext>
            {/* In the window's lower left corner: clear of the drafts and
              the floating chat, which dock at the bottom right. */}
            <Toaster mobileOffset={toastCorner} offset={toastCorner} />
            {/* A bell toast draws its own card, the bell's row, so the
              toaster only gives it the popover's surface and width. */}
            <Toaster
              id={BELL_TOASTER}
              mobileOffset={bellCorner}
              offset={bellCorner}
              position="bottom-left"
              // React's style type has no custom properties; Sonner sizes
              // its stack and every toast in it from this one.
              style={{ "--width": `${BELL_WIDTH}px` } as CSSProperties}
              toastOptions={{
                classNames: {
                  toast:
                    // A card stacked behind another is cut to the front one's
                    // height, so what's in it hides until the stack opens.
                    "w-(--width) overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-float-md data-[expanded=false]:data-[front=false]:*:opacity-0",
                },
                style: { pointerEvents: "auto" },
                unstyled: true,
              }}
            />
          </>
        )}
      </div>
      <PageOpenContext value={null}>
        <SetupHost />
      </PageOpenContext>
    </ChromeInsetProvider>
  );
}
