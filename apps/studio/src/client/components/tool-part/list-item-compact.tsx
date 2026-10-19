import { cn } from "@/client/lib/utils";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { type ReactNode } from "react";

export function ToolPartListItemCompact({
  icon,
  isExpanded,
  label,
  labelClassName,
  value,
}: {
  icon?: ReactNode;
  isExpanded?: boolean;
  label?: ReactNode;
  labelClassName?: string;
  value?: ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden text-xs/tight">
      {icon && (
        <span className="flex shrink-0 items-center text-accent-foreground/80">
          {icon}
        </span>
      )}
      <span
        className={cn(
          "shrink-0 font-medium text-foreground/80",
          labelClassName,
        )}
      >
        {label}
      </span>
      {value && (
        <span className="min-w-0 shrink-0 truncate text-foreground/60">
          {value}
        </span>
      )}
      <span className="ml-auto flex min-w-0 items-center gap-2">
        {isExpanded && (
          <span className="flex shrink-0 items-center text-accent-foreground/60">
            <CaretUpIcon className="size-3" />
          </span>
        )}
      </span>
    </div>
  );
}
