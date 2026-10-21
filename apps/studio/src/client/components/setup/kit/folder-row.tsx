import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Button } from "@/client/components/ui/button";
import {
  folderOf,
  isInside,
  nameOf,
} from "@/client/components/window/host-path";
import { displayPath } from "@/client/lib/path-utils";
import { cn } from "@/client/lib/utils";
import { HouseIcon } from "@phosphor-icons/react/House";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { type ReactNode } from "react";

import { SetupRowButton } from "./setup-row";

/**
 * Where the Instrument folder will be: "Location" over a card with the
 * folder's own name, where it is under that from the home folder's own
 * name, after a small house the way the Finder marks home, and Change at
 * its end. A long location gives way from its start,
 * so the folders nearest the name stay. Without a `path` yet the card
 * keeps its place with blank lines. A note about the folder (`FolderNote`)
 * goes inside the card, under the path.
 */
export function FolderLocation({
  children,
  onChange,
  path,
}: {
  children?: ReactNode;
  onChange?: () => void;
  path?: string;
}) {
  const parent = path === undefined ? undefined : folderOf(path);
  const location = parent === undefined ? undefined : displayPath(parent);
  const isUnderHome =
    parent !== undefined && isInside(parent, window.api.homeDir);
  return (
    <div className="flex w-140 max-w-full flex-col gap-1.5">
      <p className="pl-4 text-xs font-medium text-muted-foreground">Location</p>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <FileSystemFolderGlyph className="h-5.75 w-7.5 shrink-0" />
          {path === undefined ? (
            <span aria-hidden className="flex flex-1 flex-col gap-1.5 py-0.5">
              <span className="h-3.5 w-28 rounded-xs bg-muted" />
              <span className="h-3 w-48 rounded-xs bg-muted/70" />
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {nameOf(path)}
              </span>
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                {isUnderHome && (
                  <HouseIcon aria-hidden className="size-3 shrink-0" />
                )}
                {/* Right to left only to put the ellipsis at the start; the
                  path itself reads left to right. */}
                <span
                  className="truncate text-left [direction:rtl]"
                  title={displayPath(path)}
                >
                  <bdi dir="ltr">{location}</bdi>
                </span>
              </span>
            </span>
          )}
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
