import { Button } from "@/client/components/ui/button";
import { type GuestLoadError } from "@/client/hooks/use-guest-navigation";
import { WarningCircleIcon } from "@phosphor-icons/react";

/**
 * Shown over a guest's slot when its main-frame navigation failed. The guest is
 * parked while this is up (see useBrowserSlot's `hasLoadError`) so its own blank
 * error page doesn't sit on top of this one.
 */
export function GuestLoadErrorNotice({
  error,
  onRetry,
}: {
  error: GuestLoadError;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center">
      <WarningCircleIcon className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">This site can’t be reached</p>
        <p className="max-w-xs truncate text-xs text-muted-foreground">
          {error.url}
        </p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
      <Button onClick={onRetry} size="sm" variant="outline">
        Try again
      </Button>
    </div>
  );
}
