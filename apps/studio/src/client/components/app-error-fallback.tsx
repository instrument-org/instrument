import { ErrorCardShell } from "./error-card-shell";
import { Button } from "./ui/button";

/**
 * Top-level fallback for {@link ErrorBoundary}. Rendered when the window shell
 * or providers crash outside any router, so it must not use router hooks (there
 * is no navigation to recover to). The only reliable recovery for a shell crash
 * is a full reload of the web contents.
 */
export function AppErrorFallback({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-full min-w-0 flex-1 items-center justify-center p-6">
      <ErrorCardShell
        actions={
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        }
        description="The app hit an unexpected error. Reload to recover, or get help if it keeps happening."
        error={error}
      />
    </div>
  );
}
