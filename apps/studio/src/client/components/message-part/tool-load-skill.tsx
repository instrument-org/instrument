import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel } from "../../lib/tool-display";
import { SessionMarkdown } from "../session-markdown";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type LoadSkillPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-load_skill" }
>;

export function ToolLoadSkill({ part }: { part: LoadSkillPart }) {
  if (!part.input) {
    return null;
  }

  const hasOutput = part.state === "output-available";

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("load_skill")}
        </p>
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
