import { featuresAtom } from "@/client/atoms/features";
import { openLogin } from "@/client/atoms/login-modal";
import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import {
  ManageWorkspacesDialog,
  NewWorkspaceDialog,
  SwitchWorkspaceDialog,
  type SwitchTarget,
  WorkspaceMenu,
} from "@/client/components/dev-panel-workspaces";
import { useTheme } from "@/client/components/theme-provider";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
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
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  FEATURE_METADATA,
  type FeatureName,
  FeatureNameSchema,
  type Features,
} from "@/shared/features";
import { SHORTCUTS } from "@/shared/shortcuts";
import { PORTS } from "@instrument-org/shared";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { BugIcon } from "@phosphor-icons/react/Bug";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { EraserIcon } from "@phosphor-icons/react/Eraser";
import { EyeSlashIcon } from "@phosphor-icons/react/EyeSlash";
import { FastForwardIcon } from "@phosphor-icons/react/FastForward";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { SignInIcon } from "@phosphor-icons/react/SignIn";
import { SignOutIcon } from "@phosphor-icons/react/SignOut";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
import { MoonIcon } from "@phosphor-icons/react/Moon";
import { SunIcon } from "@phosphor-icons/react/Sun";
import { WarningOctagonIcon } from "@phosphor-icons/react/WarningOctagon";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { toast } from "@/client/lib/toast";

// Every control sits inside one hairline pill, so they share a height and read
// as a single object in the toolbar.
const controlClassName =
  "flex h-4 items-center rounded-full text-dev-700/60 hover:bg-foreground/8 hover:text-dev-700/90" +
  " aria-expanded:bg-foreground/10 aria-expanded:text-dev-700/90" +
  " dark:text-dev-300/60 dark:hover:text-dev-300/90 dark:aria-expanded:text-dev-300/90";

const pillTriggerClassName = `${controlClassName} gap-x-1.5 px-1.5`;

const FEATURE_NAMES: readonly FeatureName[] = FeatureNameSchema.options;

/** A heading over a run of the menu's items, in the panel's own mono. */
const sectionLabelClassName =
  "px-2 pt-1.5 pb-0.5 font-mono text-[9px] font-normal tracking-wide text-dev-500/70 uppercase dark:text-dev-400/60";

const itemClassName = "font-mono text-xs";

type AppEnvironment = RPCOutput["debug"]["getAppEnvironment"];

export function DevPanel() {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [crash, setCrash] = useState(false);
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

  const { mutate: simulateUpdatedNotice } = useMutation(
    rpcClient.debug.trigger.testUpdatedNotice.mutationOptions(),
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

  const [switchTarget, setSwitchTarget] = useState<null | SwitchTarget>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<
    "manage" | "new" | null
  >(null);

  const { mutate: skipOnboarding } = useMutation(
    rpcClient.debug.skipOnboarding.mutationOptions(),
  );

  const { data: currentWorkspace } = useQuery(
    rpcClient.workspaces.current.queryOptions(),
  );

  const isPackaged = appEnvironment?.isPackaged === true;

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
                <span className="flex items-center gap-x-1 font-mono text-[9px] leading-none text-dev-500/70 tabular-nums dark:text-dev-400/60">
                  {/* The dot this instance wears in its Dock icon's corner. */}
                  {appEnvironment?.driveColor !== undefined && (
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: appEnvironment.driveColor }}
                    />
                  )}
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
                {currentWorkspace !== undefined && (
                  <>
                    <span className="font-mono text-[9px] text-dev-500/60 dark:text-dev-400/50">
                      workspace
                    </span>
                    <span className="font-mono text-[9px] text-dev-700/80 dark:text-dev-300/70">
                      {currentWorkspace.name}
                      {currentWorkspace.pinned ? " (pinned)" : ""}
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
              {/* Past the first-run screens without a provider, which is a
                  state worth seeing too. Here rather than on those screens, so
                  their layout stays the one people get. */}
              {window.api.windowType === "onboarding" && (
                <>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      skipOnboarding();
                    }}
                  >
                    <FastForwardIcon className="size-3" />
                    Skip onboarding
                  </MenubarItem>
                  <MenubarSeparator />
                </>
              )}
              <MenubarItem
                className={itemClassName}
                onSelect={() => {
                  void navigate({ to: "/debug" });
                }}
              >
                <BugIcon className="size-3" />
                Debug pages
              </MenubarItem>
              <WorkspaceMenu
                onCreate={() => {
                  setWorkspaceDialog("new");
                }}
                onManage={() => {
                  setWorkspaceDialog("manage");
                }}
                onSwitch={setSwitchTarget}
              />
              <MenubarSub>
                <MenubarSubTrigger className={itemClassName}>
                  Open
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarLabel className={sectionLabelClassName}>
                    Folders
                  </MenubarLabel>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      openWorkspaceFolder();
                    }}
                  >
                    <FolderOpenIcon className="size-3" />
                    Workspace
                  </MenubarItem>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      openUserDataFolder();
                    }}
                  >
                    <FolderOpenIcon className="size-3" />
                    User data
                  </MenubarItem>
                  <MenubarSeparator />
                  <MenubarLabel className={sectionLabelClassName}>
                    Show
                  </MenubarLabel>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      openOnboarding();
                    }}
                  >
                    <AppWindowIcon className="size-3" />
                    Onboarding window
                  </MenubarItem>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      openLogin();
                    }}
                  >
                    <SignInIcon className="size-3" />
                    Sign-in dialog
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className={itemClassName}>
                  Simulate
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarLabel className={sectionLabelClassName}>
                    Updates
                  </MenubarLabel>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      simulateUpdateDownload(undefined);
                    }}
                  >
                    <ArrowLineDownIcon className="size-3" />
                    Downloading
                  </MenubarItem>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      simulateUpdateError(undefined);
                    }}
                  >
                    <WarningIcon className="size-3" />
                    Check fails
                  </MenubarItem>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      simulateNoUpdate(undefined);
                    }}
                  >
                    <CheckCircleIcon className="size-3" />
                    Up to date
                  </MenubarItem>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      simulateUpdatedNotice(undefined);
                    }}
                  >
                    <SparkleIcon className="size-3" />
                    Just updated
                  </MenubarItem>
                  <MenubarItem
                    className={itemClassName}
                    onSelect={() => {
                      clearUpdateBadge(undefined);
                    }}
                  >
                    <EraserIcon className="size-3" />
                    Clear badge
                  </MenubarItem>
                  <MenubarSeparator />
                  {/* States a dev run on this Mac never reaches by itself:
                      another platform's window buttons, and the prompt dev
                      builds skip when an agent is running at quit. */}
                  <MenubarLabel className={sectionLabelClassName}>
                    Always show
                  </MenubarLabel>
                  {isMacOS() && (
                    <MenubarCheckboxItem
                      checked={forceWindowControls}
                      className={itemClassName}
                      onCheckedChange={setForceWindowControls}
                      title="Draw the minimize, maximize, and close buttons Windows and Linux get, for checking the layout around them"
                    >
                      Windows-style buttons
                    </MenubarCheckboxItem>
                  )}
                  <MenubarCheckboxItem
                    checked={quitGuardForced?.forced ?? false}
                    className={itemClassName}
                    onCheckedChange={(forced) => {
                      setQuitGuardForced({ forced });
                    }}
                    title="Ask before quitting while an agent is running, which dev builds normally skip. Resets on relaunch; a rebuild while it is on waits on the dialog."
                  >
                    Quit prompt
                  </MenubarCheckboxItem>
                  <MenubarSeparator />
                  <MenubarItem
                    className={`${itemClassName} text-destructive focus:text-destructive`}
                    onSelect={() => {
                      // Trip the top-level ErrorBoundary in app-window.tsx by
                      // throwing during render (event-handler throws aren't caught
                      // by boundaries), verifying the shell-crash fallback + report.
                      setCrash(true);
                    }}
                  >
                    <WarningOctagonIcon className="size-3" />
                    Window crash
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger className={itemClassName}>
                  Flags
                  <FeatureFlagStrip features={features} />
                </MenubarSubTrigger>
                <MenubarSubContent>
                  {FEATURE_NAMES.map((feature) => (
                    <MenubarCheckboxItem
                      checked={features[feature]}
                      className={itemClassName}
                      key={feature}
                      onCheckedChange={(enabled) => {
                        setFeatureEnabled({ enabled, feature });
                      }}
                      title={FEATURE_METADATA[feature].description}
                    >
                      {FEATURE_METADATA[feature].title}
                      <span className="ml-auto pl-4 font-mono text-[9px] text-dev-500/70 dark:text-dev-400/60">
                        {FEATURE_METADATA[feature].code}
                      </span>
                    </MenubarCheckboxItem>
                  ))}
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarLabel className={sectionLabelClassName}>
                Developer mode
              </MenubarLabel>
              <MenubarItem
                className={itemClassName}
                onSelect={() => {
                  setHidden(true);
                }}
              >
                <EyeSlashIcon className="size-3" />
                Hide this panel
                <span className="ml-auto pl-4 text-[9px] text-dev-500/70 dark:text-dev-400/60">
                  until reload
                </span>
              </MenubarItem>
              <MenubarItem
                className={itemClassName}
                onSelect={() => {
                  setDeveloperMode({ enabled: false });
                  toast.dev("Developer mode is off");
                }}
              >
                <SignOutIcon className="size-3" />
                Turn off
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>

      <NewWorkspaceDialog
        onOpenChange={(open) => {
          setWorkspaceDialog(open ? "new" : null);
        }}
        open={workspaceDialog === "new"}
      />
      <SwitchWorkspaceDialog
        onOpenChange={(open) => {
          if (!open) {
            setSwitchTarget(null);
          }
        }}
        target={switchTarget}
      />
      <ManageWorkspacesDialog
        onOpenChange={(open) => {
          setWorkspaceDialog(open ? "manage" : null);
        }}
        open={workspaceDialog === "manage"}
      />
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
            {FEATURE_METADATA[feature].code}
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
