import { FoldingTrail } from "@/client/components/window/folding-trail";
import { isInside } from "@/client/components/window/host-path";
import { locationCrumbs } from "@/client/components/window/tab-location";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { expandHomePath } from "@instrument-org/shared";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

/**
 * A folder's path as a person reads it, the way Files' location bar names
 * it: from the place it is in (iCloud Drive, a disk, or the home folder by
 * its own name) with that place's mark, then each folder, with carets
 * between. On one line it folds the folders in its middle when it runs out of
 * room, keeping the place and the last names, and the whole of it is the
 * title; with `wrap` it runs onto as many lines as it needs, for a
 * confirmation where every folder should be seen.
 */
export function FolderTrail({
  className,
  path,
  wrap = false,
}: {
  className?: string;
  path: string;
  wrap?: boolean;
}) {
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const volumes = places.data?.volumes;
  const home = window.api.homeDir;
  const labels = locationCrumbs(
    { kind: "folder", path },
    { home, ...(volumes ? { volumes } : {}) },
  ).map((crumb) => crumb.label);
  const lead = (
    <PlaceMark path={expandHomePath(path, home)} volumes={volumes} />
  );
  // Its room is padding rather than a gap, so the trail's measure of it
  // counts the room too.
  const separator = (
    <span aria-hidden className="flex shrink-0 px-1">
      <CaretRightIcon className="size-2.5 text-muted-foreground/70" />
    </span>
  );
  const named = (at: number) => (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1",
        !wrap && at < labels.length - 1 && "max-w-max min-w-6 flex-1 truncate",
        !wrap && at === labels.length - 1 && "shrink-0",
      )}
    >
      {at === 0 ? lead : null}
      <span className={wrap ? "break-words" : "truncate"}>{labels[at]}</span>
    </span>
  );
  if (wrap) {
    return (
      <span
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-y-0.5 select-text",
          className,
        )}
        title={labels.join(" › ")}
      >
        {/* A caret goes onto the next line with the name after it, so no
          line ends on one. */}
        {labels.map((label, at) => (
          <span
            className="inline-flex min-w-0 items-center"
            key={`${String(at)}:${label}`}
          >
            {at > 0 ? separator : null}
            {named(at)}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span
      className={cn("flex min-w-0 items-center select-text", className)}
      title={labels.join(" › ")}
    >
      <FoldingTrail
        className="flex min-w-0 flex-1 items-center"
        fold={() => (
          <span className="shrink-0 rounded px-0.5 text-muted-foreground">
            …
          </span>
        )}
        foldMark="…"
        labels={labels}
        part={(at) => (
          <Fragment key={`${String(at)}:${labels[at] ?? ""}`}>
            {at > 0 ? separator : null}
            {named(at)}
          </Fragment>
        )}
        separator={separator}
      />
    </span>
  );
}

/**
 * The mark of the place a path starts at: the cloud or the drive for a place
 * the Files sidebar lists, the house for the home folder.
 */
function PlaceMark({
  path,
  volumes = [],
}: {
  path: string;
  volumes?: { kind: string; path: string }[] | undefined;
}) {
  const home = window.api.homeDir;
  const place = volumes
    .filter((volume) => isInside(path, volume.path))
    .toSorted((a, b) => b.path.length - a.path.length)[0];
  const className = "size-3.5 shrink-0";
  // A place inside the home folder, iCloud Drive or a cloud service's folder,
  // starts the path; any other place holds the home folder, which does.
  const inPlace =
    place !== undefined &&
    (!isInside(path, home) ||
      (place.path !== home && isInside(place.path, home)));
  if (inPlace && place.kind === "cloud") {
    return <CloudIcon aria-hidden className={className} />;
  }
  if (inPlace) {
    return <HardDriveIcon aria-hidden className={className} />;
  }
  return isInside(path, home) ? (
    <HouseIcon aria-hidden className={className} />
  ) : null;
}
