import { FileTypeIcon } from "@/client/components/extend/file-system";
import { PlaceIcon } from "@/client/components/window/place-icons";
import { OpenInAppButton } from "@/client/components/open-in-app";
import { FolderMark } from "@/client/components/window/folder-mark";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { AppIcon } from "@/client/components/window/app-icon";
import { FoldingTrail } from "@/client/components/window/folding-trail";
import {
  PlaceMenu,
  usePlaceMenuProps,
} from "@/client/components/window/place-menu";
import {
  lookAtAtom,
  type LookTarget,
} from "@/client/components/window/look-at";
import { Omnibar } from "@/client/components/window/omnibar";
import {
  type OpenInAppTarget,
  openInAppTargetOfUrl,
} from "@/client/hooks/use-open-in-app";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { fileUrlOf } from "@/client/lib/file-url";
import { pageConnection } from "@/client/lib/page-connection";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type WindowShortcutId } from "@/shared/window-shortcuts";
import { expandHomePath } from "@instrument-org/shared";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { Fragment, type ReactNode, useState } from "react";

import {
  type LocationCrumb,
  locationCrumbs,
  type TabLocation,
} from "./tab-location";

/**
 * The row every tab wears: back, forward, a page's reload, home, and where
 * you are.
 *
 * It spans the pane rather than the window, which is the whole point of it.
 * History belongs to a tab: an arrow in the window bar would sit beside a
 * strip that means every tab and read as the window's, and back would be
 * something that could move you between tabs, which is the behavior this
 * replaces.
 *
 * The field says where you are in whatever terms the page has, and says it in
 * parts: the place itself last, and every place it sits under before it, each
 * of those a way there. So a file reaches its folder, an app page reaches Apps,
 * and a task reaches the work, without the row pretending to be a URL bar.
 */
export function TabLocationRow({
  canGoBack,
  canGoForward,
  fieldEnd,
  fillsTab = false,
  leading,
  location,
  onBack,
  onClose,
  onExpand,
  onForward,
  onSite,
  onVisit,
  reload,
  trailing,
}: {
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** What the page says about itself inside the field, at its end, ahead of the app that opens it: its zoom while not 100%. */
  fieldEnd?: ReactNode;
  /** Whether the row is over a screen that has the whole tab, where Quick Look's view of a file would be smaller than the one already up. */
  fillsTab?: boolean;
  /** What the page puts ahead of the row's own controls, at its far left: a toggle for a panel along the page's left edge. */
  leading?: ReactNode;
  location: TabLocation;
  /** Back through what the thing up has been at, drawn with forward; a row over a screen that is the tab's own route leaves both to the window's bar. */
  onBack?: () => void;
  /** Puts the view away, for a row over something shown large beside a chat; the thing stays with the chat. */
  onClose?: () => void;
  /** Grows what is shown into the larger view, for a row over something peeked at; in place of the file's own Expand. */
  onExpand?: () => void;
  onForward?: () => void;
  /** Where a site typed into the field goes on this tab, when not a new tab of its own. */
  onSite?: (url: string) => void;
  /** Where a screen typed into the field goes, for a row over a tab the router does not follow. */
  onVisit?: (href: string) => void;
  /** A page's reload, beside the arrows where a browser keeps it. */
  reload?: ReactNode;
  /** What this page can do with itself, held at the row's right edge. */
  trailing?: ReactNode;
}) {
  const openIn = openInAppTargetOf(location);
  const setLookAt = useSetAtom(lookAtAtom);
  // A file is drawn larger over the window; a page is already as large as
  // the tab, and a live site does not survive being lifted out of it.
  const lookTarget: LookTarget | undefined =
    location.kind === "file" && !fillsTab
      ? {
          kind: "file",
          tab: { hostPath: location.path, name: location.name },
        }
      : undefined;
  return (
    <div
      // A container, so what a screen or a page draws into the row can give
      // up its words for its mark when the row is narrow.
      className="@container/tabrow flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background px-2"
      data-tab-location=""
    >
      {leading}
      {onBack && onForward && (
        <>
          <TabRowControl
            chord="back"
            disabled={!canGoBack}
            icon={<CaretLeftIcon className="size-4" />}
            label="Back"
            onClick={onBack}
          />
          <TabRowControl
            chord="forward"
            disabled={!canGoForward}
            icon={<CaretRightIcon className="size-4" />}
            label="Forward"
            onClick={onForward}
          />
        </>
      )}
      {reload}
      {/* The box is the field everywhere the place itself is not: a press on
        one of the places you are under goes there, and a press anywhere else,
        edge to edge, puts the caret in the input the way a browser's address
        bar does. */}
      <div
        className={cn(
          "group/field relative flex h-7 min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-border bg-card px-3 text-xs shadow-xs-soft focus-within:border-foreground/30",
          // The app's icon sits in the field's round end, with room to
          // breathe inside the curve.
          openIn && "pr-2",
        )}
        onPointerDown={(event) => {
          // Only a primary press edits: a right press on the place is its menu.
          if (
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest("button"))
          ) {
            return;
          }
          const input = event.currentTarget.querySelector("input");
          if (input && event.target !== input) {
            event.preventDefault();
            input.focus();
          }
        }}
      >
        <Omnibar
          initial={locationText(location)}
          key={locationText(location)}
          location={location}
          {...(onSite ? { onSite } : {})}
          {...(onVisit ? { onVisit } : {})}
          resting={
            location.kind === "newTab" ? undefined : (
              <Field location={location} />
            )
          }
        />
        {fieldEnd}
        {openIn && <OpenInAppButton target={openIn} />}
      </div>
      {trailing}
      {/* The file up at the size Quick Look gives it, over the window,
        unless the row's own Expand grows what is shown instead. */}
      {(onExpand ?? lookTarget) && (
        <TabRowControl
          disabled={false}
          icon={<ArrowsOutSimpleIcon className="size-4" />}
          label="Expand"
          onClick={() => {
            if (onExpand) {
              onExpand();
            } else if (lookTarget) {
              setLookAt(lookTarget);
            }
          }}
        />
      )}
      {onClose && (
        <TabRowControl
          disabled={false}
          icon={<XIcon className="size-4" />}
          label="Close"
          onClick={onClose}
        />
      )}
    </div>
  );
}

/**
 * One of the row's own controls: a mark, what it is called, and what it
 * does, with the chord that does the same in the tooltip where it has one.
 */
export function TabRowControl({
  chord,
  disabled,
  icon,
  label,
  onClick,
}: {
  chord?: WindowShortcutId;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <ToolbarTooltip chord={chord} label={label}>
      <button
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md",
          disabled
            ? "text-foreground/25"
            : "text-foreground/60 hover:bg-foreground/8 hover:text-foreground",
        )}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {icon}
      </button>
    </ToolbarTooltip>
  );
}

/** The mark and the words, which is all that changes between page types. */
function Field({ location }: { location: TabLocation }) {
  // The disks the sidebar lists, which name where a path outside the home
  // folder starts. Asked for only where a path is on screen, and answered
  // from the same cache the folder browser reads.
  const places = useQuery(
    rpcClient.workspace.computer.places.queryOptions({
      enabled: location.kind === "file" || location.kind === "folder",
    }),
  );
  const gesturesFor = useGesturesFor();
  const placeMenuProps = usePlaceMenuProps();
  const crumbs = locationCrumbs(location, {
    home: window.api.homeDir,
    ...(places.data ? { volumes: places.data.volumes } : {}),
  });
  if (location.kind === "newTab") {
    return (
      <>
        {locationMark(location)}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Search, open a file, or ask
        </span>
      </>
    );
  }
  if (location.kind === "page") {
    // An address is one thing you type rather than a trail you walk, so it is
    // said whole: the host quiet, the part of it you are reading loud.
    const { host, rest } = splitUrl(location.url);
    return (
      <>
        <ConnectionBadge url={location.url} />
        <span className="min-w-0 flex-1 truncate select-text">
          <span className="text-muted-foreground">{host}</span>
          {rest}
        </span>
      </>
    );
  }
  const separator = (
    <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
  );
  const crumbAt = (crumb: LocationCrumb, index: number) => {
    const gestures = crumb.to ? gesturesFor(crumb.to) : undefined;
    const open = gestures?.destinations.find(
      (destination) => destination.id === "open",
    );
    const isHere = index === crumbs.length - 1;
    // Several picked read as a count, set apart from the folder it is in.
    const isCount =
      isHere && location.kind === "folder" && location.picked !== undefined;
    // Where you are keeps its whole name. The walk down to it gives its
    // letters up as the box narrows, each part on its own: an equal
    // share of what is left over, never more than its name needs and
    // never narrower than the mark saying a name was cut. So the short
    // names stay whole while the long ones shorten, which is the shape a
    // folder window's path takes and the one a person reads a path by.
    // A name no longer than the mark (`~`, `/`) has nothing to give up,
    // and held to the mark's width it would stand in a gap wider than
    // itself: it keeps its own width instead.
    const size = isHere
      ? cn(
          "max-w-full shrink-0 truncate",
          isCount && "rounded-md bg-foreground/8 font-medium",
        )
      : crumb.label.length <= 2
        ? "shrink-0"
        : "min-w-6 max-w-max flex-1 truncate";
    // A part of a path on the computer offers what the sidebar offers for a
    // place, the last one included: a press there still opens the field, and
    // its pill shows only while its menu is up.
    const menu =
      crumb.path === undefined || isCount ? undefined : (
        <PlaceMenu
          {...placeMenuProps(
            crumb.path,
            isHere && location.kind === "file" ? "file" : "folder",
          )}
        />
      );
    const part = open ? (
      <button
        className={cn(
          "cursor-default rounded px-1 py-0.5 text-muted-foreground group-hover/field:text-foreground/70 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground",
          size,
        )}
        onAuxClick={gestures?.onAuxClick}
        onClick={() => {
          open.run();
        }}
        {...(menu ? {} : { onContextMenu: gestures?.onContextMenu })}
        type="button"
      >
        {crumb.label}
      </button>
    ) : (
      <span
        className={cn(
          "px-1 select-text",
          size,
          // A part with nowhere to go, before the last, is a place
          // the window cannot open: it reads as the lead it is.
          !isHere && "text-muted-foreground",
          menu && "rounded data-[state=open]:bg-foreground/8",
        )}
      >
        {crumb.label}
      </span>
    );
    return (
      <Fragment key={`${index}:${crumb.label}`}>
        {index > 0 ? separator : null}
        {menu ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{part}</ContextMenuTrigger>
            {menu}
          </ContextMenu>
        ) : (
          part
        )}
      </Fragment>
    );
  };
  return (
    <>
      {locationMark(location)}
      {/* The parts pulled out to the box's own edge, so the place reads from
          where it read before there was anything to press. */}
      <FoldingTrail
        className="-mx-1 flex-1"
        fold={(indexes) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Folders along the path"
                className="shrink-0 cursor-default rounded px-1 py-0.5 text-muted-foreground group-hover/field:text-foreground/70 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8"
                type="button"
              >
                <DotsThreeIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              {indexes.map((at) => {
                const crumb = crumbs[at];
                if (!crumb) {
                  return null;
                }
                const open = crumb.to
                  ? gesturesFor(crumb.to).destinations.find(
                      (destination) => destination.id === "open",
                    )
                  : undefined;
                return (
                  <DropdownMenuItem
                    disabled={!open}
                    key={`${at}:${crumb.label}`}
                    onSelect={() => {
                      open?.run();
                    }}
                  >
                    {crumb.path === undefined ? null : (
                      <FolderMark size="large" path={crumb.path} />
                    )}
                    <span className="min-w-0 truncate">{crumb.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        foldMark={
          <span className="px-1 py-0.5">
            <DotsThreeIcon className="size-4" />
          </span>
        }
        labelClassName="px-1"
        labels={crumbs.map((crumb) => crumb.label)}
        part={(at) => {
          const crumb = crumbs[at];
          return crumb ? crumbAt(crumb, at) : null;
        }}
        separator={separator}
      />
    </>
  );
}

/**
 * What a page's address says about its connection, where a browser says it:
 * nothing for an encrypted page, since a lock is true of a lookalike site
 * too; Not secure ahead of the address for plain http and for a site whose
 * refused certificate the person let through; and only a mark for plain
 * http to this computer, which never crosses the network but is no more
 * encrypted for it. A press on either is the reason, in Chromium's words.
 */
function ConnectionBadge({ url }: { url: string }) {
  const [isOpen, setOpen] = useState(false);
  useCloseOnWindowBlur(isOpen, () => {
    setOpen(false);
  });
  const { data: certificateExceptions } = useQuery(
    rpcClient.browser.live.certificateExceptions.experimental_liveOptions(),
  );
  const connection = pageConnection(url, certificateExceptions);
  if (connection === "secure") {
    return null;
  }
  const isLocal = connection === "local";
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger
        aria-label="Connection is not secure"
        className={cn(
          "-ml-1.5 flex h-5 shrink-0 cursor-default items-center gap-1 rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8",
          isLocal ? "w-5 justify-center" : "pr-2 pl-1.5",
        )}
      >
        {isLocal ? (
          <InfoIcon className="size-3.5" />
        ) : (
          <>
            <WarningIcon className="size-3.5" />
            Not secure
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <WarningIcon className="size-4 shrink-0 text-warning-700" />
          Your connection to this site is not secure
        </p>
        <p className="mt-1.5 text-muted-foreground">
          {connection === "certificate"
            ? "You chose to continue even though this site’s certificate isn’t valid, so someone could be pretending to be it."
            : "You should not enter any sensitive information on this site (for example, passwords or credit cards), because it could be stolen by attackers."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** What the place is drawn with, ahead of its name. */
function locationMark(location: TabLocation): ReactNode {
  switch (location.kind) {
    case "app": {
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center [&_img]:size-3.5 [&_svg]:size-3.5">
          <AppIcon
            icon={location.icon}
            name={location.name}
            site={location.site}
            size="sm"
          />
        </span>
      );
    }
    case "apps": {
      return (
        <PlaceIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          place="apps"
        />
      );
    }
    case "chat": {
      return (
        <ChatCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    case "file": {
      // A file wears its own type's mark, the way a site wears a favicon: it
      // is the one thing about a file you can tell before opening it.
      return <FileTypeIcon className="size-4" fileName={location.name} />;
    }
    case "folder": {
      return <FolderMark path={location.path} />;
    }
    case "newTab": {
      return (
        <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    // A page says nothing about its connection unless it is bad news; see
    // ConnectionBadge.
    case "page": {
      return null;
    }
    // A task is under the list it was opened from, the way an app page is
    // under Apps: the list wears the mark the chat's menu opens it with, and
    // one task a single box of it.
    case "task": {
      return (
        <CheckSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    case "tasks": {
      return (
        <ListChecksIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
  }
}

/** What the field holds when it is edited: the place, in words that can be typed over. */
function locationText(location: TabLocation) {
  switch (location.kind) {
    case "app": {
      return location.name;
    }
    case "apps": {
      return "Apps";
    }
    case "chat": {
      return location.title;
    }
    // A page of a file is at its `file://` address, the one a browser opens
    // it at, so it carries over to one as it stands.
    case "file": {
      return location.asPage
        ? fileUrlOf(location.path)
        : expandHomePath(location.path, window.api.homeDir);
    }
    // Written out in full, since a path from the home folder's name is not
    // one the field can open.
    case "folder": {
      return location.path === COMPUTER_ROOT
        ? ""
        : expandHomePath(location.path, window.api.homeDir);
    }
    case "newTab": {
      return "";
    }
    case "page": {
      return location.url;
    }
    case "task": {
      return location.title;
    }
    case "tasks": {
      return "Tasks";
    }
  }
}

/**
 * What another app can open of the place: a file, a folder (which the
 * computer's file manager opens standing in it), or a site's address. The
 * recents and the disks are no folder, and have no path to hand over.
 */
function openInAppTargetOf(location: TabLocation): OpenInAppTarget | undefined {
  switch (location.kind) {
    case "file": {
      return { hostPath: location.path };
    }
    case "folder": {
      return location.path && location.path !== COMPUTER_ROOT
        ? {
            hostPath:
              location.hostPath ??
              expandHomePath(location.path, window.api.homeDir),
          }
        : undefined;
    }
    case "page": {
      return openInAppTargetOfUrl(location.url);
    }
    default: {
      return;
    }
  }
}

/** The host quiet, the path loud: the part of an address you are reading. */
function splitUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      // The bare root is left off, the way a browser leaves it off, unless a
      // query follows it and would otherwise hang off the host.
      rest:
        parsed.pathname === "/" && !parsed.search
          ? ""
          : `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return { host: url, rest: "" };
  }
}
