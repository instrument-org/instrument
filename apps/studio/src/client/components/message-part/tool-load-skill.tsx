import {
  type SessionMessagePart,
  toolLabel,
} from "@instrument-org/workspace/client";

import { SessionMarkdown } from "../session-markdown";
import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
} from "./tool-card";

type LoadSkillPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-load_skill" }
>;

export function ToolLoadSkill({ part }: { part: LoadSkillPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input || isStreaming) {
    return <ToolCardEmpty message="The skill has not arrived yet." />;
  }

  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;
  const notFoundOutput =
    part.state === "output-available" && part.output.state === "not-found"
      ? part.output
      : null;

  const label = notFoundOutput ? "Skill not found" : toolLabel("load_skill");
  const availableText =
    notFoundOutput && notFoundOutput.available.length > 0
      ? notFoundOutput.available
          .map((skill) => `${skill.name}: ${skill.description}`)
          .join("\n")
      : undefined;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      {successOutput && (
        <ToolCardSection collapsedHeight={208}>
          <SessionMarkdown
            className="w-full"
            headings="card"
            markdown={successOutput.content}
            size="xs"
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

      {notFoundOutput && (
        <ToolCardSection collapsedHeight={208} copyText={availableText}>
          <p className="text-sm text-muted-foreground">
            Skill{" "}
            <span className="font-mono text-foreground">
              {notFoundOutput.name}
            </span>{" "}
            was not found.
          </p>

          {notFoundOutput.available.length > 0 ? (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {notFoundOutput.available.map((skill) => (
                <div key={skill.name}>
                  <p className="font-mono text-sm text-foreground">
                    {skill.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {skill.description}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground italic">
              No skills are currently available.
            </p>
          )}
        </ToolCardSection>
      )}
    </ToolCard>
  );
}
