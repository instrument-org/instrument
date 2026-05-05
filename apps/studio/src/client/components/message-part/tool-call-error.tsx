import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CaretDownIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";

type ErrorPart = Extract<
  SessionMessagePart.ToolPart,
  { state: "output-error" }
>;

export function ToolCallError({ part }: { part: ErrorPart }) {
  const [isRawOpen, setIsRawOpen] = useState(false);

  const rawInput =
    typeof part.rawInput === "string" ? part.rawInput : undefined;
  const inputText = rawInput ?? (part.input ? JSON.stringify(part.input, null, 2) : undefined);
  const inputLabel = rawInput ? "Raw input" : "Input";

  return (
    <div className="group/card mt-2 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">
          Tool call failed
        </p>
      </div>

      {part.errorText && (
        <div className="relative">
          <div className="max-h-44 overflow-auto px-4 py-3 pr-10 scrollbar-color scrollbar-thin">
            <pre className="font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-destructive">
              {part.errorText}
            </pre>
          </div>
          <div className="absolute top-2 right-2">
            <CopyButton text={part.errorText} />
          </div>
        </div>
      )}

      {inputText && (
        <div className="border-t border-border">
          <button
            className={cn(
              "group/toggle flex w-full items-center gap-2 px-4 py-2.5",
              "text-xs text-muted-foreground transition-colors hover:text-foreground",
            )}
            onClick={() => { setIsRawOpen((v) => !v); }}
            type="button"
          >
            <CaretDownIcon
              className={cn(
                "size-3 shrink-0 transition-transform duration-150",
                isRawOpen && "rotate-180",
              )}
            />
            {inputLabel}
          </button>

          {isRawOpen && (
            <div className="relative border-t border-border">
              <div className="max-h-32 overflow-auto px-4 py-3 pr-10 scrollbar-color scrollbar-thin">
                <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                  {inputText}
                </pre>
              </div>
              <div className="absolute top-2 right-2">
                <CopyButton text={inputText} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
  };

  return (
    <ConfirmedIconButton
      className="size-5 shrink-0 p-0 text-muted-foreground/60 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 hover:text-foreground"
      icon={CopyIcon}
      onClick={handleCopy}
      successTooltip="Copied!"
      tooltip="Copy"
      variant="ghost"
    />
  );
}
