import { TOPIC_COLORS } from "@/client/components/window/topic-colors";
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
 * preview build by its name, in the purple its icon wears, and a workspace
 * other than the default by its own name and color. Shown whether or not
 * developer mode is on, so a screenshot or a glance always says what is
 * running. Nothing at all for the shipping app on its default workspace. A
 * long name is cut short, with the whole of it in the tooltip, so the chip
 * never crowds the window's own buttons out of the bar.
 */
export function AppIdentityChip() {
  const { data: workspace } = useQuery(
    rpcClient.workspaces.current.queryOptions(),
  );
  const customWorkspace =
    workspace !== undefined && !workspace.isDefault ? workspace : undefined;

  if (APP_FLAVOR.kind !== "preview" && customWorkspace === undefined) {
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
      {customWorkspace !== undefined && (
        <Segment
          color={WORKSPACE_COLOR_HEX[customWorkspace.color]}
          title={`Workspace: ${customWorkspace.name}`}
        >
          {customWorkspace.name}
        </Segment>
      )}
    </div>
  );
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
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
        color,
      }}
      title={title}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
