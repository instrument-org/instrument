import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CopyIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { filenameFromFilePath } from "../../lib/path-utils";
import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function FileChip({
  isEmphasized,
  part,
}: {
  isEmphasized: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  let filePath: string | undefined;

  if (
    (part.type === "tool-edit_file" ||
      part.type === "tool-write_file" ||
      part.type === "tool-read_file") &&
    // typeof guard is intentional: the AI SDK types DeepPartial<string> as
    // string during streaming, but parsePartialJson can produce null mid-stream.
    typeof part.input?.filePath === "string" &&
    part.input.filePath.length > 0
  ) {
    filePath = part.input.filePath;
  }

  if (!filePath) {
    return null;
  }

  const filename = filenameFromFilePath(filePath);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolChip className="max-w-[12rem] px-2" isEmphasized={isEmphasized}>
          <span className="truncate text-xs font-medium text-foreground/50">
            {filename}
          </span>
        </ToolChip>
      </TooltipTrigger>
      <TooltipContent>{filePath}</TooltipContent>
    </Tooltip>
  );
}

export function ToolCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group/card mt-2 overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolCardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border bg-muted px-4 py-3", className)}>
      {children}
    </div>
  );
}

export function ToolCardSection({
  borderBottom = false,
  children,
  copyText,
  maxHeight,
}: {
  borderBottom?: boolean;
  children: React.ReactNode;
  copyText?: string;
  maxHeight: string;
}) {
  return (
    <div className={cn("relative", borderBottom && "border-b border-border")}>
      <div
        className={cn(
          "scrollbar-thin scrollbar-color overflow-auto px-4 py-3",
          maxHeight,
        )}
      >
        {children}
      </div>
      {copyText && (
        <div className="absolute top-2 right-2">
          <ToolCardCopyButton text={copyText} />
        </div>
      )}
    </div>
  );
}

export function ToolChip({
  children,
  className,
  isEmphasized,
}: {
  children: ReactNode;
  className?: string;
  isEmphasized?: boolean;
}) {
  return (
    <span
      className={cn(
        "ml-1 flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1",
        isEmphasized ? "bg-foreground/10" : "bg-foreground/5",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ToolCardCopyButton({ text }: { text: string }) {
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
