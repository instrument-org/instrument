import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
} from "./tool-card";

type TaskPart = Extract<SessionMessagePart.ToolPart, { type: "tool-task" }>;

const ACTION_LABELS = {
  new: "Started a task",
  send: "Sent a message to a task",
  stop: "Stopped a task",
} satisfies Record<"new" | "send" | "stop", string>;

export function ToolTask({ part }: { part: TaskPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input?.action || isStreaming) {
    return <ToolCardEmpty message="The task has not started yet." />;
  }

  const label = ACTION_LABELS[part.input.action];
  const output =
    part.state === "output-available" ? part.output.output : undefined;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {part.input.name ? `${label}: ${part.input.name}` : label}
        </p>
      </ToolCardHeader>

      {part.input.brief && (
        <ToolCardSection collapsedHeight={208} copyText={part.input.brief}>
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {part.input.brief}
          </p>
        </ToolCardSection>
      )}

      {output && (
        <ToolCardSection collapsedHeight={128} copyText={output}>
          <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {output}
          </pre>
        </ToolCardSection>
      )}
    </ToolCard>
  );
}
