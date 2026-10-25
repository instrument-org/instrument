import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { instrumentFolderGlyphUrl } from "@/client/components/icons/folder-glyph";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  useOutputFolder,
  useWorkspaceFolder,
} from "@/client/lib/output-folder";
import { expandHomePath, isHomeDir } from "@instrument-org/shared";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
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
 * recents, which are no folder. `size` is `large` in the sidebar, `row` beside
 * a settings row's two lines, and `small` for a tab or a one-line row.
 */
export function FolderMark({
  path,
  size = "small",
}: {
  path: string;
  size?: "large" | "row" | "small";
}) {
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const outputFolder = useOutputFolder();
  const workspace = useWorkspaceFolder();
  const home = window.api.homeDir;
  const iconClassName = cn(
    "shrink-0 text-muted-foreground",
    { large: "size-4", row: "size-6", small: "size-3.5" }[size],
  );
  if (path === "") {
    return <ClockCounterClockwiseIcon className={iconClassName} />;
  }
  if (path === COMPUTER_ROOT) {
    return <MonitorIcon className={iconClassName} />;
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
  return (
    <FileSystemFolderGlyph
      className={cn(
        "w-auto shrink-0",
        { large: "h-3.5", row: "h-5", small: "h-3" }[size],
      )}
      {...withSrc(
        instrumentFolderGlyphUrl(hostPath, { outputFolder, workspace }),
      )}
    />
  );
}

/**
 * The mark of a place that is many folders at once, like the folders other
 * apps keep or the caches: two folders, one behind the other, at the size of a
 * settings row's mark.
 */
export function FoldersMark() {
  return (
    <span className="relative inline-block h-5 w-7 shrink-0" aria-hidden="true">
      <FileSystemFolderGlyph className="absolute -top-0.5 left-1.5 h-4 w-auto opacity-60" />
      <FileSystemFolderGlyph className="absolute top-1 left-0 h-4 w-auto" />
    </span>
  );
}

/** A folder's own glyph as the image's source, when it has one. */
function withSrc(src: string | undefined) {
  return src === undefined ? {} : { src };
}
