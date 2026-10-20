import { formatByteSize } from "@/client/components/extend/file-system";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/** How full a disk is before its bar turns red, as File Explorer's does. */
const NEARLY_FULL = 0.9;

/**
 * Every disk on the computer, with how much of each is free: This PC on
 * Windows, the Finder's Computer, GNOME's Other Locations. A click selects a
 * disk and a double-click or Return opens it, as in the file managers.
 */
export function ComputerOverview({
  header,
  menu,
  onOpen,
  onOpenInNewTab,
  refreshInterval,
}: {
  /** The toolbar, where the page has no row of the window's to put its controls in. */
  header?: ReactNode;
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {drives.data ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto p-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelected(undefined);
            }
          }}
        >
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
            {drives.data.map((drive) => {
              const used =
                drive.space && drive.space.total > 0
                  ? 1 - drive.space.free / drive.space.total
                  : undefined;
              return (
                <li key={drive.path}>
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <button
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-foreground/5",
                          selected === drive.path &&
                            "bg-foreground/10 hover:bg-foreground/10",
                        )}
                        onAuxClick={(event) => {
                          if (event.button === 1) {
                            event.preventDefault();
                            onOpenInNewTab(drive.path);
                          }
                        }}
                        onClick={() => {
                          setSelected(drive.path);
                        }}
                        onContextMenu={() => {
                          setSelected(drive.path);
                        }}
                        onDoubleClick={() => {
                          onOpen(drive.path);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onOpen(drive.path);
                          }
                        }}
                        type="button"
                      >
                        <HardDriveIcon className="size-9 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium">
                            {drive.name}
                          </span>
                          {drive.space && used !== undefined ? (
                            <>
                              <span
                                aria-hidden="true"
                                className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
                              >
                                <span
                                  className={cn(
                                    "block h-full rounded-full",
                                    used >= NEARLY_FULL
                                      ? "bg-destructive"
                                      : "bg-primary",
                                  )}
                                  style={{ width: `${used * 100}%` }}
                                />
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {`${formatByteSize(drive.space.free) ?? ""} free of ${formatByteSize(drive.space.total) ?? ""}`}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    {menu(drive.path)}
                  </ContextMenu>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center" role="status">
          <Spinner className="size-5 text-muted-foreground" delay={1000} />
        </div>
      )}
    </div>
  );
}
