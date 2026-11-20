import { FoldingTrail } from "@/client/components/window/folding-trail";
import { FolderMark } from "@/client/components/window/folder-mark";
import { isInside } from "@/client/components/window/host-path";
import { locationCrumbs } from "@/client/components/window/tab-location";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  hasFilesView,
  revealInFileManager,
  showInFolder,
  showInFolderLabel,
} from "@/client/lib/show-in-files";
import { toast } from "@/client/lib/toast";
import { cn, osConventions } from "@/client/lib/utils";
import { copyPathLabel } from "@/client/components/window/place-menu";
import { rpcClient } from "@/client/rpc/client";
import { expandHomePath } from "@instrument-org/shared";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";

/**
 * The mark between two folders of a path: a small solid triangle, as the
 * Finder's path bar draws it, sitting on the middle of the line.
 */
function PathSeparator({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn(
        "inline-block h-[0.5em] w-[0.36em] shrink-0 align-middle text-muted-foreground/70",
        className,
      )}
      fill="currentColor"
      viewBox="0 0 5 7"
    >
      <path d="M0.5 0.4 L4.6 3.5 L0.5 6.6 Z" />
    </svg>
  );
}

/** Puts a path on the clipboard, saying so when it could not. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    toast.error("Couldn't copy the path", { cause: error });
  }
}

/**
 * What can be done to one folder along a path: opening it, showing it in
 * the system's file manager when Files is what opens it, and copying its
 * path, named, since a folded part shows only its mark.
 */
function FolderPartMenu({
  hostPath,
  name,
}: {
  hostPath: string;
  name: string;
}) {
  return (
    <ContextMenuContent>
      <ContextMenuItem
        onClick={() => {
          void showInFolder(hostPath, { kind: "folder" });
        }}
      >
        {showInFolderLabel("folder")}
      </ContextMenuItem>
      {hasFilesView() ? (
        <ContextMenuItem
          onClick={() => {
            void revealInFileManager(hostPath);
          }}
        >
          {osConventions().showInFileManager}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => {
          void copyText(hostPath);
        }}
      >
        {copyPathLabel(name)}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Where a name may break onto the next line, after a space, hyphen, underscore or dot, as Finder breaks one. */
const BREAK_AFTER = /(?<=[-_.\s])/;

/**
 * A folder's path as a person reads it, the way Files' location bar names
 * it: from the place it is in (iCloud Drive, a disk, or the home folder by
 * its own name), then each folder, each with its mark and carets between.
 * Always one line: short of room it gives way as the Finder's path bar does
 * (`FoldingTrail`), and pointing at a folder shows its whole name. `wrap`
 * shows the whole of it instead, onto as many lines as it takes, for a place
 * whose point is to say where something is (Info, Activity's details).
 */
export function FolderTrail({
  className,
  lastHasMenu = true,
  muteParents = false,
  path,
  wrap = false,
}: {
  className?: string;
  /** Whether the last folder has a menu of its own; off where what it sits in already offers one for that folder. */
  lastHasMenu?: boolean;
  muteParents?: boolean;
  path: string;
  wrap?: boolean;
}) {
  const [isShort, setIsShort] = useState(false);
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const volumes = places.data?.volumes;
  const home = window.api.homeDir;
  const crumbs = locationCrumbs(
    { kind: "folder", path },
    { home, ...(volumes ? { volumes } : {}) },
  );
  const labels = crumbs.map((crumb) => crumb.label);
  const hostPath = expandHomePath(path, home);
  const Lead = placeIcon(hostPath, volumes);
  // Its room is padding rather than a gap, so the trail's measure of it
  // counts the room too.
  const separator = (
    <span aria-hidden className="flex shrink-0 px-1">
      <PathSeparator />
    </span>
  );
  const whole = labels.join(" › ");
  if (wrap) {
    // Plain text that breaks where Finder breaks a name: at spaces, and
    // after a hyphen, underscore or dot. Each mark between folders keeps to
    // the start of the name after it, so no line begins or ends on one. A
    // right click copies the path itself, which selecting the words would
    // give with the marks lost.
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <span
            aria-label={whole}
            className={cn("block min-w-0 select-text", className)}
          >
            {labels.map((label, at) => {
              const [first = "", ...rest] = label.split(BREAK_AFTER);
              return (
                <Fragment key={`${String(at)}:${label}`}>
                  {at > 0 ? <wbr /> : null}
                  <span className="whitespace-nowrap">
                    {at === 0 && Lead ? (
                      <Lead
                        aria-hidden
                        className="mr-1 inline size-3.5 align-[-0.15em]"
                      />
                    ) : null}
                    {at > 0 ? <PathSeparator className="mx-1" /> : null}
                    {first}
                  </span>
                  {rest.map((chunk, index) => (
                    // oxlint-disable-next-line react/no-array-index-key -- a name's pieces never move
                    <Fragment key={index}>
                      <wbr />
                      {chunk}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </span>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => {
              void showInFolder(hostPath, { kind: "folder" });
            }}
          >
            {showInFolderLabel("folder")}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              void copyText(hostPath);
            }}
          >
            Copy Path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  const trail = (
    <span
      aria-label={whole}
      className={cn(
        "flex min-w-0 cursor-default items-center select-text",
        className,
      )}
    >
      <FoldingTrail
        className="flex-1"
        labels={labels}
        mark={(at) => {
          const crumbPath = crumbs[at]?.path;
          return crumbPath === undefined ? null : (
            <FolderMark path={crumbPath} />
          );
        }}
        onShortChange={setIsShort}
        part={(at, content) => {
          const crumbPath = crumbs[at]?.path;
          const shown = (
            <span
              className={cn(
                "flex min-w-0 items-center",
                muteParents &&
                  at < labels.length - 1 &&
                  "text-muted-foreground",
              )}
            >
              {content}
            </span>
          );
          return crumbPath === undefined ||
            (!lastHasMenu && at === labels.length - 1) ? (
            shown
          ) : (
            <ContextMenu>
              <ContextMenuTrigger asChild>{shown}</ContextMenuTrigger>
              <FolderPartMenu
                hostPath={expandHomePath(crumbPath, home)}
                name={labels[at] ?? ""}
              />
            </ContextMenu>
          );
        }}
        separator={separator}
      />
    </span>
  );
  // Only a path that has given way says the whole of it, after a longer
  // rest than a tooltip takes, and under the path so it never covers the
  // folder a pointer is opening.
  return (
    <Tooltip delayDuration={1000}>
      <TooltipTrigger asChild>{trail}</TooltipTrigger>
      {isShort ? (
        <TooltipContent align="start" maxWidth="40rem" side="bottom">
          {whole}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

/**
 * The mark of the place a path starts at: the cloud or the drive for a place
 * the Files sidebar lists, the house for the home folder, or none.
 */
function placeIcon(
  path: string,
  volumes: { kind: string; path: string }[] = [],
): typeof HouseIcon | undefined {
  const home = window.api.homeDir;
  const place = volumes
    .filter((volume) => isInside(path, volume.path))
    .toSorted((a, b) => b.path.length - a.path.length)[0];
  // A place inside the home folder, iCloud Drive or a cloud service's folder,
  // starts the path; any other place holds the home folder, which does.
  const inPlace =
    place !== undefined &&
    (!isInside(path, home) ||
      (place.path !== home && isInside(place.path, home)));
  if (inPlace) {
    return place.kind === "cloud" ? CloudIcon : HardDriveIcon;
  }
  return isInside(path, home) ? HouseIcon : undefined;
}
