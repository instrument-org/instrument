import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { featuresAtom } from "@/client/atoms/features";
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
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/client/components/ui/menubar";
import { rpcClient } from "@/client/rpc/client";
import { FEATURE_METADATA, type FeatureName } from "@/shared/features";
import { type StudioPath } from "@/shared/studio-path";
import {
  AppWindowIcon,
  BugIcon,
  ChartBarIcon,
  DatabaseIcon,
  MonitorIcon,
  MoonIcon,
  NavigationArrowIcon,
  SunIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { toast } from "sonner";

const PAGES = [
  { label: "/sign-in", to: "/sign-in" },
  { label: "/subscribe", to: "/subscribe" },
  { label: "/projects", to: "/projects" },
] as const satisfies { label: string; to: StudioPath }[];

const triggerClassName =
  "rounded-sm px-1.5 py-0.5 font-mono text-[10px]" +
  " text-blue-700/50 hover:bg-blue-500/10 hover:text-blue-700" +
  " aria-expanded:bg-blue-500/10 aria-expanded:text-blue-700" +
  " dark:text-blue-300/60 dark:hover:bg-blue-400/10 dark:hover:text-blue-300" +
  " dark:aria-expanded:bg-blue-400/10 dark:aria-expanded:text-blue-300";

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

  const enabledFlagCount = Object.values(features).filter(Boolean).length;

  function handleNavigate(to: StudioPath) {
    void navigate({ to });
  }

  if (hidden) {
    return null;
  }

  return (
    <div className="absolute right-0 bottom-0 rounded-tl-md border-t border-l border-blue-300/30 bg-blue-50/80 shadow-sm dark:border-blue-400/20 dark:bg-blue-950">
      <div className="flex items-center gap-x-2 px-3 py-1.5">
        <BugIcon className="size-3 shrink-0 text-blue-500/60 dark:text-blue-400" />

        <Menubar className="h-auto gap-0 border-none bg-transparent p-0">
          <MenubarMenu>
            <MenubarTrigger className={triggerClassName}>App</MenubarTrigger>
            <MenubarContent>
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
                  <MenubarSeparator />
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      handleNavigate("/debug");
                    }}
                  >
                    /debug
                  </MenubarItem>
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      handleNavigate("/evals");
                    }}
                  >
                    /evals
                  </MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem
                    className="font-mono text-xs"
                    onSelect={() => {
                      openOnboarding();
                    }}
                  >
                    <AppWindowIcon className="size-3" />
                    Onboarding window
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
                  Relaunch
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem
                    className="font-mono text-xs text-amber-600 dark:text-amber-400"
                    onSelect={() => {
                      setRelaunchDialogOpen(true);
                    }}
                  >
                    With new user folder...
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className={triggerClassName}>Theme</MenubarTrigger>
            <MenubarContent>
              <MenubarRadioGroup
                onValueChange={(v) => {
                  setTheme(v as "dark" | "light" | "system");
                }}
                value={theme}
              >
                <MenubarRadioItem className="font-mono text-xs" value="light">
                  <SunIcon className="size-3" />
                  Light
                </MenubarRadioItem>
                <MenubarRadioItem className="font-mono text-xs" value="dark">
                  <MoonIcon className="size-3" />
                  Dark
                </MenubarRadioItem>
                <MenubarRadioItem className="font-mono text-xs" value="system">
                  <MonitorIcon className="size-3" />
                  System
                </MenubarRadioItem>
              </MenubarRadioGroup>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className={triggerClassName}>
              Flags
              {enabledFlagCount > 0 && (
                <span className="ml-1 rounded-full bg-blue-500/20 px-1 py-px font-mono text-[9px] leading-none text-blue-700 tabular-nums dark:bg-blue-400/20 dark:text-blue-300">
                  {enabledFlagCount}
                </span>
              )}
            </MenubarTrigger>
            <MenubarContent>
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
            </MenubarContent>
          </MenubarMenu>
        </Menubar>

        <div className="ml-auto">
          <Menubar className="h-auto gap-0 border-none bg-transparent p-0">
            <MenubarMenu>
              <MenubarTrigger className="cursor-default rounded-sm p-0.5 text-blue-600/30 transition-colors hover:bg-blue-500/10 hover:text-blue-600 aria-expanded:bg-blue-500/10 aria-expanded:text-blue-600 dark:text-blue-400/40 dark:hover:bg-blue-400/10 dark:hover:text-blue-400 dark:aria-expanded:bg-blue-400/10 dark:aria-expanded:text-blue-400">
                <XIcon className="size-3" />
              </MenubarTrigger>
              <MenubarContent align="end">
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
        open={relaunchDialogOpen}
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
