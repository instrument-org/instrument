import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";

import { getToolLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type ChoosePart = Extract<SessionMessagePart.ToolPart, { type: "tool-choose" }>;

export function ToolChoose({ part }: { part: ChoosePart }) {
  if (!part.input) {
    return null;
  }

  const hasOutput = part.state === "output-available";
  const selected = hasOutput ? part.output.selectedChoice : undefined;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("choose")}
        </p>
      </ToolCardHeader>

      <ToolCardSection maxHeight="max-h-64">
        <p className="mb-3 text-sm">{part.input.question}</p>
        <div className="space-y-1">
          {part.input.choices?.map((choice, index) => {
            const isSelected = choice === selected;
            return (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-sm",
                  isSelected
                    ? "bg-foreground/8 text-foreground"
                    : "text-muted-foreground",
                )}
                key={index}
              >
                <CheckIcon
                  className={cn(
                    "size-3 shrink-0",
                    isSelected ? "opacity-100" : "opacity-0",
                  )}
                />
                {choice}
              </div>
            );
          })}
        </div>
      </ToolCardSection>
    </ToolCard>
  );
}
