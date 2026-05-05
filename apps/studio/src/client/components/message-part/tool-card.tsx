import { CopyIcon } from "@phosphor-icons/react";

import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";

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
    <div
      className={cn(
        "border-b border-border bg-muted px-4 py-3",
        className,
      )}
    >
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
          "overflow-auto px-4 py-3 scrollbar-color scrollbar-thin",
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

export function ToolCardCopyButton({ text }: { text: string }) {
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
