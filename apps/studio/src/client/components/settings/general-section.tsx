import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { AccountInfo } from "@/client/components/account-info";
import { ExternalLink } from "@/client/components/external-link";
import { ThemeToggle } from "@/client/components/theme-toggle";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Label } from "@/client/components/ui/label";
import { Progress } from "@/client/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { ZoomStepper } from "@/client/components/zoom-controls";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  APP_NAME,
  APP_REPO_URL,
  BUG_REPORT_URL,
  MANUAL_DOWNLOAD_URL,
} from "@instrument-org/shared";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

function SettingsSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

const handleInstallUpdate = () => {
  void rpcClient.preferences.quitAndInstall.call();
};

export function GeneralSection() {
  return (
    <div className="space-y-4">
      <AccountInfo />
      <InterfaceAndTheme />
      <Notifications />
      <About />
      <SettingsSection title="Advanced">
        <UsageMetrics />
        <DiagnosticLog />
      </SettingsSection>
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

  const developerMode = useDeveloperMode();

  const { addTab } = useTabActions();
  const closeSettings = useSetAtom(settingsModalAtom);

  const handleOpenReleaseNotes = () => {
    void addTab({ to: "/release-notes" });
    closeSettings(null);
  };

  const { data: appEnvironment } = useQuery({
    ...rpcClient.debug.getAppEnvironment.queryOptions(),
    enabled: developerMode,
  });

  const isUnpacked = appEnvironment?.isPackaged === false;

  const testDownloadNotification = useMutation(
    rpcClient.debug.trigger.testDownloadNotification.mutationOptions(),
  );

  const handleCheckForUpdates = () => {
    checkForUpdatesMutation.mutate({
      notify: true,
    });
  };

  const formatLastChecked = (date: Date) => {
    return (
      date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }) +
      " at " +
      date.toLocaleTimeString("en-US", {
        hour: "numeric",
        hour12: true,
        minute: "2-digit",
      })
    );
  };

  const lastChecked = preferences?.lastUpdateCheck
    ? new Date(preferences.lastUpdateCheck)
    : null;

  const getUpdateStatusContent = () => {
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
        return (
          <div className="text-xs text-muted-foreground">
            {updateState.notice ?? "Update is installing..."}
          </div>
        );
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

  const getActionButton = () => {
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
            <Button asChild>
              <ExternalLink
                href={`${MANUAL_DOWNLOAD_URL}?ref=studio-settings-error`}
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
        return <Button disabled>Installing...</Button>;
      }
      default: {
        return checkForUpdatesButton;
      }
    }
  };

  return (
    <SettingsSection title="About">
      <div className="space-y-3">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-sm font-medium">
                Version{" "}
                {isLoadingVersion
                  ? "Loading..."
                  : appVersion?.version || "Unknown"}
              </div>
              {getUpdateStatusContent()}
              <Button
                className="h-auto p-0 text-xs font-normal text-foreground"
                onClick={handleOpenReleaseNotes}
                variant="link"
              >
                Release notes
              </Button>
            </div>
            <div className="shrink-0">{getActionButton()}</div>
          </div>
        </Card>
        <Card className="bg-muted/30 p-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Open source</div>
              <p className="text-xs text-muted-foreground">
                {APP_NAME} is open source and free to use. View the source on
                GitHub, or tell us about something that isn&apos;t working.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <ExternalLink href={APP_REPO_URL}>
                  View source on GitHub
                  <ArrowSquareOutIcon className="size-3.5" />
                </ExternalLink>
              </Button>
              <Button asChild size="sm" variant="outline">
                <ExternalLink href={BUG_REPORT_URL}>
                  Report a bug
                  <ArrowSquareOutIcon className="size-3.5" />
                </ExternalLink>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </SettingsSection>
  );
}

function InterfaceAndTheme() {
  return (
    <SettingsSection title="Interface">
      <Card className="p-4">
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="theme-toggle">Theme</Label>
              <p className="text-xs text-muted-foreground">
                Choose your preferred color scheme.
              </p>
            </div>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Zoom</Label>
              <p className="text-xs text-muted-foreground">
                Scale the interface. Independent of web view zoom.
              </p>
            </div>
            <ZoomStepper />
          </div>
        </div>
      </Card>
    </SettingsSection>
  );
}

const NOTIFICATION_MODES = [
  { menuLabel: "Always", triggerLabel: "Always", value: "always" },
  {
    menuLabel: "Only when not focused",
    triggerLabel: "Not focused",
    value: "unfocused",
  },
  { menuLabel: "Never", triggerLabel: "Never", value: "never" },
] as const;

/**
 * Where someone is sent when they are asked for their log.
 *
 * In Advanced because most people never need it, and out of the developer-only
 * tab because the people who need it are not developers: the whole point is a
 * support conversation that can say "open settings and send me this" to anyone.
 *
 * Reading it and saving a copy, rather than a path into the app's own data
 * directory. That directory holds the databases and settings the app runs on,
 * and pointing someone at it to hunt for one file puts everything else in the
 * same window. Reading first is the other half: what is in here is worth
 * looking at before sending it to anyone.
 */
type LogLevel = "error" | "plain" | "warn";

const LOG_LEVEL_CLASS: Record<LogLevel, string> = {
  error: "text-destructive",
  plain: "",
  warn: "text-warning-700 dark:text-warning-300",
};

/**
 * The most lines the viewer will draw.
 *
 * One element per line is what makes a level readable at a glance, and it is
 * also what puts a ceiling on how many lines can be drawn before scrolling
 * costs more than it is worth. The cap sits above what the byte cap on the
 * read can usually produce, so it only bites on a log of unusually short lines.
 */
const MAX_VIEWED_LINES = 4000;

function DiagnosticLog() {
  const [viewerOpen, setViewerOpen] = useState(false);

  const logQuery = useQuery({
    ...rpcClient.utils.readDiagnosticLog.queryOptions(),
    enabled: viewerOpen,
  });

  const saveLogMutation = useMutation(
    rpcClient.utils.saveDiagnosticLog.mutationOptions({
      onError: () => {
        toast.error("Couldn't save the log");
      },
      onSuccess: ({ status }) => {
        switch (status) {
          case "failed": {
            toast.error("Couldn't save the log");

            break;
          }
          case "no-log": {
            toast.error("There's no log to save yet");

            break;
          }
          case "saved": {
            toast.success("Saved a copy of the log");

            break;
          }
          // No default
        }
      },
    }),
  );

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Diagnostic log</div>
          <p className="text-xs text-muted-foreground">
            {APP_NAME} keeps a record of what it did while running. Save a copy
            to send along when you report a problem. It can name files and tasks
            you worked on, so read it before you share it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setViewerOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            View log
          </Button>
          <Button
            disabled={saveLogMutation.isPending}
            onClick={() => {
              saveLogMutation.mutate();
            }}
            size="sm"
            variant="outline"
          >
            Save a copy
            <DownloadSimpleIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <Dialog onOpenChange={setViewerOpen} open={viewerOpen}>
        {/*
          The log scrolls, not the dialog. `DialogContent` scrolls itself by
          default, which for a pane of thousands of lines moves the title out of
          view and leaves nothing to orient against. Naming the rows lets the
          second one shrink below its content so the pane inside it can take the
          overflow instead.
        */}
        <DialogContent
          className="grid-rows-[auto_minmax(0,1fr)] overflow-y-hidden"
          maxHeight="44rem"
          maxWidth="60rem"
        >
          <DialogHeader>
            <DialogTitle>Diagnostic log</DialogTitle>
            <DialogDescription>
              {logQuery.data?.truncated
                ? "The most recent part of the log. A saved copy holds all of it."
                : "Everything the app has recorded this session."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto rounded-md border border-border bg-muted/40 p-3">
            {logQuery.isPending ? (
              <p className="text-xs text-muted-foreground">
                Reading the log...
              </p>
            ) : logQuery.data ? (
              <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">
                {toLogLines(logQuery.data.text).map((line, index) => (
                  <div
                    className={LOG_LEVEL_CLASS[line.level]}
                    // Lines repeat and carry no id, so position is the only
                    // thing telling them apart. The list is rebuilt whole
                    // whenever the text changes, so nothing reorders under it.
                    key={index}
                  >
                    {line.text}
                  </div>
                ))}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                There&rsquo;s no log yet. It fills up as you use the app.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Notifications() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setAgentCompletionNotificationsMutation = useMutation(
    rpcClient.preferences.setAgentCompletionNotifications.mutationOptions(),
  );
  const sendTestNotificationMutation = useMutation(
    rpcClient.preferences.sendTestNotification.mutationOptions(),
  );
  const openNotificationSettingsMutation = useMutation(
    rpcClient.preferences.openNotificationSettings.mutationOptions(),
  );

  const mode = preferences?.agentCompletionNotifications ?? "unfocused";
  const triggerLabel =
    NOTIFICATION_MODES.find((option) => option.value === mode)?.triggerLabel ??
    "Not focused";

  const handleSendTest = async () => {
    try {
      const { supported } =
        await sendTestNotificationMutation.mutateAsync(undefined);
      if (!supported) {
        toast.error("Notifications aren't supported on this device.");
        return;
      }
      toast.success("Test notification sent", {
        action: {
          label: "Open settings",
          onClick: () => {
            openNotificationSettingsMutation.mutate(undefined);
          },
        },
        description: `Not seeing it? Turn on notifications for ${APP_NAME}.`,
      });
    } catch {
      toast.error("Couldn't send a test notification.");
    }
  };

  return (
    <SettingsSection title="Notifications">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="agent-completion-notifications">
              Notify when tasks finish
            </Label>
            <p className="text-xs text-muted-foreground">
              Show a desktop notification when a task finishes.
            </p>
            <Button
              className="h-auto p-0 text-xs font-normal text-foreground"
              disabled={sendTestNotificationMutation.isPending}
              onClick={handleSendTest}
              variant="link"
            >
              Send a test notification
            </Button>
          </div>
          <Select
            disabled={setAgentCompletionNotificationsMutation.isPending}
            onValueChange={(value) => {
              const option = NOTIFICATION_MODES.find((o) => o.value === value);
              if (option) {
                setAgentCompletionNotificationsMutation.mutate({
                  mode: option.value,
                });
              }
            }}
            value={mode}
          >
            <SelectTrigger
              className="bg-card bg-none dark:bg-gray-700"
              id="agent-completion-notifications"
            >
              {triggerLabel}
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              {NOTIFICATION_MODES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.menuLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>
    </SettingsSection>
  );
}

/**
 * Split the log into lines tagged by severity.
 *
 * Severity is the only thing worth coloring here. The two formats this reads
 * are the packaged build's `[level]` line and development's JSON per line, so
 * both spellings are matched rather than one parser being chosen for a shape
 * that varies by build.
 */
function toLogLines(text: string): { level: LogLevel; text: string }[] {
  return text
    .split("\n")
    .slice(-MAX_VIEWED_LINES)
    .map((line) => {
      if (/\[error\]|"level"\s*:\s*"error"/i.test(line)) {
        return { level: "error" as const, text: line };
      }
      if (/\[warn\]|"level"\s*:\s*"warn"/i.test(line)) {
        return { level: "warn" as const, text: line };
      }
      return { level: "plain" as const, text: line };
    });
}

function UsageMetrics() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );

  const setUsageMetricsMutation = useMutation(
    rpcClient.preferences.setEnableUsageMetrics.mutationOptions(),
  );

  const handleToggleUsageMetrics = async (checked: boolean) => {
    try {
      await setUsageMetricsMutation.mutateAsync({ enabled: checked });
      toast.success(
        checked ? "Usage metrics enabled" : "Usage metrics disabled",
      );
    } catch {
      toast.error("Failed to update usage metrics preference");
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center space-x-2">
        <Switch
          checked={preferences?.enableUsageMetrics ?? false}
          disabled={setUsageMetricsMutation.isPending}
          id="usage-metrics"
          onCheckedChange={handleToggleUsageMetrics}
        />
        <Label className="inline" htmlFor="usage-metrics">
          Help {APP_NAME} improve by submitting usage metrics
        </Label>
      </div>
    </Card>
  );
}
