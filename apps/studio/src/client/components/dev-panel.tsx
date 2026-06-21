import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { featuresAtom } from "@/client/atoms/features";
import { useTheme } from "@/client/components/theme-provider";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/client/components/ui/alert-dialog";
import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarRadioGroup, MenubarRadioItem, MenubarSeparator, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger } from "@/client/components/ui/menubar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { componentPages, debugNavigationRoutes, onboardingScreens } from "@/client/routes/_app/debug/-debug-routes";
import { presetSessions } from "@/client/routes/_app/debug/-sessions";
import { rpcClient } from "@/client/rpc/client";
import { FEATURE_METADATA, type FeatureName } from "@/shared/features";
import { type StudioPath } from "@/shared/studio-path";
import { ArrowLineDownIcon, ArrowsClockwiseIcon, BugIcon, ChartBarIcon, DatabaseIcon, MonitorIcon, MoonIcon, NavigationArrowIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { toast } from "sonner";

const PAGES = [
  { label: "/projects", to: "/projects" },
  { label: "/evals", to: "/evals" },
  { label: "/tutorial-task", to: "/tutorial-task" },
  { label: "/subscribe", to: "/subscribe" },
  { label: "/", to: "/" },
] as const satisfies { label: string; to: StudioPath }[];

const pillTriggerClassName =
  "flex items-center gap-x-1 rounded-sm px-1.5 py-0.5" +
  " text-dev-700/50 hover:bg-dev-500/10 hover:text-dev-700/80 aria-expanded:bg-dev-500/10 aria-expanded:text-dev-700/80" +
  " dark:text-dev-300/50 dark:hover:bg-dev-400/10 dark:hover:text-dev-300/80 dark:aria-expanded:bg-dev-400/10 dark:aria-expanded:text-dev-300/80";

export function DevPanel() {
  const navigate = useNavigate();
  const { setTheme, theme } = useTheme();
  const [hidden, setHidden] = useState(false);
  const setDevToolsPanel = useSetAtom(devToolsPanelAtom);

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

  const { mutate: showOverlayIdle } = useMutation(
    rpcClient.debug.showOverlayIdle.mutationOptions(),
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

  function handleNavigate(to: StudioPath, search?: { session: string }) {
    void navigate({ search, to });
  }

  if (hidden) {
    return null;
  }

  const envLabel = appEnvironment?.isPackaged === true ? "prod" : "dev";

  return (
    <div className="absolute right-0 bottom-0 rounded-tl-md border-t border-l border-dev-300/30 bg-dev-50 shadow-sm dark:border-dev-400/20 dark:bg-dev-950">
      <div className="flex items-center gap-x-1.5 px-2 py-1.5">
        <Menubar className="h-auto gap-0 border-none bg-transparent p-0">
          <MenubarMenu>
            <MenubarTrigger className={pillTriggerClassName}>
              <BugIcon className="size-2.5" />
              <span className="font-mono text-[9px] leading-none">
                {envLabel}
              </span>
              {enabledFlagCount > 0 && (
                <span className="rounded-sm bg-dev-500/20 px-1 py-px font-mono text-[9px] leading-none text-dev-600 tabular-nums dark:bg-dev-400/20 dark:text-dev-400">
                  {enabledFlagCount}
                </span>
              )}
            </MenubarTrigger>
            <MenubarContent align="end" side="top">
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
                  <MenubarSeparator />
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      handleNavigate("/debug/notifications");
                    }}
                  >
                    Debug page
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
                  Overlay
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      void rpcClient.studioOverlay.show.call({ kind: "login" });
                    }}
                  >
                    Login
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      void rpcClient.studioOverlay.show.call({
                        kind: "welcome",
                      });
                    }}
                  >
                    Welcome
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      void rpcClient.studioOverlay.show.call({
                        kind: "settings",
                      });
                    }}
                  >
                    Settings
                  </MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      void rpcClient.studioOverlay.show.call({ kind: "crash" });
                    }}
                  >
                    Simulate overlay error
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      showOverlayIdle();
                    }}
                  >
                    Simulate stuck idle view
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
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
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger className="font-mono text-xs">
                  {theme === "light" ? (
                    <>
                      <SunIcon className="size-3" />
                      Light
                    </>
                  ) : theme === "dark" ? (
                    <>
                      <MoonIcon className="size-3" />
                      Dark
                    </>
                  ) : (
                    "Theme"
                  )}
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarRadioGroup
                    onValueChange={(v) => {
                      setTheme(v as "dark" | "light" | "system");
                    }}
                    value={theme}
                  >
                    <MenubarRadioItem
                      className="font-mono text-xs"
                      value="light"
                    >
                      <SunIcon className="size-3" />
                      Light
                    </MenubarRadioItem>
                    <MenubarRadioItem
                      className="font-mono text-xs"
                      value="dark"
                    >
                      <MoonIcon className="size-3" />
                      Dark
                    </MenubarRadioItem>
                    <MenubarRadioItem
                      className="font-mono text-xs"
                      value="system"
                    >
                      <MonitorIcon className="size-3" />
                      System
                    </MenubarRadioItem>
                  </MenubarRadioGroup>
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
            </MenubarContent>
          </MenubarMenu>
        </Menubar>

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
          <TooltipContent side="top">Tailwind breakpoint</TooltipContent>
        </Tooltip>

        <div className="ml-auto">
          <Menubar className="h-auto gap-0 border-none bg-transparent p-0">
            <MenubarMenu>
              <MenubarTrigger className="cursor-default rounded-sm p-0.5 text-dev-600/30 transition-colors hover:bg-dev-500/10 hover:text-dev-600 aria-expanded:bg-dev-500/10 aria-expanded:text-dev-600 dark:text-dev-400/40 dark:hover:bg-dev-400/10 dark:hover:text-dev-400 dark:aria-expanded:bg-dev-400/10 dark:aria-expanded:text-dev-400">
                <XIcon className="size-3" />
              </MenubarTrigger>
              <MenubarContent align="end" side="top">
                <MenubarItem
                  className="font-mono text-xs"
                  onSelect={() => {
                    setHidden(true);
                  }}
                >
                  Hide
                </MenubarItem>
                <MenubarSeparator />
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
    </div>
  );
}
