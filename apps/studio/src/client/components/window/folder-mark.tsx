import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { OUTPUT_FOLDER_GLYPH_URL } from "@/client/components/icons/output-folder";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { OUTPUT_FOLDER } from "@/shared/computer-href";
import { expandHomePath, isHomeDir } from "@instrument-org/shared";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { useQuery } from "@tanstack/react-query";

/**
 * The mark a folder wears wherever it is named: the Finder's sidebar, a
 * tab, the row above a tab. Home is the house, the Instrument folder its own
 * folder, a disk the drive, a cloud service's folder the cloud, the recents
 * the clock, and any other folder the folder; one answer, so a place never wears two marks at once. Read against
 * the places the sidebar lists, from the same cache.
 *
 * `path` is the folder on the computer, `~` for home allowed; empty is the
 * recents, which are no folder. `large` is the sidebar's size, the rest the
 * size of a tab's or a row's mark.
 */
export function FolderMark({
  large = false,
  path,
}: {
  large?: boolean;
  path: string;
}) {
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const home = window.api.homeDir;
  const iconClassName = cn(
    "shrink-0 text-muted-foreground",
    large ? "size-4" : "size-3.5",
  );
  if (path === "") {
    return <ClockCounterClockwiseIcon className={iconClassName} />;
  }
  const hostPath = expandHomePath(path, home);
  if (isHomeDir(hostPath, home)) {
    return <HouseIcon className={iconClassName} />;
  }
  const place = [
    ...(places.data?.pinned ?? []),
    ...(places.data?.volumes ?? []),
  ].find((each) => each.path === hostPath);
  if (place?.kind === "drive") {
    return <HardDriveIcon className={iconClassName} />;
  }
  if (place?.kind === "cloud") {
    return <CloudIcon className={iconClassName} />;
  }
  const outputFolder =
    places.data?.pinned.find((each) => each.kind === "output")?.path ??
    expandHomePath(OUTPUT_FOLDER, home);
  return (
    <FileSystemFolderGlyph
      className={cn("w-auto shrink-0", large ? "h-3.5" : "h-3")}
      {...(hostPath === outputFolder ? { src: OUTPUT_FOLDER_GLYPH_URL } : {})}
    />
  );
}
