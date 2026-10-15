import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { FolderMark } from "@/client/components/window/folder-mark";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { Fragment } from "react";

type Place = { name: string; path: string };

/**
 * The folder's name in its section of the row, beside a file open from it,
 * as a menu: the folder and the ones above it, then the places, the way the
 * Mac's Save dialog names where it saves. Going up a level and going to
 * Downloads are the same press, and the file stays open either way.
 */
export function FolderNameMenu({
  ancestors,
  folder,
  onGo,
  places,
}: {
  /** The folders above this one, nearest first, up to the disk. */
  ancestors: Place[];
  /** The folder on screen; a path of "" is the recents. */
  folder: Place;
  /** A folder picked from the menu, by its path, or "" for the recents. */
  onGo: (path: string) => void;
  /** The sidebar's lists, in its order, each under its label if it has one. */
  places: { label?: string; places: Place[] }[];
}) {
  return (
    <DropdownMenu>
      <ToolbarTooltip label="Go to another folder">
        <DropdownMenuTrigger asChild>
          <Button
            className={toolbarClassName({
              className:
                "min-w-0 flex-1 justify-start gap-1 px-1.5 has-[>svg]:px-1.5 text-foreground data-[state=open]:bg-muted",
              pressed: false,
            })}
            size="sm"
            variant="ghost"
          >
            <FolderMark large path={folder.path} />
            <span className="min-w-0 truncate font-medium">{folder.name}</span>
            <CaretDownIcon className="size-2.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-56">
        <DropdownMenuItem disabled>
          <FolderMark large path={folder.path} />
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          <CheckIcon className="size-3.5" />
        </DropdownMenuItem>
        {ancestors.map((ancestor) => (
          <DropdownMenuItem
            key={ancestor.path}
            onSelect={() => {
              onGo(ancestor.path);
            }}
          >
            <FolderMark large path={ancestor.path} />
            <span className="min-w-0 truncate">{ancestor.name}</span>
          </DropdownMenuItem>
        ))}
        {places.map((list, index) => (
          <Fragment key={list.label ?? index}>
            <DropdownMenuSeparator />
            {list.label ? (
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {list.label}
              </DropdownMenuLabel>
            ) : null}
            {list.places.map((place) => (
              <DropdownMenuItem
                className={cn(place.path === folder.path && "bg-accent/60")}
                key={place.path}
                onSelect={() => {
                  onGo(place.path);
                }}
              >
                <FolderMark large path={place.path} />
                <span className="min-w-0 truncate">{place.name}</span>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
