import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { FoldingTrail } from "@/client/components/window/folding-trail";
import { isInside } from "@/client/components/window/host-path";
import { locationCrumbs } from "@/client/components/window/tab-location";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { HouseIcon } from "@phosphor-icons/react/House";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";

import { SetupRowButton } from "./setup-row";

/**
 * Where the Instrument folder will be: "Location" over a card with the
 * folder's path on one line, from the home folder's own name after a small
 * house the way the Finder marks home, the folder's own name last and in
 * full, and Change at its end. A long path folds the folders in its middle,
 * the way the tab's location does, and the whole of it is a list on hover.
 * Without a `path` yet the card keeps its place with a blank line. A note
 * about the folder (`FolderNote`) goes inside the card, under the path.
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
  return (
    <div className="flex w-140 max-w-full flex-col gap-1.5">
      <p className="pl-4 text-xs font-medium text-muted-foreground">Location</p>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <FileSystemFolderGlyph className="h-5.75 w-7.5 shrink-0" />
          {path === undefined ? (
            <span aria-hidden className="flex flex-1 py-0.75">
              <span className="h-3.5 w-56 rounded-xs bg-muted" />
            </span>
          ) : (
            <FolderTrail path={path} />
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

/** The folder's path as its names, the folder's own name dark and never cut. */
function FolderTrail({ path }: { path: string }) {
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const labels = locationCrumbs(
    { kind: "folder", path },
    {
      home: window.api.homeDir,
      ...(places.data ? { volumes: places.data.volumes } : {}),
    },
  ).map((crumb) => crumb.label);
  const last = labels.length - 1;
  const slash = <span className="shrink-0 text-muted-foreground">/</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-w-0 flex-1 cursor-default items-center gap-1.5 text-sm font-medium select-none">
          {isInside(path, window.api.homeDir) && (
            <HouseIcon
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          <FoldingTrail
            className="flex-1"
            fold={() => (
              <span className="shrink-0 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                …
              </span>
            )}
            foldMark="…"
            labels={labels}
            part={(at) => (
              <Fragment key={`${String(at)}:${labels[at] ?? ""}`}>
                {at > 0 ? slash : null}
                <span
                  className={
                    at === last
                      ? "shrink-0 text-foreground"
                      : "max-w-max min-w-6 flex-1 truncate text-muted-foreground"
                  }
                >
                  {labels[at]}
                </span>
              </Fragment>
            )}
            separator={slash}
          />
        </span>
      </TooltipTrigger>
      {/* The whole path as a folder window's path menu shows it: each folder
        under the one before, the folder itself last. */}
      <TooltipContent align="start">
        <ol className="flex flex-col gap-0.5 py-0.5">
          {labels.map((label, at) => (
            <li
              className="flex items-center gap-1.5"
              key={`${String(at)}:${label}`}
              style={{ paddingLeft: `${String(at * 12)}px` }}
            >
              <FolderSimpleIcon
                aria-hidden
                className="size-3.5 shrink-0 opacity-70"
              />
              <span className={at === last ? "font-medium" : undefined}>
                {label}
              </span>
            </li>
          ))}
        </ol>
      </TooltipContent>
    </Tooltip>
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
