import { openSettings } from "@/client/atoms/settings-modal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { TOPIC_COLORS } from "@/client/components/window/topic-colors";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_FLAVOR } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

type WorkspaceColor = RPCOutput["workspaces"]["current"]["color"];

/**
 * Each workspace color as the deep tier of the topic palette, so a workspace
 * reads in the same hues the app already uses to tell things apart. Hex rather
 * than utility classes: the app's theme defines no hue scales beyond its own.
 */
export const WORKSPACE_COLOR_HEX: Record<WorkspaceColor, string> = {
  blue: TOPIC_COLORS[13] ?? "#007fc3",
  gray: "var(--color-gray-400)",
  green: TOPIC_COLORS[11] ?? "#218b30",
  orange: TOPIC_COLORS[9] ?? "#b85300",
  pink: TOPIC_COLORS[15] ?? "#b2468a",
  purple: TOPIC_COLORS[14] ?? "#765fca",
  red: TOPIC_COLORS[8] ?? "#c0434c",
  teal: TOPIC_COLORS[12] ?? "#009178",
};

/**
 * Which app this window belongs to, when it is not plainly Instrument: a
 * preview build by its name, in the purple its icon wears, a platform API
 * server other than production by its name, in orange, and, in developer
 * mode, a workspace other than the default by its own name and color. The
 * build and server show whether or not developer mode is on, so a screenshot
 * or a glance always says what is running. The workspace waits for developer
 * mode: "default" is this computer's local id for it, so a folder synced from
 * another computer is never the default here. Nothing at all for the
 * shipping app on its default workspace. The workspace shows its folder on
 * hover and opens Storage's list of workspaces on a click. A
 * long name is cut short, with the whole of it in the tooltip, so the chip
 * never crowds the window's own buttons out of the bar.
 */
export function AppIdentityChip() {
  const isDeveloperMode = useDeveloperMode();
  const { data: workspace } = useQuery(
    rpcClient.workspaces.current.queryOptions(),
  );
  const { data: server } = useQuery(
    rpcClient.preferences.platformApiServer.queryOptions(),
  );
  const customWorkspace =
    isDeveloperMode && workspace !== undefined && !workspace.isDefault
      ? workspace
      : undefined;
  const serverLabel = server?.label;

  if (
    APP_FLAVOR.kind !== "preview" &&
    serverLabel === undefined &&
    customWorkspace === undefined
  ) {
    return null;
  }

  return (
    <div className="flex h-5 items-center gap-x-0.5 rounded-full bg-foreground/4 px-0.5 ring-1 ring-foreground/8 ring-inset">
      {APP_FLAVOR.kind === "preview" && (
        <Segment
          color={WORKSPACE_COLOR_HEX.purple}
          title={`Preview build: ${APP_FLAVOR.name}`}
        >
          Preview · {APP_FLAVOR.name}
        </Segment>
      )}
      {server !== undefined && serverLabel !== undefined && (
        <Segment
          color={WORKSPACE_COLOR_HEX.orange}
          title={`API server: ${server.baseUrl}`}
        >
          {serverLabel}
        </Segment>
      )}
      {customWorkspace !== undefined && (
        <WorkspaceSegment
          color={WORKSPACE_COLOR_HEX[customWorkspace.color]}
          name={customWorkspace.name}
        />
      )}
    </div>
  );
}

function WorkspaceSegment({ color, name }: { color: string; name: string }) {
  const { data: folder } = useQuery(rpcClient.workspaces.folder.queryOptions());
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="flex h-4 max-w-40 items-center rounded-full px-1.5 font-mono text-[9px] leading-none whitespace-nowrap"
          onClick={() => {
            openSettings({ setting: "workspaces", tab: "Storage" });
          }}
          style={segmentStyle(color)}
          type="button"
        >
          <span className="truncate">Workspace · {name}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent maxWidth="28rem" side="bottom">
        <div className="font-medium break-words">{name}</div>
        {folder !== undefined && (
          <div className="mt-0.5 break-all text-muted-foreground">
            {folder.path}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function segmentStyle(color: string) {
  return {
    backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
    color,
  };
}

function Segment({
  children,
  color,
  title,
}: {
  children: ReactNode;
  color: string;
  title: string;
}) {
  return (
    <span
      className="flex h-4 max-w-40 items-center rounded-full px-1.5 font-mono text-[9px] leading-none whitespace-nowrap"
      style={segmentStyle(color)}
      title={title}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
