import { openSettings } from "@/client/atoms/settings-modal";
import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { safe } from "@orpc/client";
import { XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

// Escalated nudge shown once a downloaded update has sat ignored past the
// server threshold. It never restarts on its own: the CTA is user-initiated and
// routes through the same running-agent confirmation as the toolbar badge.
export function UpdateReminder() {
  const { data: reminder } = useQuery(
    rpcClient.updates.live.reminder.experimental_liveOptions({}),
  );
  const [dismissed, setDismissed] = useState(false);

  if (!reminder?.show || dismissed) {
    return null;
  }

  const handleRestart = () => {
    void (async () => {
      const [error] = await safe(rpcClient.preferences.quitAndInstall.call());
      if (error) {
        // No Toaster reliably above the chrome; fall through to Settings, which
        // surfaces the failure with retry and manual-download options.
        openSettings({ tab: "General" });
      }
    })();
  };

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2 [-webkit-app-region:no-drag]">
      <span className="text-sm text-muted-foreground">
        An update{reminder.version ? ` to ${reminder.version}` : ""} is ready.
        Restart {APP_NAME} to finish updating.
      </span>
      <div className="flex items-center gap-1">
        <Button onClick={handleRestart} size="sm">
          Restart to update
        </Button>
        <Button
          aria-label="Dismiss update reminder"
          onClick={() => {
            setDismissed(true);
          }}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
