import { displayLocale } from "@/client/lib/display-locale";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { ExternalLink } from "@/client/components/external-link";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Progress } from "@/client/components/ui/progress";
import { Spinner } from "@/client/components/ui/spinner";
import {
  showsAsRestarting,
  useInstallAsksForPassword,
  useInstallUpdate,
} from "@/client/components/use-install-update";
import { SCREEN_ROUTES } from "@/client/components/window/window-href";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  APP_NAME,
  APP_REPO_URL,
  MANUAL_DOWNLOAD_URL,
} from "@instrument-org/shared";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

/** Which build this is and its updates, then the source and the licenses it ships with. */
export function AboutSection() {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">About</h3>
      <About />
    </div>
  );
}

function About() {
  const { data: appVersion, isLoading: isLoadingVersion } = useQuery(
    rpcClient.preferences.getAppVersion.queryOptions(),
  );

  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );

  const checkForUpdatesMutation = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );

  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );
  const { install, restarting } = useInstallUpdate(updateState?.type);
  const asksForPassword = useInstallAsksForPassword();
  // The status the main process publishes on the way to a restart, said as
  // the restart from the press on.
  const showRestarting = showsAsRestarting(restarting, updateState?.type);

  const developerMode = useDeveloperMode();

  // A built-in page: a click walks this tab there, as a browser's settings
  // open its history.
  const releaseNotes = useOpenGestures(
    { href: SCREEN_ROUTES.releaseNotes, kind: "screen" },
    { isLink: true },
  );

  const { data: appEnvironment } = useQuery({
    ...rpcClient.debug.getAppEnvironment.queryOptions(),
    enabled: developerMode,
  });

  const isUnpacked = appEnvironment?.isPackaged === false;

  const testDownloadNotification = useMutation(
    rpcClient.debug.trigger.testDownloadNotification.mutationOptions(),
  );

  const openLicensesMutation = useMutation(
    rpcClient.utils.openThirdPartyLicenses.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't open the licenses", { cause: error });
      },
    }),
  );

  const handleCheckForUpdates = () => {
    checkForUpdatesMutation.mutate();
  };

  const formatLastChecked = (date: Date) => {
    return (
      date.toLocaleDateString(displayLocale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }) +
      " at " +
      date.toLocaleTimeString(displayLocale, {
        hour: "numeric",
        hour12: true,
        minute: "2-digit",
      })
    );
  };

  const lastChecked = preferences?.lastUpdateCheck
    ? new Date(preferences.lastUpdateCheck)
    : null;

  const restartingNote = (
    <div className="text-xs text-muted-foreground">
      {(updateState?.type === "installing" && updateState.notice) ||
        `${APP_NAME} is restarting to finish the update.`}
    </div>
  );

  const getUpdateStatusContent = () => {
    if (showRestarting) {
      return restartingNote;
    }
    switch (updateState?.type) {
      case "available": {
        return (
          <div className="text-xs text-muted-foreground">
            Version {updateState.updateInfo?.version ?? ""} is available.
            Downloading...
          </div>
        );
      }
      case "canceled": {
        return (
          <div className="text-xs text-muted-foreground">
            Update to version {updateState.updateInfo?.version} was canceled
          </div>
        );
      }
      case "checking": {
        return (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Checking for updates...
            </div>
          </div>
        );
      }
      case "downloaded": {
        const version = updateState.updateInfo?.version ?? "";
        return (
          <div className="text-xs text-muted-foreground">
            {isLinux()
              ? `Version ${version} is ready to install. Installing takes a few minutes, and ${APP_NAME} restarts when it's done.`
              : `Version ${version} is ready to install. ${APP_NAME} restarts when you install it.`}
            {asksForPassword &&
              " Your computer will ask for your password first."}
          </div>
        );
      }
      case "downloading": {
        return (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Downloading update...
            </div>
            <Progress
              className="h-1 w-full"
              value={updateState.progress.percent}
            />
            <div className="text-right text-xs text-muted-foreground">
              {updateState.progress.percent.toFixed(0)}%
            </div>
          </div>
        );
      }
      case "error": {
        return (
          <div className="text-xs text-destructive">
            Update failed: {updateState.message.slice(0, 100)}
            {updateState.message.length > 100 ? "..." : ""}
          </div>
        );
      }
      case "inactive": {
        return (
          <div className="text-xs text-muted-foreground">
            The app is running in development mode. Updates are not available.
          </div>
        );
      }
      case "installing": {
        return restartingNote;
      }
      case "not-available": {
        return (
          <div className="text-xs text-muted-foreground">
            You&rsquo;re up to date.
          </div>
        );
      }
      default: {
        return lastChecked ? (
          <div className="text-xs text-muted-foreground">
            Last checked for updates on {formatLastChecked(lastChecked)}.
          </div>
        ) : null;
      }
    }
  };

  const checkForUpdatesButton = (
    <Button
      disabled={checkForUpdatesMutation.isPending}
      onClick={handleCheckForUpdates}
    >
      {checkForUpdatesMutation.isPending ? "Checking..." : "Check for updates"}
    </Button>
  );

  const restartingButton = (
    <Button disabled>
      <Spinner className="size-3.5" delay={0} />
      Restarting…
    </Button>
  );

  const getActionButton = () => {
    if (showRestarting) {
      return restartingButton;
    }
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
        return (
          <Button
            onClick={() => {
              void install();
            }}
          >
            Install now
          </Button>
        );
      }
      case "error": {
        return (
          <div className="flex gap-2">
            <Button onClick={handleCheckForUpdates}>Try again</Button>
            <Button asChild>
              <ExternalLink
                href={`${MANUAL_DOWNLOAD_URL}?ref=studio-settings-error`}
                target="_blank"
              >
                Download manually
              </ExternalLink>
            </Button>
          </div>
        );
      }
      case "inactive": {
        if (developerMode && isUnpacked) {
          return (
            <Button
              className="text-dev-700 dark:text-dev-300"
              disabled={testDownloadNotification.isPending}
              onClick={() => {
                testDownloadNotification.mutate(undefined);
              }}
            >
              Test download
            </Button>
          );
        }
        return checkForUpdatesButton;
      }
      case "installing": {
        return restartingButton;
      }
      default: {
        return checkForUpdatesButton;
      }
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("version")}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-sm font-medium select-text">
              Version{" "}
              {isLoadingVersion
                ? "Loading..."
                : appVersion?.version || "Unknown"}
            </div>
            {getUpdateStatusContent()}
            <Button
              className="h-auto p-0 text-xs font-normal text-foreground"
              onAuxClick={releaseNotes.onAuxClick}
              onClick={releaseNotes.onClick}
              onContextMenu={releaseNotes.onContextMenu}
              variant="link"
            >
              What's new
            </Button>
          </div>
          <div className="shrink-0">{getActionButton()}</div>
        </div>
      </Card>
      <Card className="bg-muted/30 p-4">
        <div className="space-y-3" {...settingAnchor("open-source")}>
          <div className="space-y-1">
            <div className="text-sm font-medium">Open source</div>
            <p className="text-xs text-muted-foreground">
              {APP_NAME} is open source and free to use. It also comes with
              programs from other projects, and you can read their licenses
              here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <ExternalLink href={APP_REPO_URL} target="_blank">
                View source on GitHub
                <ArrowSquareOutIcon className="size-3.5" />
              </ExternalLink>
            </Button>
            <Button
              disabled={openLicensesMutation.isPending}
              onClick={() => {
                openLicensesMutation.mutate(undefined);
              }}
              size="sm"
              variant="outline"
            >
              Third-party licenses
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
