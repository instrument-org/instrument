import { ErrorCardShell } from "./error-card-shell";
import { ReportErrorButton } from "./report-error-button";
import { Button } from "./ui/button";

/**
 * Top-level fallback for the app window's `CatchBoundary`. Rendered when the
 * window shell or providers crash outside any router, so it must not use router
 * hooks (there is no navigation to recover to). The only reliable recovery for a
 * shell crash is a full reload of the web contents, so the `reset` the boundary
 * passes is intentionally ignored.
 */
export function AppErrorFallback({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-full min-w-0 flex-1 items-center justify-center p-6">
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
    </div>
  );
}
