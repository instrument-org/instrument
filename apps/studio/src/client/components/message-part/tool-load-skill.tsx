import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel } from "../../lib/tool-display";
import { SessionMarkdown } from "../session-markdown";
import { useToolCallSession } from "./tool-call-session";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type LoadSkillPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-load_skill" }
>;

export function ToolLoadSkill({ part }: { part: LoadSkillPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input || isStreaming) {
    return null;
  }

  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;

  const label = getToolLabel("load_skill");

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      {successOutput && (
        <ToolCardSection maxHeight="max-h-52">
          <SessionMarkdown
            className="w-full"
            markdown={successOutput.content}
          />

          {successOutput.files.length > 0 && (
            <div className="mt-4 space-y-1 border-t border-border pt-3">
              {successOutput.files.map((file) => (
                <p
                  className="font-mono text-xs text-muted-foreground"
                  key={file}
                >
                  {file}
                </p>
              ))}
              {successOutput.truncated && (
                <p className="font-mono text-xs text-muted-foreground/60">
                  (truncated)
                </p>
              )}
            </div>
          )}
        </ToolCardSection>
      )}
    </ToolCard>
  );
}
