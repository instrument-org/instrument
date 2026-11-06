import { toggleDeveloperStrip } from "@/client/atoms/developer-strip";
import { featuresAtom } from "@/client/atoms/features";
import { openSettings } from "@/client/atoms/settings-modal";
import { CopyButton } from "@/client/components/copy-button";
import {
  useIsSetupUp,
  useSetupState,
} from "@/client/components/setup/use-setup-state";
import { useTheme } from "@/client/components/theme-provider";
import { Popover, PopoverTrigger } from "@/client/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { WORKSPACE_COLOR_HEX } from "@/client/components/window/workspace-colors";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type FeatureName, FeatureNameSchema } from "@/shared/features";
import { SHORTCUTS } from "@/shared/shortcuts";
import { APP_FLAVOR, PORTS } from "@instrument-org/shared";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
import { MoonIcon } from "@phosphor-icons/react/Moon";
import { SunIcon } from "@phosphor-icons/react/Sun";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode } from "react";

import { ChatNotesMenu } from "./chat-notes-menu";
import { DeveloperErrors } from "./developer-errors";
import { StripHeading, StripPopover } from "./strip-popover";

type AppEnvironment = RPCOutput["debug"]["getAppEnvironment"];

const FEATURE_NAMES: readonly FeatureName[] = FeatureNameSchema.options;

const CELL_CLASS =
  "flex h-full items-center gap-1.5 px-2.5 whitespace-nowrap hover:bg-white/8 aria-expanded:bg-white/10";

/** Cells that give way first when the window is narrow. */
const ROOMY_CLASS = "hidden @3xl:flex";

/**
 * The band along the foot of the window in developer mode: which build this
 * is, what it talks to and reads from, and anything that went wrong, with what
 * a developer reaches for next. Each fact opens what it describes.
 */
export function DeveloperStrip({
  onOpenDebugPages,
}: {
  onOpenDebugPages?: () => void;
}) {
  const isSetupUp = useIsSetupUp();
  const setupState = useSetupState();
  // Finishing answers every step, but with no workspace the folder step stays
  // up whatever the record says (`currentSetupStep`), so until it places one
  // there is nothing to skip.
  const canSkipSetup = isSetupUp && setupState?.facts.hasWorkspace === true;
  const features = useAtomValue(featuresAtom);
  const { data: environment } = useQuery(
    rpcClient.debug.getAppEnvironment.queryOptions(),
  );
  const { data: appVersion } = useQuery(
    rpcClient.preferences.getAppVersion.queryOptions(),
  );
  const { data: workspace } = useQuery(
    rpcClient.workspaces.current.queryOptions(),
  );
  const { data: server } = useQuery(
    rpcClient.preferences.platformApiServer.queryOptions(),
  );
  const { mutate: toggleDevTools } = useMutation(
    rpcClient.debug.toggleDevTools.mutationOptions(),
  );
  const { mutate: skipSetup } = useMutation(
    rpcClient.setup.finish.mutationOptions(),
  );
  const { mutate: setDeveloperMode } = useMutation(
    rpcClient.preferences.setDeveloperMode.mutationOptions(),
  );

  const flagsOn = FEATURE_NAMES.filter((feature) => features[feature]).length;
  const isPackaged = environment?.isPackaged === true;
  const env = !isPackaged
    ? "development"
    : APP_FLAVOR.kind === "preview"
      ? "preview"
      : "production";
  const name =
    APP_FLAVOR.kind === "preview"
      ? APP_FLAVOR.name
      : environment && instanceLabel(environment);
  const version = isPackaged ? appVersion?.version : undefined;

  return (
    <div
      className="@container flex h-6 shrink-0 items-stretch border-t border-white/8 bg-ink pr-4 font-mono text-[11px] leading-none text-white/90"
      data-developer-strip
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex min-w-0 items-center gap-2 bg-white/12 pr-3 pl-4 hover:bg-white/16 aria-expanded:bg-white/20"
            style={
              env === "preview"
                ? {
                    backgroundColor: `color-mix(in oklab, ${WORKSPACE_COLOR_HEX.purple} 45%, transparent)`,
                  }
                : undefined
            }
            type="button"
          >
            <span className="font-medium whitespace-nowrap text-white">
              {env}
            </span>
            {environment?.driveColor !== undefined && (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: environment.driveColor }}
              />
            )}
            {name ? (
              <span className="truncate text-white/75">{name}</span>
            ) : null}
            {version !== undefined && (
              <span className="whitespace-nowrap text-white/60">{version}</span>
            )}
          </button>
        </PopoverTrigger>
        <StripPopover align="start" className="w-96">
          {environment && (
            <BuildDetails
              env={env}
              environment={environment}
              name={name}
              pinned={workspace?.pinned === true}
              version={version}
              workspace={workspace?.name}
            />
          )}
        </StripPopover>
      </Popover>
      {canSkipSetup && (
        <StripButton
          onClick={() => {
            skipSetup();
          }}
        >
          Skip setup
        </StripButton>
      )}
      <Fact
        className={ROOMY_CLASS}
        label="api"
        onClick={
          isSetupUp
            ? undefined
            : () => {
                openSettings({ setting: "api-server", tab: "Developer" });
              }
        }
        value={server?.label?.toLowerCase() ?? "production"}
      />
      <Fact
        className={ROOMY_CLASS}
        label="workspace"
        onClick={
          isSetupUp
            ? undefined
            : () => {
                openSettings({ setting: "workspaces", tab: "Storage" });
              }
        }
        value={workspace?.name ?? ""}
      />
      <div className="flex-1" />
      <ChatNotesMenu className={CELL_CLASS} />
      <Fact
        className={ROOMY_CLASS}
        label="flags"
        onClick={
          isSetupUp
            ? undefined
            : () => {
                openSettings({ tab: "Developer" });
              }
        }
        value={flagsOn.toString()}
      />
      {onOpenDebugPages && !isSetupUp && (
        <StripButton className={ROOMY_CLASS} onClick={onOpenDebugPages}>
          debug pages
        </StripButton>
      )}
      <StripButton
        className={ROOMY_CLASS}
        onClick={() => {
          toggleDevTools();
        }}
      >
        devtools
      </StripButton>
      <ThemeToggle />
      <DeveloperErrors />
      {!isSetupUp && (
        <button
          aria-label="Close developer strip"
          className="grid w-6 shrink-0 place-items-center border-l border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => {
            toggleDeveloperStrip();
            toast("Developer strip hidden", {
              action: {
                label: "Turn off developer mode",
                onClick: () => {
                  setDeveloperMode({ enabled: false });
                },
              },
            });
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Switches between light and dark; the icon reports what the theme actually is. */
function ThemeToggle() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";
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
          className={cn(CELL_CLASS, "text-white/75 hover:text-white")}
          onClick={() => {
            setTheme(next);
          }}
          type="button"
        >
          <ThemeIcon className="size-3.25" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Switch to {next}{" "}
        <span className="opacity-60">
          {formatAcceleratorText(SHORTCUTS.themeSystem.accelerator)} for system
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function Fact({
  className,
  label,
  onClick,
  value,
}: {
  className?: string;
  label: string;
  /** Opens where the fact is set, where the window can show it. */
  onClick?: () => void;
  value: string;
}) {
  return (
    <button
      className={cn(CELL_CLASS, "disabled:bg-transparent", className)}
      disabled={!onClick}
      onClick={onClick}
      type="button"
    >
      <span className="text-white/50">{label}</span>
      <span>{value}</span>
    </button>
  );
}

function StripButton({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(CELL_CLASS, "text-white/75 hover:text-white", className)}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function BuildDetails({
  env,
  environment,
  name,
  pinned,
  version,
  workspace,
}: {
  env: string;
  environment: AppEnvironment;
  name: string | undefined;
  pinned: boolean;
  version: string | undefined;
  workspace: string | undefined;
}) {
  const rows: [string, string | undefined][] = [
    ["env", env],
    ["build", environment.isPackaged ? "packaged" : "unpackaged"],
    ["name", APP_FLAVOR.kind === "preview" ? name : undefined],
    ["version", version],
    ["purpose", environment.drivePurpose],
    ["worktree", environment.worktree],
    ["workspace", workspace && `${workspace}${pinned ? " (pinned)" : ""}`],
    ["user data", environment.userDataPath],
    ["debug port", environment.debugPort?.toString()],
  ];
  const shown = rows.filter(
    (row): row is [string, string] => row[1] !== undefined && row[1] !== "",
  );
  return (
    <>
      <StripHeading
        end={
          <CopyButton
            className="size-5 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
            iconSize={12}
            onCopy={() =>
              navigator.clipboard.writeText(
                shown.map(([key, value]) => `${key}: ${value}`).join("\n"),
              )
            }
          />
        }
      >
        build
      </StripHeading>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-3">
        {shown.map(([key, value]) => (
          <div className="contents" key={key}>
            <span className="text-muted-foreground">{key}</span>
            <span className="break-all">{value}</span>
          </div>
        ))}
      </div>
    </>
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
