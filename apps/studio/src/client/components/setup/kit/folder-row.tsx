import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Button } from "@/client/components/ui/button";
import { nameOf } from "@/client/components/window/host-path";
import { displayPath } from "@/client/lib/path-utils";
import { cn } from "@/client/lib/utils";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { type ReactNode } from "react";

import { SetupRowButton } from "./setup-row";

/**
 * Where the Instrument folder will be: "Location" over a card with the
 * folder's path, from the home folder's own name, and Change at its end.
 * A note about the folder (`FolderNote`) goes inside the card, under the
 * path.
 */
export function FolderLocation({
  children,
  onChange,
  path,
}: {
  children?: ReactNode;
  onChange?: () => void;
  path: string;
}) {
  const shown = displayPath(path);
  const name = nameOf(path);
  const parent = shown.endsWith(name) ? shown.slice(0, -name.length) : "";
  return (
    <div className="flex w-140 max-w-full flex-col gap-1.5">
      <p className="pl-4 text-xs font-medium text-muted-foreground">Location</p>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <FileSystemFolderGlyph className="h-5.75 w-7.5 shrink-0" />
          <p className="flex min-w-0 flex-1 text-sm font-medium" title={shown}>
            <span className="truncate text-muted-foreground">{parent}</span>
            <span className="shrink-0 text-foreground">{name}</span>
          </p>
          {onChange && (
            <Button
              className="h-9 px-1 text-brand-700 dark:text-brand-300"
              onClick={onChange}
              variant="ghost"
            >
              Change
            </Button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The inset note under the folder's path: what Instrument found there or
 * what happened, and one thing to do about it.
 */
export function FolderNote({
  action,
  icon = <ShieldWarningIcon />,
  line,
  title,
}: {
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
  line: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="px-2 pb-2">
      <div className="flex items-center gap-4 rounded-2xl border border-black/5 bg-brown-100 px-4 py-3 dark:border-white/5 dark:bg-white/5">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-brown-300 text-brown-700 [&_svg]:size-5",
            "dark:bg-white/10 dark:text-brown-300",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-gray-600 dark:text-muted-foreground">
            {line}
          </p>
        </div>
        {action && (
          <SetupRowButton onClick={action.onClick}>
            {action.label}
          </SetupRowButton>
        )}
      </div>
    </div>
  );
}
