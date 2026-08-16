import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { featuresAtom } from "@/client/atoms/features";
import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { openWelcome } from "@/client/atoms/welcome-modal";
import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import { ZOOM_MAX, ZOOM_MIN, zoomAtom } from "@/client/atoms/zoom";
import { useTheme } from "@/client/components/theme-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/client/components/ui/menubar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { cn, isMacOS } from "@/client/lib/utils";
import {
  componentPages,
  debugNavigationRoutes,
  onboardingScreens,
} from "@/client/routes/_app/debug/-debug-routes";
import { scenarios } from "@/client/routes/_app/debug/-transcript/scenarios";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  FEATURE_METADATA,
  type FeatureName,
  type Features,
} from "@/shared/features";
import { SHORTCUTS } from "@/shared/shortcuts";
import { steppedZoom } from "@/shared/zoom";
import { PORTS } from "@instrument-org/shared";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { ChartBarIcon } from "@phosphor-icons/react/ChartBar";
import { DatabaseIcon } from "@phosphor-icons/react/Database";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/MagnifyingGlassPlus";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
import { MoonIcon } from "@phosphor-icons/react/Moon";
import { NavigationArrowIcon } from "@phosphor-icons/react/NavigationArrow";
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { SunIcon } from "@phosphor-icons/react/Sun";
import { WarningOctagonIcon } from "@phosphor-icons/react/WarningOctagon";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { toast } from "sonner";

type NavigateTo = Parameters<ReturnType<typeof useNavigate>>[0]["to"];

const PAGES = [
  { label: "/tasks", to: "/tasks" },
  { label: "/tutorial-task", to: "/tutorial-task" },
  { label: "/subscribe", to: "/subscribe" },
  { label: "/release-notes", to: "/release-notes" },
  // No skill can answer to this, so it exercises the redirect a deleted skill
  // takes: a toast, then the skills list.
  {
    label: "/skills/<missing>",
    params: { name: "no-such-skill" },
    to: "/skills/$name",
  },
  { label: "/", to: "/" },
] as const satisfies {
  label: string;
  params?: Record<string, string>;
  to: NavigateTo;
}[];

// Every control sits inside one hairline pill, so they share a height and read
// as a single object in the toolbar.
const controlClassName =
  "flex h-4 items-center rounded-full text-dev-700/60 hover:bg-foreground/8 hover:text-dev-700/90" +
  " aria-expanded:bg-foreground/10 aria-expanded:text-dev-700/90" +
  " dark:text-dev-300/60 dark:hover:text-dev-300/90 dark:aria-expanded:text-dev-300/90";

const pillTriggerClassName = `${controlClassName} gap-x-1.5 px-1.5`;

/**
 * One letter per flag. The strip is read by position, so each flag keeps its
 * slot whether it is on or off; letters only have to be distinct from each
 * other, and the Flags menu prints them next to the flag they stand for.
 */
const FEATURE_CODES: Record<FeatureName, string> = {
  bash_summary_chip: "b",
  context_ring: "c",
  external_browser: "x",
  prompt_queue: "q",
  skills: "s",
};

const FEATURE_NAMES = Object.keys(FEATURE_CODES) as FeatureName[];

type AppEnvironment = RPCOutput["debug"]["getAppEnvironment"];

export function DevPanel() {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [crash, setCrash] = useState(false);
  const setDevToolsPanel = useSetAtom(devToolsPanelAtom);
  const [zoom, setZoom] = useAtom(zoomAtom);
  const [forceWindowControls, setForceWindowControls] = useAtom(
    forceWindowControlsAtom,
  );

  const features = useAtomValue(featuresAtom);

  const { mutate: setDeveloperMode } = useMutation(
    rpcClient.preferences.setDeveloperMode.mutationOptions(),
  );

  const { mutate: setFeatureEnabled } = useMutation(
    rpcClient.features.setEnabled.mutationOptions(),
  );

  const { mutate: openOnboarding } = useMutation(
    rpcClient.debug.openOnboarding.mutationOptions(),
  );

  const { mutate: openAuthTestPage } = useMutation(
    rpcClient.debug.openAuthTestPage.mutationOptions(),
  );

  const { mutate: simulateUpdateDownload } = useMutation(
    rpcClient.debug.trigger.testDownloadNotification.mutationOptions(),
  );

  const { mutate: simulateUpdateError } = useMutation(
    rpcClient.debug.trigger.testErrorNotification.mutationOptions(),
  );

  const { mutate: simulateNoUpdate } = useMutation(
    rpcClient.debug.trigger.testNoUpdateNotification.mutationOptions(),
  );

  const { mutate: clearUpdateBadge } = useMutation(
    rpcClient.debug.trigger.testSilentNoUpdate.mutationOptions(),
  );

  const { mutate: simulateUpdatedToast } = useMutation(
    rpcClient.debug.trigger.testUpdatedToast.mutationOptions({
      // The toast reads its bump once, on mount. Reload so it mounts again.
      onSuccess: () => {
        window.location.reload();
      },
    }),
  );

  const { data: quitGuardForced, refetch: refetchQuitGuardForced } = useQuery(
    rpcClient.debug.getQuitGuardForced.queryOptions(),
  );

  const { mutate: setQuitGuardForced } = useMutation(
    rpcClient.debug.setQuitGuardForced.mutationOptions({
      onSuccess: () => {
        void refetchQuitGuardForced();
      },
    }),
  );

  const { data: appEnvironment } = useQuery(
    rpcClient.debug.getAppEnvironment.queryOptions(),
  );

  const { data: appVersion } = useQuery(
    rpcClient.preferences.getAppVersion.queryOptions(),
  );

  const { mutate: openUserDataFolder } = useMutation(
    rpcClient.debug.openUserDataFolder.mutationOptions(),
  );

  const { mutate: openWorkspaceFolder } = useMutation(
    rpcClient.debug.openWorkspaceFolder.mutationOptions(),
  );

  const { mutate: relaunchWithNewUserFolder } = useMutation(
    rpcClient.debug.relaunchWithNewUserFolder.mutationOptions(),
  );

  const [relaunchDialogOpen, setRelaunchDialogOpen] = useState(false);

  const isPackaged = appEnvironment?.isPackaged === true;

  function handleNavigate(
    to: NavigateTo,
    search?: { scenario: string },
    params?: Record<string, string>,
  ) {
    // `to` is widened to the full route union here, so TS can't correlate it
    // with a per-route search or param schema the way a literal `to` would.
    void navigate({ params, search, to } as Parameters<typeof navigate>[0]);
  }

  if (hidden) {
    return null;
  }

  const envLabel = appEnvironment?.isPackaged === true ? "prod" : "dev";
  const instanceTag =
    appEnvironment === undefined ? "" : instanceLabel(appEnvironment);

  return (
    <>
      {crash && <CrashProbe />}
      <div className="flex h-5 items-center gap-x-0.5 rounded-full bg-foreground/4 px-0.5 ring-1 ring-foreground/8 ring-inset">
        <ThemeToggle />
        <Menubar className="h-auto gap-0 border-none bg-transparent p-0">
          <MenubarMenu>
            <MenubarTrigger className={pillTriggerClassName}>
              <span
                className={cn(
                  "font-mono text-[9px] leading-none",
                  isPackaged
                    ? "text-dev-700/80 dark:text-dev-300/80"
                    : "text-warning-700 dark:text-warning-300",
                )}
              >
                {envLabel}
              </span>
              {/* Only in a packaged build: the version of a dev run is whatever
                  is checked out, and "dev" already says so. */}
              {isPackaged && appVersion !== undefined && (
                <span className="font-mono text-[9px] leading-none text-dev-500/70 tabular-nums dark:text-dev-400/60">
                  {appVersion.version}
                </span>
              )}
              {/* What a dev run has to say for itself in the slot a packaged
                  build gives its version: how this instance differs from the
                  one started by hand, and nothing at all when it doesn't. */}
              {!isPackaged && instanceTag !== "" && (
                <span className="font-mono text-[9px] leading-none text-dev-500/70 tabular-nums dark:text-dev-400/60">
                  {instanceTag}
                </span>
              )}
              <FeatureFlagStrip features={features} />
            </MenubarTrigger>
            <MenubarContent align="end" side="bottom">
              <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5 px-2 py-1.5">
                <span className="font-mono text-[9px] text-dev-500/60 dark:text-dev-400/50">
                  env
                </span>
                <span className="font-mono text-[9px] text-dev-700/80 dark:text-dev-300/70">
                  {appEnvironment?.isPackaged ? "production" : "development"}
                </span>
                <span className="font-mono text-[9px] text-dev-500/60 dark:text-dev-400/50">
                  build
                </span>
                <span className="font-mono text-[9px] text-dev-700/80 dark:text-dev-300/70">
                  {appEnvironment?.isPackaged ? "packaged" : "unpackaged"}
                </span>
                {appEnvironment?.drivePurpose !== undefined && (
                  <>
                    <span className="font-mono text-[9px] text-dev-500/60 dark:text-dev-400/50">
                      purpose
                    </span>
                    <span className="font-mono text-[9px] text-dev-700/80 dark:text-dev-300/70">
                      {appEnvironment.drivePurpose}
                    </span>
                  </>
                )}
                {appEnvironment?.worktree !== undefined && (
                  <>
                    <span className="font-mono text-[9px] text-dev-500/60 dark:text-dev-400/50">
                      worktree
                    </span>
                    <span className="font-mono text-[9px] text-dev-700/80 dark:text-dev-300/70">
                      {appEnvironment.worktree}
                    </span>
                  </>
                )}
                {appEnvironment?.userData !== undefined && (
                  <>
                    <span className="font-mono text-[9px] text-dev-500/60 dark:text-dev-400/50">
                      user data
                    </span>
                    <span className="font-mono text-[9px] text-dev-700/80 dark:text-dev-300/70">
                      {appEnvironment.userData}
                    </span>
                  </>
                )}
                {appEnvironment?.debugPort !== undefined && (
                  <>
                    <span className="font-mono text-[9px] text-dev-500/60 dark:text-dev-400/50">
                      debug port
                    </span>
                    <span className="font-mono text-[9px] text-dev-700/80 tabular-nums dark:text-dev-300/70">
                      {appEnvironment.debugPort}
                    </span>
                  </>
                )}
              </div>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Pages
                </MenubarSubTrigger>
                <MenubarSubContent>
                  {PAGES.map((page) => (
                    <MenubarItem
                      className="font-mono text-xs"
                      key={page.label}
                      onSelect={() => {
                        handleNavigate(
                          page.to,
                          undefined,
                          "params" in page ? page.params : undefined,
                        );
                      }}
                    >
                      {page.label}
                    </MenubarItem>
                  ))}
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Debug
                </MenubarSubTrigger>
                <MenubarSubContent>
                  {debugNavigationRoutes.map((route) => (
                    <MenubarItem
                      className="font-mono text-xs"
                      key={route.to}
                      onSelect={() => {
                        handleNavigate(route.to);
                      }}
                    >
                      {route.label}
                    </MenubarItem>
                  ))}
                  <MenubarSeparator />
                  <MenubarSub>
                    <MenubarSubTrigger className="font-mono text-xs">
                      Components
                    </MenubarSubTrigger>
                    <MenubarSubContent>
                      {componentPages.map((page) => {
                        const isOnboardingPage = page.id === "onboarding";
                        const isTranscriptPage = page.id === "transcript";

                        if (isTranscriptPage) {
                          return (
                            <MenubarSub key={page.id}>
                              <MenubarSubTrigger className="font-mono text-xs">
                                {page.label}
                              </MenubarSubTrigger>
                              <MenubarSubContent>
                                {scenarios.map((scenario) => (
                                  <MenubarItem
                                    className="font-mono text-xs"
                                    key={scenario.id}
                                    onSelect={() => {
                                      handleNavigate(page.to, {
                                        scenario: scenario.id,
                                      });
                                    }}
                                  >
                                    {scenario.name}
                                  </MenubarItem>
                                ))}
                              </MenubarSubContent>
                            </MenubarSub>
                          );
                        }

                        if (isOnboardingPage) {
                          return (
                            <MenubarSub key={page.id}>
                              <MenubarSubTrigger className="font-mono text-xs">
                                {page.label}
                              </MenubarSubTrigger>
                              <MenubarSubContent>
                                <MenubarItem
                                  className="font-mono text-xs"
                                  onSelect={() => {
                                    handleNavigate(page.to);
                                  }}
                                >
                                  Overview
                                </MenubarItem>
                                <MenubarSeparator />
                                {onboardingScreens.map((screen) => (
                                  <MenubarItem
                                    className="font-mono text-xs"
                                    key={screen.id}
                                    onSelect={() => {
                                      handleNavigate(screen.to);
                                    }}
                                  >
                                    {screen.label}
                                  </MenubarItem>
                                ))}
                              </MenubarSubContent>
                            </MenubarSub>
                          );
                        }

                        return (
                          <MenubarItem
                            className="font-mono text-xs"
                            key={page.id}
                            onSelect={() => {
                              handleNavigate(page.to);
                            }}
                          >
                            {page.label}
                          </MenubarItem>
                        );
                      })}
                    </MenubarSubContent>
                  </MenubarSub>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Updates
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      simulateUpdateDownload(undefined);
                    }}
                  >
                    <ArrowLineDownIcon className="size-3" />
                    Simulate download
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      simulateUpdateError(undefined);
                    }}
                  >
                    <ArrowsClockwiseIcon className="size-3" />
                    Simulate error
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      simulateNoUpdate(undefined);
                    }}
                  >
                    <ArrowsClockwiseIcon className="size-3" />
                    Simulate no updates
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      clearUpdateBadge(undefined);
                    }}
                  >
                    <ArrowsClockwiseIcon className="size-3" />
                    Clear update badge
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      simulateUpdatedToast(undefined);
                    }}
                  >
                    <ArrowsClockwiseIcon className="size-3" />
                    Simulate updated toast (reloads)
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Windows
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openOnboarding();
                    }}
                  >
                    Onboarding window
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openAuthTestPage();
                    }}
                  >
                    Auth test page
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Tools
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      setDevToolsPanel("router-devtools");
                    }}
                  >
                    <NavigationArrowIcon className="size-3" />
                    Router
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      setDevToolsPanel("query-devtools");
                    }}
                  >
                    <DatabaseIcon className="size-3" />
                    Query
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      setDevToolsPanel("analytics-toolbar");
                    }}
                  >
                    <ChartBarIcon className="size-3" />
                    Analytics
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      setDevToolsPanel("agentation");
                    }}
                  >
                    <NotePencilIcon className="size-3" />
                    Agentation
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Open folder
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openUserDataFolder();
                    }}
                  >
                    User data
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openWorkspaceFolder();
                    }}
                  >
                    Workspace
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Modals
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openLogin();
                    }}
                  >
                    Login
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openWelcome();
                    }}
                  >
                    Welcome
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openSettings();
                    }}
                  >
                    Settings
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarItem
                className="font-mono text-xs text-destructive focus:text-destructive"
                onSelect={() => {
                  // Trip the top-level ErrorBoundary in main-window.tsx by
                  // throwing during render (event-handler throws aren't caught
                  // by boundaries), verifying the shell-crash fallback + report.
                  setCrash(true);
                }}
              >
                <WarningOctagonIcon className="size-3" />
                Simulate crash
              </MenubarItem>
              {isPackaged && (
                <MenubarSub>
                  <MenubarSubTrigger className="font-mono text-xs">
                    Relaunch
                  </MenubarSubTrigger>
                  <MenubarSubContent>
                    <MenubarItem
                      className="font-mono text-xs text-warning-700 dark:text-warning-300"
                      onSelect={() => {
                        setRelaunchDialogOpen(true);
                      }}
                    >
                      With new user folder...
                    </MenubarItem>
                  </MenubarSubContent>
                </MenubarSub>
              )}
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Zoom
                  <span className="ml-1 font-mono text-[9px] text-dev-500/70 tabular-nums dark:text-dev-400/60">
                    {Math.round(zoom * 100)}%
                  </span>
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={(e) => {
                      e.preventDefault();
                      setZoom((z) =>
                        steppedZoom({
                          direction: "in",
                          factor: z,
                          max: ZOOM_MAX,
                          min: ZOOM_MIN,
                        }),
                      );
                    }}
                  >
                    <MagnifyingGlassPlusIcon className="size-3" />
                    Zoom in
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={(e) => {
                      e.preventDefault();
                      setZoom((z) =>
                        steppedZoom({
                          direction: "out",
                          factor: z,
                          max: ZOOM_MAX,
                          min: ZOOM_MIN,
                        }),
                      );
                    }}
                  >
                    <MagnifyingGlassMinusIcon className="size-3" />
                    Zoom out
                  </MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      setZoom(1);
                    }}
                  >
                    <ArrowsClockwiseIcon className="size-3" />
                    Reset
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Flags
                  <FeatureFlagStrip features={features} />
                </MenubarSubTrigger>
                <MenubarSubContent>
                  {FEATURE_NAMES.map((feature) => (
                    <MenubarCheckboxItem
                      checked={features[feature]}
                      className="font-mono text-xs"
                      key={feature}
                      onCheckedChange={(enabled) => {
                        setFeatureEnabled({ enabled, feature });
                      }}
                      title={FEATURE_METADATA[feature].description}
                    >
                      {FEATURE_METADATA[feature].title}
                      <span className="ml-auto pl-4 font-mono text-[9px] text-dev-500/70 dark:text-dev-400/60">
                        {FEATURE_CODES[feature]}
                      </span>
                    </MenubarCheckboxItem>
                  ))}
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              {isMacOS() && (
                <MenubarCheckboxItem
                  checked={forceWindowControls}
                  className="font-mono text-xs"
                  onCheckedChange={setForceWindowControls}
                  title="Render the Windows/Linux window controls on macOS for layout debugging"
                >
                  Force window controls
                </MenubarCheckboxItem>
              )}
              <MenubarCheckboxItem
                checked={quitGuardForced?.forced ?? false}
                className="font-mono text-xs"
                onCheckedChange={(forced) => {
                  setQuitGuardForced({ forced });
                }}
                title="Run the running-agent quit prompt that dev builds normally skip. Resets on relaunch; a rebuild while it is on will wait on the dialog."
              >
                Force quit guard
              </MenubarCheckboxItem>
              <MenubarSeparator />
              <MenubarItem
                className="font-mono text-xs"
                onSelect={() => {
                  setHidden(true);
                }}
              >
                Hide dev panel
              </MenubarItem>
              <MenubarItem
                className="font-mono text-xs"
                onSelect={() => {
                  setDeveloperMode({ enabled: false });
                  toast("Developer mode disabled");
                }}
              >
                Exit developer mode
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>

      <AlertDialog
        onOpenChange={setRelaunchDialogOpen}
        open={isPackaged && relaunchDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Relaunch with new user folder?</AlertDialogTitle>
            <AlertDialogDescription>
              The app will quit and restart using a fresh user data folder. Your
              current session and preferences will not carry over.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                relaunchWithNewUserFolder();
              }}
            >
              Relaunch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Throws during render to exercise the top-level error boundary. */
function CrashProbe(): never {
  throw new Error("Simulated render crash (dev panel)");
}

/**
 * A fixed slot per flag, in one order, so an enabled flag reads as its letter
 * and the rest stay dots: the whole set fits in the width of the old count,
 * and a screenshot says which flags were on rather than how many.
 */
function FeatureFlagStrip({ features }: { features: Features }) {
  return (
    <span className="flex items-center gap-x-px font-mono text-[9px] leading-none">
      {FEATURE_NAMES.map((feature) =>
        features[feature] ? (
          <span className="text-dev-600 dark:text-dev-400" key={feature}>
            {FEATURE_CODES[feature]}
          </span>
        ) : (
          <span className="text-dev-700/25 dark:text-dev-300/25" key={feature}>
            ·
          </span>
        ),
      )}
    </span>
  );
}

/**
 * Which of several dev instances this window is, for someone holding more than
 * one of them at once. A studio-drive purpose is the useful human description;
 * without one, the worktree, custom user data directory, and nonconventional
 * port provide the diagnostic identity.
 */
function instanceLabel({
  debugPort,
  drivePurpose,
  userData,
  worktree,
}: AppEnvironment) {
  if (drivePurpose) {
    return drivePurpose;
  }
  const where = [worktree, userData]
    .filter((part) => part !== undefined)
    .join("/");
  const port =
    debugPort === undefined || debugPort === PORTS.electronDebug
      ? undefined
      : debugPort.toString();
  return [where, port].filter((part) => part !== undefined && part).join(" ");
}

function ThemeToggle() {
  const { resolvedTheme, setTheme, theme } = useTheme();

  const next = resolvedTheme === "dark" ? "light" : "dark";
  // The icon reports what the theme actually is, so following the system reads
  // differently from being pinned to the same appearance.
  const ThemeIcon =
    theme === "system"
      ? MonitorIcon
      : resolvedTheme === "dark"
        ? MoonIcon
        : SunIcon;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          aria-label={`Switch to ${next} theme`}
          className={cn(controlClassName, "w-4 justify-center")}
          onClick={() => {
            setTheme(next);
          }}
          type="button"
        >
          <ThemeIcon className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Switch to {next}{" "}
        <span className="opacity-60">
          {formatAccelerator(SHORTCUTS.themeSystem.accelerator).join(" ")} for
          system
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
