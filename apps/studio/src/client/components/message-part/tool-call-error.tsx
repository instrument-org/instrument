import { APP_NAME } from "@instrument-org/shared";
import {
  getToolNameByType,
  type SessionMessagePart,
  toolLabel,
} from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { useState } from "react";

import { useTabDeveloperMode } from "../../hooks/use-developer-mode";
import { getToolExplanation } from "../../lib/get-tool-explanation";
import { isCutOff } from "../../lib/is-cut-off";
import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { StepSentence } from "./step-sentence";

type ErrorPart = Extract<
  SessionMessagePart.ToolPart,
  { state: "output-error" }
>;

/**
 * A call that failed: one sentence saying so, with the error it came back
 * with under it for developer mode alone.
 */
export function ToolCallError({ part }: { part: ErrorPart }) {
  const isDeveloperMode = useTabDeveloperMode();
  return (
    <>
      <StepSentence>{failureSentence(part)}</StepSentence>
      {isDeveloperMode && <ErrorCard part={part} />}
    </>
  );
}

/** What went wrong, where the error says so plainly enough to repeat. */
function failureSentence(part: ErrorPart): string {
  const said = part.errorText;
  // The app's own words for a call that was stopped or cut off.
  if (said.startsWith("This action was ")) {
    return said;
  }
  if (/\bENOENT\b|no such file/iu.test(said)) {
    return "That file isn't there anymore.";
  }
  if (/\bEACCES\b|\bEPERM\b|permission denied/iu.test(said)) {
    return `${APP_NAME} doesn't have permission to do this.`;
  }
  if (/\bETIMEDOUT\b|timed out/iu.test(said)) {
    return "This took too long, so it was stopped.";
  }
  return "This step didn't work.";
}

function ErrorCard({ part }: { part: ErrorPart }) {
  const [isRawOpen, setIsRawOpen] = useState(false);

  // A string input is text the model sent that never parsed as JSON.
  const rawInput = typeof part.input === "string" ? part.input : undefined;
  const inputText =
    rawInput ?? (part.input ? JSON.stringify(part.input, null, 2) : undefined);
  const inputLabel = rawInput ? "Raw input" : "Input";
  // A call the app's closing cut off did not fail: it reads as the call it
  // was, with being cut off as where it stands.
  const cutOff = isCutOff(part);

  return (
    <div className="group/card my-2 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">
          {cutOff
            ? (getToolExplanation(part) ??
              toolLabel(getToolNameByType(part.type)))
            : "Tool call failed"}
        </p>
      </div>

      {part.errorText && (
        <div className="relative">
          <div className="max-h-44 scrollbar-thin scrollbar-color overflow-auto scroll-fade-y px-4 py-3 pr-10">
            <pre
              className={cn(
                "font-mono text-sm leading-relaxed break-words whitespace-pre-wrap",
                cutOff ? "text-muted-foreground" : "text-destructive",
              )}
            >
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
              "text-xs text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              setIsRawOpen((v) => !v);
            }}
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
              <div className="max-h-32 scrollbar-thin scrollbar-color overflow-auto scroll-fade-y px-4 py-3 pr-10">
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
