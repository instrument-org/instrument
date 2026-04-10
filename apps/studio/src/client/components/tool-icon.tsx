import { type ToolName } from "@instrument-org/workspace/client";

import { TOOL_ICONS } from "../lib/tool-display";

export function ToolIcon({
  className,
  toolName,
}: {
  className?: string;
  toolName: ToolName;
}) {
  const Icon = TOOL_ICONS[toolName];

  if (!Icon) {
    return null;
  }

  return <Icon className={className} />;
}
