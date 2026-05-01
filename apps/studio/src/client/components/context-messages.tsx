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
            className="h-5 rounded-sm px-2 text-xs text-blue-700/80 hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-300/80 dark:hover:text-blue-300"
            variant="ghost"
          >
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-normal">
                View system prompt
              </span>
              {isExpanded && (
                <CaretDownIcon className="size-2 text-blue-700 dark:text-blue-300" />
              )}
            </div>
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="group mt-2">
          <div className="overflow-hidden rounded-r-md border-l-4 border-blue-700/50 bg-blue-500/5 dark:border-blue-300/50">
            <div className="border-b border-blue-700/20 bg-blue-500/15 px-4 py-2.5 pr-4 backdrop-blur-sm dark:border-blue-300/20">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <DeveloperModeBadge />
                <span className="text-[10px] leading-tight text-blue-700/75 dark:text-blue-300/75">
                  This panel only appears when developer mode is on.
                </span>
              </div>
              <p className="text-xs text-blue-700/80 italic dark:text-blue-300/80">
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
              className="rounded-sm p-1 text-blue-700/70 opacity-0 transition-colors group-hover:opacity-100 hover:bg-blue-500/10 hover:text-blue-700 disabled:opacity-50 dark:text-blue-300/70 dark:hover:text-blue-300"
              iconSize={12}
              onCopy={handleCopy}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
