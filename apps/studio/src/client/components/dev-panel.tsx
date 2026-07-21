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
import { cn, isMacOS } from "@/client/lib/utils";
import {
  componentPages,
  debugNavigationRoutes,
  onboardingScreens,
} from "@/client/routes/_app/debug/-debug-routes";
import { presetSessions } from "@/client/routes/_app/debug/-sessions";
import { rpcClient } from "@/client/rpc/client";
import { FEATURE_METADATA, type FeatureName } from "@/shared/features";
import { steppedZoom } from "@/shared/zoom";
import {
  ArrowLineDownIcon,
  ArrowsClockwiseIcon,
  ChartBarIcon,
  DatabaseIcon,
  type Icon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MonitorIcon,
  MoonIcon,
  NavigationArrowIcon,
  NotePencilIcon,
  SunIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
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
  { label: "/", to: "/" },
] as const satisfies { label: string; to: NavigateTo }[];

const pillTriggerClassName =
  "flex items-center gap-x-1 rounded-sm px-1.5 py-0.5" +
  " text-dev-700/50 hover:bg-dev-500/10 hover:text-dev-700/80 aria-expanded:bg-dev-500/10 aria-expanded:text-dev-700/80" +
  " dark:text-dev-300/50 dark:hover:bg-dev-400/10 dark:hover:text-dev-300/80 dark:aria-expanded:bg-dev-400/10 dark:aria-expanded:text-dev-300/80";

type Theme = "dark" | "light" | "system";

const THEME_OPTIONS = [
  { Icon: SunIcon, label: "Light", value: "light" },
  { Icon: MoonIcon, label: "Dark", value: "dark" },
  { Icon: MonitorIcon, label: "System", value: "system" },
] as const satisfies { Icon: Icon; label: string; value: Theme }[];

export function DevPanel() {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [showBreakpoint, setShowBreakpoint] = useState(false);
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

  const { data: appEnvironment } = useQuery(
    rpcClient.debug.getAppEnvironment.queryOptions(),
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

  const enabledFlagCount = Object.values(features).filter(Boolean).length;

  function handleNavigate(to: NavigateTo, search?: { session: string }) {
    // `to` is widened to the full route union here, so TS can't correlate it
    // with a per-route search schema the way a literal `to` would.
    void navigate({ search, to } as Parameters<typeof navigate>[0]);
  }

  if (hidden) {
    return null;
  }

  const envLabel = appEnvironment?.isPackaged === true ? "prod" : "dev";

  return (
    <>
      {crash && <CrashProbe />}
      <div className="flex items-center gap-x-1.5">
        <ThemeToggle />
        <Menubar className="h-auto gap-0 border-none bg-transparent p-0">
          <MenubarMenu>
            <MenubarTrigger className={pillTriggerClassName}>
              <span className="font-mono text-[9px] leading-none">
                {envLabel}
              </span>
              {enabledFlagCount > 0 && (
                <span className="rounded-sm bg-dev-500/20 px-1 py-px font-mono text-[9px] leading-none text-dev-600 tabular-nums dark:bg-dev-400/20 dark:text-dev-400">
                  {enabledFlagCount}
                </span>
              )}
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
              </div>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  Pages
                </MenubarSubTrigger>
                <MenubarSubContent>
                  {PAGES.map(({ label, to }) => (
                    <MenubarItem
                      className="font-mono text-xs"
                      key={to}
                      onSelect={() => {
                        handleNavigate(to);
                      }}
                    >
                      {label}
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
                        const isChatStreamPage = page.id === "chat-stream";
                        const isOnboardingPage = page.id === "onboarding";

                        if (isChatStreamPage) {
                          return (
                            <MenubarSub key={page.id}>
                              <MenubarSubTrigger className="font-mono text-xs">
                                {page.label}
                              </MenubarSubTrigger>
                              <MenubarSubContent>
                                {presetSessions.map((session) => (
                                  <MenubarItem
                                    className="font-mono text-xs"
                                    key={session.id}
                                    onSelect={() => {
                                      handleNavigate(page.to, {
                                        session: session.id,
                                      });
                                    }}
                                  >
                                    {session.name}
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
                  {enabledFlagCount > 0 && (
                    <span className="ml-1 font-mono text-[9px] text-dev-500/70 dark:text-dev-400/60">
                      {enabledFlagCount} enabled
                    </span>
                  )}
                </MenubarSubTrigger>
                <MenubarSubContent>
                  {(Object.keys(FEATURE_METADATA) as FeatureName[]).map(
                    (feature) => (
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
                      </MenubarCheckboxItem>
                    ),
                  )}
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarCheckboxItem
                checked={showBreakpoint}
                className="font-mono text-xs"
                onCheckedChange={setShowBreakpoint}
              >
                Show breakpoint
              </MenubarCheckboxItem>
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

        {showBreakpoint && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <span className="cursor-default font-mono text-[9px] leading-none text-dev-700/40 dark:text-dev-300/40">
                <span className="sm:hidden">&lt;sm</span>
                <span className="hidden sm:inline md:hidden">:sm</span>
                <span className="hidden md:inline lg:hidden">:md</span>
                <span className="hidden lg:inline xl:hidden">:lg</span>
                <span className="hidden xl:inline 2xl:hidden">:xl</span>
                <span className="hidden 2xl:inline">:2xl</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Tailwind breakpoint</TooltipContent>
          </Tooltip>
        )}
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

const THEME_SHORTCUTS: Record<Theme, string> = {
  dark: "D",
  light: "L",
  system: "M",
};

function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const mod = isMacOS() ? "⌘⇧" : "^⇧";

  return (
    <div className="flex items-center gap-x-0.5">
      {THEME_OPTIONS.map(({ Icon: OptionIcon, label, value }) => {
        const active = theme === value;

        return (
          <Tooltip delayDuration={300} key={value}>
            <TooltipTrigger asChild>
              <button
                aria-label={label}
                aria-pressed={active}
                className={cn(
                  "flex size-4 items-center justify-center rounded-sm transition-colors",
                  active
                    ? "bg-dev-500/15 text-dev-700/90 dark:bg-dev-400/15 dark:text-dev-300/90"
                    : "text-dev-700/40 hover:bg-dev-500/10 hover:text-dev-700/70 dark:text-dev-300/40 dark:hover:bg-dev-400/10 dark:hover:text-dev-300/70",
                )}
                onClick={() => {
                  setTheme(value);
                }}
                type="button"
              >
                <OptionIcon className="size-2.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {label}{" "}
              <span className="opacity-60">
                {mod}
                {THEME_SHORTCUTS[value]}
              </span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
