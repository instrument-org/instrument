import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { DestinationRow } from "@/client/components/instrument-folder";
import { type Destination } from "@/client/components/instrument-folder-steps";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { type ReactNode } from "react";

import { SetupRowButton } from "./setup-row";

/**
 * Where the Instrument folder will be: "Location" over a card with the
 * folder as the move confirmation draws it (`DestinationRow`) and Change at
 * its end. Without a `path` yet the card keeps its place with a blank line.
 * A note about the folder (`FolderNote`) goes inside the card, under the
 * path.
 */
export function FolderLocation({
  children,
  destination,
  onChange,
  path,
}: {
  children?: ReactNode;
  destination?: Destination | undefined;
  onChange?: () => void;
  path?: string | undefined;
}) {
  const change = onChange && (
    <Button
      className="h-9 px-1 text-brand-700 dark:text-brand-300"
      onClick={onChange}
      variant="ghost"
    >
      Change
    </Button>
  );
  return (
    <div className="flex w-140 max-w-full flex-col gap-1.5">
      <p className="pl-4 text-xs font-medium text-muted-foreground">Location</p>
      <div className="overflow-hidden rounded-2xl border bg-card">
        {path === undefined ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <FileSystemFolderGlyph className="h-5.75 w-7.5 shrink-0" />
            <span aria-hidden className="flex flex-1 py-0.75">
              <span className="h-3.5 w-56 rounded-xs bg-muted" />
            </span>
            {change}
          </div>
        ) : (
          <DestinationRow
            className="px-4"
            destination={destination}
            end={change}
            path={path}
            trailClassName="font-medium"
          />
        )}
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
          <p className="text-sm font-medium text-pretty text-foreground">
            {title}
          </p>
          <p className="text-xs/4.5 text-pretty text-gray-600 dark:text-muted-foreground">
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
