import { ExternalLink } from "@/client/components/external-link";
import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { MANUAL_DOWNLOAD_URL } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

const handleInstallUpdate = () => {
  void rpcClient.preferences.quitAndInstall.call();
};

// Update lifecycle actions (check / install / retry + manual download) shared by
// the Settings About card and the full-screen UpdateRequiredScreen so both offer
// the same recovery paths. Status copy stays with each caller; this owns actions.
export function UpdateRecoveryActions({
  alwaysShowManualDownload = false,
  downloadRef,
  inactiveSlot,
  manualDownloadUrl = MANUAL_DOWNLOAD_URL,
}: {
  // The hard-block screen sets this so the manual download stays reachable in
  // every state; on a blocked build the updater itself may be broken or
  // inactive, and only the error state offers the link otherwise.
  alwaysShowManualDownload?: boolean;
  downloadRef: string;
  // Rendered when the updater is inactive (e.g. dev builds); callers can swap in
  // their own affordance, otherwise a plain check button is shown.
  inactiveSlot?: ReactNode;
  manualDownloadUrl?: string;
}) {
  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );

  const checkForUpdatesMutation = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );

  const handleCheckForUpdates = async () => {
    await checkForUpdatesMutation.mutateAsync({ notify: true });
  };

  const checkForUpdatesButton = (
    <Button
      disabled={checkForUpdatesMutation.isPending}
      onClick={handleCheckForUpdates}
    >
      {checkForUpdatesMutation.isPending ? "Checking..." : "Check for updates"}
    </Button>
  );

  const downloadManuallyButton = (
    <Button asChild>
      <ExternalLink href={withRef(manualDownloadUrl, downloadRef)}>
        Download manually
      </ExternalLink>
    </Button>
  );

  const action = (() => {
    switch (updateState?.type) {
      case "available":
      case "checking":
      case "downloading": {
        return (
          <Button disabled>
            {updateState.type === "checking" && "Checking..."}
            {updateState.type === "downloading" && "Downloading..."}
            {updateState.type === "available" && "Preparing..."}
          </Button>
        );
      }
      case "canceled": {
        return <Button onClick={handleCheckForUpdates}>Try again</Button>;
      }
      case "downloaded": {
        return <Button onClick={handleInstallUpdate}>Install now</Button>;
      }
      case "error": {
        return (
          <div className="flex gap-2">
            <Button onClick={handleCheckForUpdates}>Try again</Button>
            {downloadManuallyButton}
          </div>
        );
      }
      case "inactive": {
        return inactiveSlot ?? checkForUpdatesButton;
      }
      case "installing": {
        return <Button disabled>Installing...</Button>;
      }
      default: {
        return checkForUpdatesButton;
      }
    }
  })();

  // The error case already includes the manual download.
  if (!alwaysShowManualDownload || updateState?.type === "error") {
    return action;
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {action}
      {downloadManuallyButton}
    </div>
  );
}

// Server-provided manual URLs may already carry query params, so set `ref`
// via the URL API instead of naive string concatenation.
function withRef(url: string, ref: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("ref", ref);
    return parsed.toString();
  } catch {
    return url;
  }
}
