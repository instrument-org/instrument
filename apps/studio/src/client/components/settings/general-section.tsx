import { displayLocale } from "@/client/lib/display-locale";
import { openReportDialog } from "@/client/atoms/report-dialog";
import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { settingAnchor } from "@/client/components/settings/settings-index";
import {
  BlockToolbarButton,
  blockToolbarButtonClassName,
  wrapLinesClassName,
} from "@/client/components/code-block";
import { CopyButton } from "@/client/components/copy-button";
import { DictationSettings } from "@/client/components/settings/dictation-settings";
import { ExternalLink } from "@/client/components/external-link";
import { ThemeToggle } from "@/client/components/theme-toggle";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { DeveloperModeBadge } from "@/client/components/tool-part/developer-mode-badge";
import { Card } from "@/client/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Progress } from "@/client/components/ui/progress";
import { Spinner } from "@/client/components/ui/spinner";
import {
  showsAsRestarting,
  useInstallAsksForPassword,
  useInstallUpdate,
} from "@/client/components/use-install-update";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/client/components/ui/select";
import { StateArrival } from "@/client/components/state-arrival";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useAppTabs } from "@/client/components/window/app-tabs";
import { ZoomStepper } from "@/client/components/zoom-controls";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { feedbackReport } from "@/client/lib/problem-reports";
import { cn, isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  namedPlatformApiServerLabel,
  namedPlatformApiServerOf,
  offersAnyPlatformApiServer,
  PlatformApiServerSchema,
} from "@/shared/platform-api-server";
import {
  APP_FLAVOR,
  APP_NAME,
  APP_REPO_URL,
  MANUAL_DOWNLOAD_URL,
} from "@instrument-org/shared";
import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/ArrowElbowDownLeft";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/ArrowsHorizontal";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { BellSimpleIcon } from "@phosphor-icons/react/BellSimple";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "@/client/lib/toast";

export function SettingsSection({
  children,
  developerOnly,
  title,
}: {
  children: ReactNode;
  developerOnly?: boolean;
  title: string;
}) {
  return (
    <div className="space-y-3">
      <h3
        className={cn(
          "flex items-center gap-2 text-sm font-medium text-muted-foreground",
          developerOnly && "text-dev-700 dark:text-dev-300",
        )}
      >
        {title}
        {developerOnly && <DeveloperModeBadge />}
      </h3>
      {children}
    </div>
  );
}

export function GeneralSection() {
  return (
    <div className="space-y-4">
      <InterfaceAndTheme />
      <Notifications />
      <SettingsSection title="Dictation">
        <DictationSettings />
      </SettingsSection>
      <About />
      <PlatformApiServerSetting />
      <ReleaseChannel />
      <SettingsSection title="Advanced">
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
  const { install, restarting } = useInstallUpdate(updateState?.type);
  const asksForPassword = useInstallAsksForPassword();
  // The status the main process publishes on the way to a restart, said as
  // the restart from the press on.
  const showRestarting = showsAsRestarting(restarting, updateState?.type);

  const developerMode = useDeveloperMode();

  const appTabs = useAppTabs();
  const closeSettings = useSetAtom(settingsModalAtom);

  const handleOpenReleaseNotes = () => {
    appTabs.open("/release-notes");
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
    <SettingsSection title="About">
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
          <div className="space-y-3" {...settingAnchor("open-source")}>
            <div className="space-y-1">
              <div className="text-sm font-medium">Open source</div>
              <p className="text-xs text-muted-foreground">
                {APP_NAME} is open source and free to use. View the source on
                GitHub, or tell us about something that isn&apos;t working. It
                also comes with programs from other projects, and you can read
                their licenses here.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <ExternalLink href={APP_REPO_URL}>
                  View source on GitHub
                  <ArrowSquareOutIcon className="size-3.5" />
                </ExternalLink>
              </Button>
              <Button
                onClick={() => {
                  openReportDialog(feedbackReport({ surface: "settings" }));
                }}
                size="sm"
                variant="outline"
              >
                Send feedback
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
    </SettingsSection>
  );
}

function InterfaceAndTheme() {
  return (
    <SettingsSection title="Interface">
      <Card className="p-4">
        <div className="space-y-5">
          <div
            className="flex items-center justify-between"
            {...settingAnchor("theme")}
          >
            <div className="space-y-0.5">
              <Label htmlFor="theme-toggle">Theme</Label>
              <p className="text-xs text-muted-foreground">
                Choose your preferred color scheme.
              </p>
            </div>
            <ThemeToggle />
          </div>
          <div
            className="flex items-center justify-between"
            {...settingAnchor("zoom")}
          >
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

const RELEASE_CHANNELS = [
  { label: "Stable", value: "latest" },
  { label: "Beta", value: "beta" },
] as const;

/**
 * Which builds this computer updates to. Developer mode only: the beta feed is
 * for the people testing a release before it ships.
 */
function ReleaseChannel() {
  const developerMode = useDeveloperMode();
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setReleaseChannelMutation = useMutation(
    rpcClient.preferences.setReleaseChannel.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change the release channel", { cause: error });
      },
    }),
  );

  if (!developerMode) {
    return null;
  }

  const channel = preferences?.releaseChannel ?? "latest";
  const triggerLabel =
    RELEASE_CHANNELS.find((option) => option.value === channel)?.label ??
    channel;

  return (
    <SettingsSection developerOnly title="Release channel">
      <Card className="border-dashed border-dev-700/40 bg-dev-500/5 p-4 dark:border-dev-300/30">
        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("release-channel")}
        >
          <div className="space-y-1">
            <Label htmlFor="release-channel">Channel</Label>
            <p className="text-xs text-muted-foreground">
              Beta gets each new version as soon as it’s out. Switching back to
              Stable keeps this version until a newer stable one ships.
            </p>
          </div>
          <Select
            disabled={setReleaseChannelMutation.isPending}
            onValueChange={(value) => {
              const option = RELEASE_CHANNELS.find((o) => o.value === value);
              if (option) {
                setReleaseChannelMutation.mutate({
                  channel: option.value === "latest" ? undefined : option.value,
                });
              }
            }}
            value={channel}
          >
            <SelectTrigger
              className="bg-card bg-none dark:bg-gray-700"
              id="release-channel"
            >
              {triggerLabel}
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              {RELEASE_CHANNELS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>
    </SettingsSection>
  );
}

type ServerOption = "custom" | "local" | "production" | "staging";

const SERVER_OPTIONS: readonly { label: string; value: ServerOption }[] =
  offersAnyPlatformApiServer(APP_FLAVOR)
    ? [
        {
          label: namedPlatformApiServerLabel("production"),
          value: "production",
        },
        { label: namedPlatformApiServerLabel("staging"), value: "staging" },
        { label: namedPlatformApiServerLabel("local"), value: "local" },
        { label: "Custom", value: "custom" },
      ]
    : [
        {
          label: namedPlatformApiServerLabel("production"),
          value: "production",
        },
        { label: namedPlatformApiServerLabel("staging"), value: "staging" },
      ];

/**
 * Which platform API server this computer talks to. Developer mode only:
 * staging, and in a development build a local or typed-in server, are for
 * the people working on the API. A change restarts the app, after asking
 * here.
 */
function PlatformApiServerSetting() {
  const developerMode = useDeveloperMode();
  const { data: current } = useQuery(
    rpcClient.preferences.platformApiServer.queryOptions(),
  );
  const [picked, setPicked] = useState<null | ServerOption>(null);
  const [customUrl, setCustomUrl] = useState("");
  const setServerMutation = useMutation(
    rpcClient.preferences.setPlatformApiServer.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't switch servers", { cause: error });
      },
      onSuccess: ({ outcome }) => {
        if (outcome === "unsupported") {
          toast.info(`Quit ${APP_NAME} and open it again to use that server.`);
        }
        if (outcome !== "relaunching") {
          setPicked(null);
        }
      },
    }),
  );

  if (!developerMode || current === undefined) {
    return null;
  }

  const currentOption: ServerOption =
    namedPlatformApiServerOf(current.baseUrl) ?? "custom";
  const shown = picked ?? currentOption;
  const triggerLabel =
    SERVER_OPTIONS.find((option) => option.value === shown)?.label ?? "Custom";
  const custom = PlatformApiServerSchema.safeParse({
    custom: customUrl.trim(),
  });
  const server =
    picked === "custom"
      ? custom.success
        ? custom.data
        : undefined
      : (picked ?? undefined);
  const pickedLabel =
    picked === "custom"
      ? (URL.parse(customUrl.trim())?.host ?? "that server")
      : SERVER_OPTIONS.find((option) => option.value === picked)?.label;

  return (
    <SettingsSection developerOnly title="API server">
      <Card className="border-dashed border-dev-700/40 bg-dev-500/5 p-4 dark:border-dev-300/30">
        <div className="space-y-3" {...settingAnchor("api-server")}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="api-server">Server</Label>
              <p className="text-xs text-muted-foreground">
                Sign-in, plans, and {APP_NAME} models all use this server.
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {current.baseUrl}
              </p>
            </div>
            <Select
              disabled={setServerMutation.isPending}
              onValueChange={(value) => {
                const option = SERVER_OPTIONS.find((o) => o.value === value);
                if (!option) {
                  return;
                }
                if (
                  option.value === currentOption &&
                  option.value !== "custom"
                ) {
                  setPicked(null);
                  return;
                }
                if (option.value === "custom" && currentOption === "custom") {
                  setCustomUrl(current.baseUrl);
                }
                setPicked(option.value);
              }}
              value={shown}
            >
              <SelectTrigger
                className="bg-card bg-none dark:bg-gray-700"
                id="api-server"
              >
                {triggerLabel}
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                {SERVER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {picked !== null && (
            <div className="space-y-2 border-t border-dev-700/20 pt-3 dark:border-dev-300/20">
              {picked === "custom" && (
                <Input
                  aria-invalid={customUrl.trim() !== "" && !custom.success}
                  aria-label="Server address"
                  autoFocus
                  className="font-mono text-xs"
                  onChange={(event) => setCustomUrl(event.target.value)}
                  placeholder="http://localhost:49100"
                  value={customUrl}
                />
              )}
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  {APP_NAME} will restart to use {pickedLabel}. You stay signed
                  in on each server you’ve used.
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button
                    disabled={setServerMutation.isPending}
                    onClick={() => setPicked(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      server === undefined || setServerMutation.isPending
                    }
                    onClick={() => {
                      if (server !== undefined) {
                        setServerMutation.mutate({ server });
                      }
                    }}
                    size="sm"
                  >
                    {setServerMutation.isPending ? "Restarting…" : "Restart"}
                  </Button>
                </div>
              </div>
            </div>
          )}
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
  // Settings opened by a link to the log arrives with the viewer already up.
  // Compared by identity, so a second such link while Settings is open opens
  // the viewer again after it was closed.
  const request = useAtomValue(settingsModalAtom);
  const [viewerOpen, setViewerOpen] = useState(request?.diagnosticLog === true);
  const [trackedRequest, setTrackedRequest] = useState(request);
  if (request !== trackedRequest) {
    setTrackedRequest(request);
    if (request?.diagnosticLog === true) {
      setViewerOpen(true);
    }
  }
  // Wrapped by default: the first thing anyone does here is read, and a stack
  // trace that runs off the right edge has to be scrolled to before it can be.
  const [wrapLines, setWrapLines] = useState(true);

  const logQuery = useQuery({
    ...rpcClient.utils.readDiagnosticLog.queryOptions(),
    enabled: viewerOpen,
  });

  const saveLogMutation = useMutation(
    rpcClient.utils.saveDiagnosticLog.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't save the log", { cause: error });
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
            toast.success("Saved the log");

            break;
          }
          // No default
        }
      },
    }),
  );

  return (
    <Card className="p-4">
      <div className="space-y-3" {...settingAnchor("diagnostic-log")}>
        <div className="space-y-1">
          <div className="text-sm font-medium">Diagnostic log</div>
          <p className="text-xs text-muted-foreground">
            {APP_NAME} keeps a private, local-only record of what it did while
            running. A report about the app includes its last lines, which can
            name files and tasks you worked on, so you can read them in the
            report before you send it.
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
          <DownloadLogButton
            disabled={saveLogMutation.isPending}
            onDownload={() => {
              saveLogMutation.mutate();
            }}
          />
        </div>
        <AutomaticErrorReports />
        <FeedbackOffers />
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
          aria-describedby={undefined}
          className="grid-rows-[auto_minmax(0,1fr)] overflow-y-hidden"
          maxHeight="44rem"
          maxWidth="60rem"
        >
          <DialogHeader>
            <DialogTitle>Diagnostic log</DialogTitle>
          </DialogHeader>
          {/*
            `min-w-0` is what keeps a log inside the dialog. A grid item refuses
            to shrink under its own content by default, and a stack trace is one
            unbreakable path per line, so without it the pane grows to the widest
            line and carries the dialog out past the window with it. Zero lets
            the pane be narrower than its text, which is what gives `overflow`
            something to scroll.

            The controls sit over the pane rather than inside the scroller so
            they stay put while it moves, in the same idiom code blocks and
            diagrams use for the same job.
          */}
          <div className="relative min-h-0 min-w-0">
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              <BlockToolbarButton
                icon={wrapLines ? ArrowElbowDownLeftIcon : ArrowsHorizontalIcon}
                label="Wrap lines"
                onClick={() => {
                  setWrapLines(!wrapLines);
                }}
                pressed={wrapLines}
              />
              <CopyButton
                className={blockToolbarButtonClassName}
                disabled={!logQuery.data}
                iconSize={12}
                label="Copy log"
                onCopy={async () => {
                  await navigator.clipboard.writeText(
                    logQuery.data?.text ?? "",
                  );
                }}
                tooltip="Copy log"
              />
              <BlockToolbarButton
                icon={DownloadSimpleIcon}
                label="Download log"
                onClick={() => {
                  saveLogMutation.mutate();
                }}
              />
            </div>
            <div
              className={cn(
                "h-full overflow-auto rounded-md border border-border bg-muted/40 p-3 select-text",
                wrapLines && wrapLinesClassName,
              )}
            >
              {logQuery.isPending ? (
                <p className="text-xs text-muted-foreground">
                  Reading the log...
                </p>
              ) : logQuery.data ? (
                // No whitespace class of its own: `pre` already does not wrap,
                // so the toggle above adds wrapping rather than fighting it.
                <pre className="pr-24 font-mono text-xs leading-5">
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
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Icon only, in both the card and the viewer.
 *
 * The action needs no label: a download glyph says it, and the words for it
 * ("save a copy", "export") each read as something slightly different from what
 * happens. The tooltip carries the name for anyone who wants one.
 */
/**
 * Whether crashes and app errors are sent without asking. It's turned on from
 * a report's own checkbox, so this is where it's turned off.
 */
function AutomaticErrorReports() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setSendAutomatically = useMutation(
    rpcClient.problems.setSendAutomatically.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );
  return (
    <label className="flex items-start justify-between gap-4 border-t border-border pt-3">
      <span className="space-y-1">
        <span className="block text-sm font-medium">
          Send error reports automatically
        </span>
        <span className="block text-xs text-muted-foreground">
          When {APP_NAME} crashes or runs into an error, it sends a report
          without asking. Chats are never sent automatically.
        </span>
      </span>
      <Switch
        checked={preferences?.sendErrorReportsAutomatically === true}
        disabled={setSendAutomatically.isPending}
        onCheckedChange={(enabled) => {
          setSendAutomatically.mutate({ enabled });
        }}
      />
    </label>
  );
}

/**
 * Whether the agent may offer, on a card in a chat, to send the team a problem
 * it found. Turned off from the card itself, so this is where it comes back.
 */
function FeedbackOffers() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setOfferFeedback = useMutation(
    rpcClient.problems.setOfferFeedback.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );
  return (
    <label className="flex items-start justify-between gap-4 border-t border-border pt-3">
      <span className="space-y-1">
        <span className="block text-sm font-medium">
          Offer to report problems
        </span>
        <span className="block text-xs text-muted-foreground">
          When something in {APP_NAME} breaks during a chat, it can offer to
          send us what happened. Nothing is sent unless you say so.
        </span>
      </span>
      <Switch
        checked={preferences?.offerFeedback !== false}
        disabled={setOfferFeedback.isPending}
        onCheckedChange={(enabled) => {
          setOfferFeedback.mutate({ enabled });
        }}
      />
    </label>
  );
}

function DownloadLogButton({
  disabled,
  onDownload,
}: {
  disabled: boolean;
  onDownload: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Download log"
          disabled={disabled}
          onClick={onDownload}
          size="icon-sm"
          variant="ghost"
        >
          <DownloadSimpleIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Download log</TooltipContent>
    </Tooltip>
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
  const { data: canOpenNotificationSettings = false } = useQuery(
    rpcClient.preferences.canOpenNotificationSettings.queryOptions(),
  );
  // What macOS says about the app's notifications, read again each time the
  // window takes focus, which is when someone returns from System Settings
  // having changed it. Switching apps leaves the page visible, so the query
  // library's own refetch-on-focus never fires here.
  const permission = useQuery(
    rpcClient.mac.notifications.status.queryOptions(),
  );
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );
  const refetchPermission = permission.refetch;
  useEffect(() => {
    void refetchPermission();
  }, [windowFocusChanged, refetchPermission]);
  const requestPermission = useMutation(
    rpcClient.mac.notifications.request.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't ask macOS about notifications", {
          cause: error,
        });
      },
      onSettled: () => {
        void permission.refetch();
      },
      onSuccess: ({ error }) => {
        // macOS refused without asking anyone: in development because the
        // build is not signed, which is the one case worth explaining.
        if (error !== undefined) {
          toast.error("macOS didn't allow notifications", {
            cause: error,
            description: import.meta.env.DEV
              ? "Development builds aren't signed, and macOS lets only a signed app notify."
              : undefined,
          });
        }
      },
    }),
  );
  const status = permission.data?.status;
  // Where the app is allowed but banners are off, nothing shows on screen.
  const isQuiet =
    status === "provisional" ||
    (status === "allowed" && permission.data?.alerts === false);

  const mode = preferences?.agentCompletionNotifications ?? "unfocused";
  const triggerLabel =
    NOTIFICATION_MODES.find((option) => option.value === mode)?.triggerLabel ??
    "Not focused";

  const handleSendTest = async () => {
    try {
      const { supported } =
        await sendTestNotificationMutation.mutateAsync(undefined);
      if (!supported) {
        toast.error("This computer doesn't support notifications");
        return;
      }
      toast.success("Test notification sent", {
        // Where the system has no notification settings to open, the
        // description alone says what to look for.
        action: canOpenNotificationSettings
          ? {
              label: "Open settings",
              onClick: () => {
                openNotificationSettingsMutation.mutate(undefined);
              },
            }
          : undefined,
        description: `Not seeing it? Turn on notifications for ${APP_NAME}.`,
      });
    } catch (error) {
      toast.error("Couldn't send a test notification", { cause: error });
    }
  };

  // Until macOS lets the app notify, the setting would read as working when
  // nothing can appear, so the section asks for that first.
  const gate =
    status === "not-asked"
      ? "not-asked"
      : status === "denied"
        ? "off"
        : isQuiet
          ? "quiet"
          : undefined;
  // Which of the two the section shows, so it settles in when macOS changes
  // its answer while someone is in System Settings.
  const arrival = status === undefined ? undefined : (gate ?? "allowed");
  if (gate !== undefined) {
    return (
      <SettingsSection title="Notifications">
        <StateArrival state={arrival}>
          <NotificationsPermission
            isPending={requestPermission.isPending}
            onAllow={() => {
              requestPermission.mutate(undefined);
            }}
            onOpenSettings={() => {
              openNotificationSettingsMutation.mutate(undefined);
            }}
            state={gate}
          />
        </StateArrival>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Notifications">
      <StateArrival state={arrival}>
        <Card className="p-4">
          <div
            className="flex items-start justify-between gap-4"
            {...settingAnchor("notifications")}
          >
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
                const option = NOTIFICATION_MODES.find(
                  (o) => o.value === value,
                );
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
      </StateArrival>
    </SettingsSection>
  );
}

// oxlint-disable studio/no-os-words -- shown only on macOS, the one system that asks before an app may notify
/**
 * Notifications before macOS lets the app show any: what they are for and
 * the one thing that gets them going, asking macOS the first time and
 * opening System Settings once it has an answer.
 */
function NotificationsPermission({
  isPending,
  onAllow,
  onOpenSettings,
  state,
}: {
  isPending: boolean;
  onAllow: () => void;
  onOpenSettings: () => void;
  state: "not-asked" | "off" | "quiet";
}) {
  const detail = {
    "not-asked": "Get a notification when a task finishes or needs you.",
    off: "Notifications are off in System Settings.",
    quiet: "Banners are off in System Settings, so nothing shows on screen.",
  }[state];
  return (
    <Card className="p-4">
      <div
        className="flex items-center gap-3.5"
        {...settingAnchor("notifications")}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-white">
          <BellSimpleIcon className="size-5" weight="fill" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium">Know when it's done</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        <Button
          className="shrink-0 rounded-full px-5"
          disabled={isPending}
          onClick={state === "not-asked" ? onAllow : onOpenSettings}
          size="sm"
          variant={state === "not-asked" ? "brand" : "outline"}
        >
          {state === "not-asked" ? "Allow" : "Open System Settings"}
        </Button>
      </div>
    </Card>
  );
}
// oxlint-enable studio/no-os-words

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
