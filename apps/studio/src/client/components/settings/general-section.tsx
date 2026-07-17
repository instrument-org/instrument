import { AccountInfo } from "@/client/components/account-info";
import { ExternalLink } from "@/client/components/external-link";
import { ThemeToggle } from "@/client/components/theme-toggle";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
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
import { isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  APP_NAME,
  APP_REPO_URL,
  MANUAL_DOWNLOAD_URL,
} from "@instrument-org/shared";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
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
        return (
          <div className="text-xs text-muted-foreground">
            {isLinux()
              ? `Version ${updateState.updateInfo?.version ?? ""} is
            ready to install. Please allow a few minutes for the update to install. The app will relaunch when complete.`
              : `Version ${updateState.updateInfo?.version ?? ""} is
            ready to install.`}
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
            No updates available
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
            </div>
            <div className="shrink-0">{getActionButton()}</div>
          </div>
        </Card>
        <Card className="bg-muted/30 p-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Open Source</div>
              <p className="text-xs text-muted-foreground">
                {APP_NAME} is open source and free to use. You can view the
                source code on GitHub.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <ExternalLink href={APP_REPO_URL}>
                View source on GitHub
                <ArrowSquareOutIcon className="size-3.5" />
              </ExternalLink>
            </Button>
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
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="agent-completion-notifications">
              Notify when tasks finish
            </Label>
            <p className="text-xs text-muted-foreground">
              Show a desktop notification when a task finishes.
            </p>
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
        <div className="mt-3 flex items-center border-t pt-3">
          <Button
            className="h-auto p-0 text-xs font-normal text-muted-foreground"
            disabled={sendTestNotificationMutation.isPending}
            onClick={handleSendTest}
            variant="link"
          >
            Send a test notification
          </Button>
        </div>
      </Card>
    </SettingsSection>
  );
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
