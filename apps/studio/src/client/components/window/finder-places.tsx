import { MiddleTruncate } from "@/client/components/middle-truncate";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { wantsNewWindow } from "@/client/hooks/use-open-target";
import { cn, osConventions } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { COMPUTER_ROOT, RECENTS_ROOT } from "@/shared/computer-href";
import { favoritePlaces, type FavoriteChanges } from "@/shared/favorite-places";
import { folderNameFromPath } from "@instrument-org/shared";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { memo, type ReactNode, useRef } from "react";

import { pressPlace } from "./drag/press-bookmark";
import { useFavoritesTarget } from "./favorites-drops";
import { PlaceMenu } from "./place-menu";
import { FolderMark } from "./folder-mark";

/** What a place's menu and the place lists do, steady for the life of the screen. */
type PlaceActions = {
  /** Files let go on a place of Favorites, moved or copied into its folder. */
  dropInto: (
    files: readonly { hostPath: string; isFolder: boolean }[],
    folder: string,
    how: { copies: boolean },
  ) => void;
  openInNewTab: (place: string) => void;
  openInNewWindow: (place: string) => void;
  /** Folders added, or rows moved, so Favorites' rows stand in `order`. */
  favoriteAt: (paths: readonly string[], order: readonly string[]) => void;
  rootTo: (folder: string) => void;
  /** A place's folder opened under a drag resting on it, or (`undefined`) the view put back. */
  spring: (folder: string | undefined) => void;
  /** Whether a place's folder may open under a drag resting on it. */
  springs: (folder: string) => boolean;
  removeFavorite: (place: string) => void;
};

/** The menu on a place in the sidebar. */
export function placeMenuOf(
  place: string,
  { actions, isFavorite }: { actions: PlaceActions; isFavorite: boolean },
) {
  return (
    <PlaceMenu
      hostPath={place}
      onOpenInNewTab={() => {
        actions.openInNewTab(place);
      }}
      onOpenInNewWindow={() => {
        actions.openInNewWindow(place);
      }}
      favorite={
        isFavorite
          ? {
              isFavorite,
              onToggle: () => {
                actions.removeFavorite(place);
              },
            }
          : undefined
      }
    />
  );
}

/**
 * The places beside the folder: the app's own, the favorites, and the
 * computer's disks. A component of its own, handed only what it shows and
 * steady actions, so moving the selection in the folder leaves it alone.
 * Kept by hand (`memo`): the React Compiler keeps none of the page's render
 * around it, which would draw the places again, and every menu on them, each
 * time the page draws.
 */
export const FinderPlaces = memo(function FinderPlaces({
  actions,
  defaults,
  folderHostPath,
  homePath,
  instrumentPlace,
  isComputer,
  isRecents,
  favoriteChanges,
  volumes,
}: {
  actions: PlaceActions;
  /** The system's places as the computer lists them, the Instrument folder among them. */
  defaults: RPCOutput["workspace"]["computer"]["places"]["favorites"];
  /** The folder on screen, the one place marked. */
  folderHostPath: string | undefined;
  homePath: string;
  instrumentPlace:
    | RPCOutput["workspace"]["computer"]["places"]["favorites"][number]
    | undefined;
  isComputer: boolean;
  isRecents: boolean;
  favoriteChanges: FavoriteChanges;
  volumes: RPCOutput["workspace"]["computer"]["places"]["volumes"];
}) {
  const favorites = favoritePlaces(
    defaults.filter((place) => place !== instrumentPlace),
    favoriteChanges,
    (place) => ({
      kind: "folder" as const,
      name: folderNameFromPath(place),
      path: place,
    }),
  );
  const placeMenu = (place: string, { isFavorite = false } = {}) =>
    placeMenuOf(place, { actions, isFavorite });
  const favoritesList = useRef<HTMLUListElement>(null);
  useFavoritesTarget({
    list: () => favoritesList.current,
    onInto: actions.dropInto,
    onFavorite: actions.favoriteAt,
    onSpring: actions.spring,
    springs: actions.springs,
  });
  return (
    <>
      {/* The app's own places, which nobody removes: what the person opened,
          and the folder Instrument keeps what it makes in. */}
      <PlaceList
        menu={(place) =>
          place === RECENTS_ROOT ? undefined : placeMenu(place)
        }
        onOpenInNewTab={actions.openInNewTab}
        onOpenInNewWindow={actions.openInNewWindow}
        onOpen={actions.rootTo}
        places={[
          {
            icon: (
              <ClockCounterClockwiseIcon className="size-4 text-muted-foreground" />
            ),
            isActive: isRecents,
            name: "Recents",
            path: RECENTS_ROOT,
          },
          ...(instrumentPlace
            ? [
                {
                  icon: <FolderMark size="large" path={instrumentPlace.path} />,
                  isActive: folderHostPath === instrumentPlace.path,
                  name: instrumentPlace.name,
                  path: instrumentPlace.path,
                },
              ]
            : []),
        ]}
      />
      <PlaceList
        label="Favorites"
        listRef={favoritesList}
        menu={(place) => placeMenu(place, { isFavorite: true })}
        onOpenInNewTab={actions.openInNewTab}
        onOpenInNewWindow={actions.openInNewWindow}
        onOpen={(folder) => {
          actions.rootTo(folder === homePath ? "~" : folder);
        }}
        favorites={favorites.map((place) => place.path)}
        places={favorites.map((place) => ({
          // The home folder wears the house it wears in the Finder, which
          // is what says the account-named folder is home.
          icon: <FolderMark size="large" path={place.path} />,
          isActive: folderHostPath === place.path,
          name: place.name,
          path: place.path,
        }))}
      />
      <PlaceList
        label="Locations"
        menu={(place) =>
          place === COMPUTER_ROOT ? undefined : placeMenu(place)
        }
        onOpenInNewTab={actions.openInNewTab}
        onOpenInNewWindow={actions.openInNewWindow}
        onOpen={actions.rootTo}
        places={[
          {
            icon: <MonitorIcon className="size-4 text-muted-foreground" />,
            isActive: isComputer,
            name: osConventions().computer,
            path: COMPUTER_ROOT,
          },
          ...volumes.map((volume) => ({
            icon: <FolderMark size="large" path={volume.path} />,
            isActive: folderHostPath === volume.path,
            name: volume.name,
            path: volume.path,
          })),
        ]}
      />
    </>
  );
});

function PlaceList({
  label,
  listRef,
  menu,
  onOpen,
  onOpenInNewTab,
  onOpenInNewWindow,
  places,
  favorites,
}: {
  /** Left out for the app's own places, which need no heading. */
  label?: string;
  /** The list of rows, for Favorites, which takes drops (`useFavoritesTarget`). */
  listRef?: React.Ref<HTMLUListElement>;
  /** What a right-click on a place offers; nothing where a place is not a folder. */
  menu?: (path: string) => ReactNode;
  onOpen: (path: string) => void;
  /** A middle click: the place in a tab of its own, waiting behind. */
  onOpenInNewTab: (path: string) => void;
  /** A click with Shift: the place in a window of its own. */
  onOpenInNewWindow?: (path: string) => void;
  places: {
    icon: ReactNode;
    isActive: boolean;
    name: string;
    path: string;
  }[];
  /** For Favorites, its rows' paths in order, which a row dragged out of the window leaves. */
  favorites?: readonly string[];
}) {
  return (
    <div>
      {label === undefined ? null : (
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
          {label}
        </p>
      )}
      <ul className="flex flex-col gap-px" ref={listRef}>
        {places.map((place) => (
          <PlaceRow
            key={place.path}
            menu={menu?.(place.path)}
            onOpen={onOpen}
            onOpenInNewTab={onOpenInNewTab}
            onOpenInNewWindow={onOpenInNewWindow}
            place={place}
            favorites={favorites}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * A place in the sidebar, which drags as a place, held by the pointer: a
 * link to Files at its folder, never the folder itself, so nothing is
 * handed out of the app to copy (`pressPlace`). It joins a strip as a tab,
 * goes on the bookmarks bar, moves along Favorites, or goes into a message as
 * its folder; a row of Favorites let go where nothing takes it leaves Favorites,
 * as in Finder's sidebar. The recents and the computer are no folder, and
 * stay put.
 */
function PlaceRow({
  menu,
  onOpen,
  onOpenInNewTab,
  onOpenInNewWindow,
  place,
  favorites,
}: {
  menu: ReactNode;
  onOpen: (path: string) => void;
  onOpenInNewTab: (path: string) => void;
  onOpenInNewWindow?: ((path: string) => void) | undefined;
  place: {
    icon: ReactNode;
    isActive: boolean;
    name: string;
    path: string;
  };
  favorites: readonly string[] | undefined;
}) {
  const isFolder = place.path !== RECENTS_ROOT && place.path !== COMPUTER_ROOT;
  return (
    <li
      {...(favorites
        ? {
            "data-favorite-name": place.name,
            "data-favorite-place": place.path,
          }
        : {})}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={menu === undefined}>
          <button
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-foreground/5 data-[state=open]:bg-foreground/5",
              place.isActive && "bg-foreground/8",
            )}
            onPointerDown={(event) => {
              if (isFolder) {
                pressPlace(event, {
                  name: place.name,
                  path: place.path,
                  ...(favorites ? { favorites } : {}),
                });
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onOpenInNewTab(place.path);
              }
            }}
            onClick={(event) => {
              if (onOpenInNewWindow && wantsNewWindow(event)) {
                onOpenInNewWindow(place.path);
              } else {
                onOpen(place.path);
              }
            }}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
              }
            }}
            type="button"
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {place.icon}
            </span>
            <MiddleTruncate text={place.name} />
          </button>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </li>
  );
}

/**
 * Puts the Finder's sidebar of places away and brings it back, the way the
 * tree beside a file is toggled.
 */
export function PlacesToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = isOpen ? "Hide the sidebar" : "Show the sidebar";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className={toolbarClassName({ className: "shrink-0", pressed: false })}
        onClick={onToggle}
        size="icon-sm"
        variant="ghost"
      >
        <SidebarSimpleIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
