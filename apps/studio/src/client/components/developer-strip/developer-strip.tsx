import { toggleDeveloperStrip } from "@/client/atoms/developer-strip";
import { featuresAtom } from "@/client/atoms/features";
import { openSettings } from "@/client/atoms/settings-modal";
import { CopyButton } from "@/client/components/copy-button";
import { useIsSetupUp } from "@/client/components/setup/use-setup-state";
import { Popover, PopoverTrigger } from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import { WORKSPACE_COLOR_HEX } from "@/client/components/window/workspace-colors";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  FEATURE_METADATA,
  type FeatureName,
  FeatureNameSchema,
} from "@/shared/features";
import { APP_FLAVOR, PORTS } from "@instrument-org/shared";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode } from "react";

import { DeveloperErrors } from "./developer-errors";
import { InkHeading, InkPopover } from "./ink-popover";

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
  const { mutate: setFeatureEnabled } = useMutation(
    rpcClient.features.setEnabled.mutationOptions(),
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
      className="@container flex h-6 shrink-0 items-stretch border-t border-white/8 bg-ink font-mono text-[11px] leading-none text-white/90"
      data-developer-strip
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex min-w-0 items-center gap-2 bg-white/12 px-3 hover:bg-white/16 aria-expanded:bg-white/20"
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
        <InkPopover align="start" className="w-96">
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
        </InkPopover>
      </Popover>
      {isSetupUp && (
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
                openSettings({ setting: "api-server", tab: "General" });
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
      <Popover>
        <PopoverTrigger asChild>
          <button className={cn(CELL_CLASS, ROOMY_CLASS)} type="button">
            <span className="text-white/50">flags</span>
            <span>{flagsOn}</span>
          </button>
        </PopoverTrigger>
        <InkPopover align="end" className="w-80">
          <InkHeading>flags</InkHeading>
          <div className="p-1">
            {FEATURE_NAMES.map((feature) => (
              <label
                className="flex min-h-8 items-center justify-between gap-4 px-2 py-1"
                key={feature}
                title={FEATURE_METADATA[feature].description}
              >
                <span>{FEATURE_METADATA[feature].title}</span>
                <Switch
                  checked={features[feature]}
                  onCheckedChange={(enabled) => {
                    setFeatureEnabled({ enabled, feature });
                  }}
                />
              </label>
            ))}
          </div>
        </InkPopover>
      </Popover>
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
      <InkHeading
        end={
          <CopyButton
            className="size-5 rounded-sm p-0.5 text-white/70 hover:bg-white/10 hover:text-white"
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
      </InkHeading>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-3">
        {shown.map(([key, value]) => (
          <div className="contents" key={key}>
            <span className="text-white/50">{key}</span>
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
