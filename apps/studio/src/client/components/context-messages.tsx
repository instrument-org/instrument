import { cn } from "@/client/lib/utils";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react";
import { memo, useMemo, useState } from "react";

import { CopyButton } from "./copy-button";
import { DevModeCard, DevModeCardHeader } from "./dev-mode-card";
import { ContextMessage } from "./session-context-message";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

export const ContextMessages = memo(function ContextMessages({
  messages,
}: {
  messages: SessionMessage.ContextWithParts[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const contextElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    for (const message of messages) {
      for (const [_, part] of message.parts.entries()) {
        if (part.type === "text") {
          if (part.state === "done" && part.text.trim() === "") {
            continue;
          }

          elements.push(
            <ContextMessage
              key={part.metadata.id}
              message={message}
              part={part}
            />,
          );
        }
      }
    }
    return elements;
  }, [messages]);

  const handleCopy = async () => {
    const allText = messages
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n");

    await navigator.clipboard.writeText(allText);
  };

  return (
    <DevModeCard className="mb-2">
      <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <button
              className="flex flex-1 items-center gap-2 text-left"
              type="button"
            >
              <DevModeCardHeader
                action={
                  <CaretDownIcon
                    className={cn(
                      "size-3 text-muted-foreground transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                }
                caption="System prompt"
              />
            </button>
          </CollapsibleTrigger>
          {isExpanded && (
            <CopyButton
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground disabled:opacity-50"
              iconSize={12}
              onCopy={handleCopy}
            />
          )}
        </div>

        <CollapsibleContent>
          <div className="mt-2 max-h-96 overflow-y-auto">
            <div className="flex flex-col gap-2">{contextElements}</div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </DevModeCard>
  );
});
