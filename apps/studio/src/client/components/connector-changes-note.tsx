import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { PlugsConnectedIcon } from "@phosphor-icons/react";

const VERB: Record<SessionMessageDataPart.ConnectorChange["change"], string> = {
  added: "added",
  disabled: "disabled",
  enabled: "connected",
  removed: "removed",
};

export function ConnectorChangesNote({
  data,
}: {
  data: SessionMessageDataPart.ConnectorChangesDataPart;
}) {
  if (data.connectors.length === 0) {
    return null;
  }

  const summary = data.connectors
    .map((c) => `${c.displayName} ${VERB[c.change]}`)
    .join(", ");

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70">
        <PlugsConnectedIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          {summary.charAt(0).toUpperCase() + summary.slice(1)}
        </span>
      </div>
    </div>
  );
}
