import { formatByteSize } from "@/client/components/extend/file-system";
import { folderGlyphUrl } from "@/client/components/icons/folder-glyph";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/** How full a disk is before its bar turns red, as File Explorer's does. */
const NEARLY_FULL = 0.9;

type Place = { name: string; path: string };

/**
 * The computer from the top: the person's own folders, every disk with how
 * much of it is free, and the folders cloud services keep in step. This PC on
 * Windows, the Finder's Computer, GNOME's Other Locations. A click selects a
 * place and a double-click or Return opens it, as in the file managers.
 */
export function ComputerOverview({
  clouds,
  folders,
  header,
  home,
  menu,
  onOpen,
  onOpenInNewTab,
  refreshInterval,
}: {
  clouds: Place[];
  /** Home first, then the folders the system keeps for each kind of thing. */
  folders: Place[];
  /** The toolbar, where the page has no row of the window's to put its controls in. */
  header?: ReactNode;
  home: string;
  menu: (path: string) => ReactNode;
  onOpen: (path: string) => void;
  onOpenInNewTab: (path: string) => void;
  refreshInterval: false | number;
}) {
  const drives = useQuery(
    rpcClient.workspace.computer.drives.queryOptions({
      refetchInterval: refreshInterval,
    }),
  );
  const [selected, setSelected] = useState<string>();
  const tile = (place: Place, mark: ReactNode, detail?: ReactNode) => (
    <li key={place.path}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-foreground/5",
              selected === place.path &&
                "bg-foreground/10 hover:bg-foreground/10",
            )}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onOpenInNewTab(place.path);
              }
            }}
            onClick={() => {
              setSelected(place.path);
            }}
            onContextMenu={() => {
              setSelected(place.path);
            }}
            onDoubleClick={() => {
              onOpen(place.path);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onOpen(place.path);
              }
            }}
            type="button"
          >
            <span className="flex size-10 shrink-0 items-center justify-center">
              {mark}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm font-medium">{place.name}</span>
              {detail}
            </span>
          </button>
        </ContextMenuTrigger>
        {menu(place.path)}
      </ContextMenu>
    </li>
  );
  const group = (label: string, tiles: ReactNode[]) =>
    tiles.length === 0 ? null : (
      <section className="flex flex-col gap-1.5">
        <h2 className="px-3 text-xs font-medium text-muted-foreground">
          {label}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-2 gap-y-1">
          {tiles}
        </ul>
      </section>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelected(undefined);
          }
        }}
      >
        {group(
          "Folders",
          folders.map((folder) =>
            tile(
              folder,
              folder.path === home ? (
                <HouseIcon className="size-9 text-muted-foreground" />
              ) : (
                // oxlint-disable-next-line @next/next/no-img-element -- The folder glyph is an inline SVG data URL.
                <img
                  alt=""
                  className="h-8 w-auto"
                  draggable={false}
                  src={folderGlyphUrl()}
                />
              ),
            ),
          ),
        )}
        {drives.data ? (
          group(
            "Drives",
            drives.data.map((drive) => {
              const used =
                drive.space && drive.space.total > 0
                  ? 1 - drive.space.free / drive.space.total
                  : undefined;
              return tile(
                drive,
                <HardDriveIcon className="size-9 text-muted-foreground" />,
                drive.space && used !== undefined ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
                    >
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          used >= NEARLY_FULL ? "bg-destructive" : "bg-primary",
                        )}
                        style={{ width: `${used * 100}%` }}
                      />
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {`${formatByteSize(drive.space.free) ?? ""} free of ${formatByteSize(drive.space.total) ?? ""}`}
                    </span>
                  </>
                ) : null,
              );
            }),
          )
        ) : (
          <div className="flex justify-center py-6" role="status">
            <Spinner className="size-5 text-muted-foreground" delay={1000} />
          </div>
        )}
        {group(
          "Cloud storage",
          clouds.map((cloud) =>
            tile(cloud, <CloudIcon className="size-9 text-muted-foreground" />),
          ),
        )}
      </div>
    </div>
  );
}
