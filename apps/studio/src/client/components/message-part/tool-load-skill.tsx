import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel, getToolStreamingLabel } from "../../lib/tool-display";
import { SessionMarkdown } from "../session-markdown";
import { useToolCallSession } from "./tool-call-session";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type LoadSkillPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-load_skill" }
>;

export function ToolLoadSkill({ part }: { part: LoadSkillPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input) {
    return null;
  }

  const hasOutput = part.state === "output-available";
  const label = isStreaming
    ? getToolStreamingLabel("load_skill")
    : getToolLabel("load_skill");

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      <ToolCardSection maxHeight="max-h-64">
        <p className="mb-3 font-mono text-sm text-muted-foreground">
          {part.input.name}
        </p>
        {hasOutput && (
          <SessionMarkdown className="w-full" markdown={part.output.content} />
        )}
      </ToolCardSection>
    </ToolCard>
  );
}
