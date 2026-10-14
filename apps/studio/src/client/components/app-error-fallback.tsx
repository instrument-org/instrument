import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";

import { ErrorCardShell } from "./error-card-shell";
import { ReportErrorButton } from "./report-error-button";
import { Button } from "./ui/button";
import { WindowControls } from "./window-controls";
import { ZoomRoot } from "./zoom-root";

/**
 * Top-level fallback for the app window's `CatchBoundary`. Rendered when the
 * window shell or providers crash outside any router, so it must not use router
 * hooks (there is no navigation to recover to). The only reliable recovery for a
 * shell crash is a full reload of the web contents, so the `reset` the boundary
 * passes is intentionally ignored.
 *
 * It takes the whole window, so it keeps the band the window's bar normally
 * draws: a drag region the macOS traffic lights stay centered in, and the
 * window controls on the platforms that draw their own. Without it a frameless
 * window can be neither moved nor closed until it reloads. The boundary sits
 * inside the window's query client, theme and tooltip providers but outside its
 * zoom root and icon context, so this brings its own of those two.
 */
export function AppErrorFallback({ error }: { error: unknown }) {
  return (
    <IconContext.Provider value={ICON_CONTEXT_VALUE}>
      <ZoomRoot>
        <ChromeInsetProvider top={TOOLBAR_HEIGHT}>
          <div className="flex h-full flex-col">
            <div
              className="flex shrink-0 justify-end [-webkit-app-region:drag]"
              style={{ height: `${TOOLBAR_HEIGHT}px` }}
            >
              {/* Nothing on macOS, where the system draws the buttons. */}
              <WindowControls />
            </div>
            {/* `my-auto` rather than centering the column, so a card taller
              than the window scrolls from its top instead of losing it. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
              <div className="my-auto flex justify-center">
                <AppErrorCard error={error} />
              </div>
            </div>
          </div>
        </ChromeInsetProvider>
      </ZoomRoot>
    </IconContext.Provider>
  );
}

/**
 * The card {@link AppErrorFallback} centers in the window, on its own so a
 * screen can show it without the window's band around it.
 */
export function AppErrorCard({ error }: { error: unknown }) {
  return (
    <ErrorCardShell
      actions={
        <div className="flex gap-x-2">
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
          <ReportErrorButton error={error} surface="window-error" />
        </div>
      }
      description="The app hit an unexpected error. Reload to recover, or send us a report if it keeps happening."
      error={error}
    />
  );
}
