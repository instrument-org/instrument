import { APP_NAME } from "@instrument-org/shared";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react";
import { memo, useMemo, useState } from "react";

import { CopyButton } from "./copy-button";
import { ContextMessage } from "./session-context-message";
import { DeveloperModeBadge } from "./tool-part/developer-mode-badge";
import { Button } from "./ui/button";
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
    <Collapsible
      className="mb-2 w-full"
      onOpenChange={setIsExpanded}
      open={isExpanded}
    >
      <div className="flex justify-center">
        <CollapsibleTrigger asChild>
          <Button
            className="h-5 rounded-sm px-2 text-xs text-warning-foreground/80 hover:bg-warning/10 hover:text-warning-foreground"
            variant="ghost"
          >
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-normal">
                View system prompt
              </span>
              {isExpanded && (
                <CaretDownIcon className="size-2 text-warning-foreground" />
              )}
            </div>
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="group mt-2">
          <div className="overflow-hidden rounded-r-md border-l-4 border-warning-foreground/50 bg-warning/5">
            <div className="border-b border-warning-foreground/20 bg-warning/15 px-4 py-2.5 pr-4 backdrop-blur-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <DeveloperModeBadge />
                <span className="text-[10px] leading-tight text-warning-foreground/75">
                  This panel only appears when developer mode is on.
                </span>
              </div>
              <p className="text-xs text-warning-foreground/80 italic">
                Instructions given to the agent explaining how to work in{" "}
                {APP_NAME}.
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto px-4 py-2 pr-4">
              <div className="flex flex-col gap-2">{contextElements}</div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <CopyButton
              className="rounded-sm p-1 text-warning-foreground/70 opacity-0 transition-colors group-hover:opacity-100 hover:bg-warning/10 hover:text-warning-foreground disabled:opacity-50"
              iconSize={12}
              onCopy={handleCopy}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
