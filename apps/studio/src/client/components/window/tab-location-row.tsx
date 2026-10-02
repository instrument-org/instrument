import { PageFavicon } from "@/client/components/favicon";
import { FileTypeIcon } from "@/client/components/extend/file-system";
import { OpenInAppButton } from "@/client/components/open-in-app";
import { FolderMark } from "@/client/components/window/folder-mark";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { AppIcon } from "@/client/components/window/app-icon";
import {
  lookAtAtom,
  type LookTarget,
} from "@/client/components/window/look-at";
import { Omnibar } from "@/client/components/window/omnibar";
import {
  type OpenInAppTarget,
  openInAppTargetOfUrl,
} from "@/client/hooks/use-open-in-app";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type WindowShortcutId } from "@/shared/window-shortcuts";
import { expandHomePath } from "@instrument-org/shared";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import {
  Fragment,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
} from "react";

import { locationCrumbs, type TabLocation } from "./tab-location";

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
  field,
  leading,
  location,
  onBack,
  onClose,
  onForward,
  onSite,
  onVisit,
  ref,
  reload,
  trailing,
}: {
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** What stands in for the field: a page's own address bar and controls. */
  field?: ReactNode;
  /** What the page puts ahead of the row's own controls, at its far left: a toggle for a panel along the page's left edge. */
  leading?: ReactNode;
  location: TabLocation;
  /** Back through what the thing up has been at, drawn with forward; a row over a screen that is the tab's own route leaves both to the window's bar. */
  onBack?: () => void;
  /** Puts the view away, for a row over something shown large beside a chat; the thing stays with the chat. */
  onClose?: () => void;
  onForward?: () => void;
  /** Where a site typed into the field goes on this tab, when not a new tab of its own. */
  onSite?: (url: string) => void;
  /** Where a screen typed into the field goes, for a row over a tab the router does not follow. */
  onVisit?: (href: string) => void;
  /** The row itself, so the window can put the caret in the field it holds. */
  ref?: Ref<HTMLDivElement>;
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
    location.kind === "file"
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
      ref={ref}
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
      {field ?? (
        // The box is the field everywhere the place itself is not: a press on
        // one of the places you are under goes there, and a press anywhere
        // else, edge to edge, puts the caret in the input the way a browser's
        // address bar does.
        <div
          className={cn(
            "group/field relative flex h-7 min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-border bg-card px-3 text-xs shadow-xs-soft focus-within:border-foreground/30",
            // The app's icon sits in the field's round end, with room to
            // breathe inside the curve.
            openIn && "pr-2",
          )}
          onPointerDown={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button")
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
          {openIn && <OpenInAppButton target={openIn} />}
        </div>
      )}
      {trailing}
      {/* The file up at the size Quick Look gives it, over the window. */}
      {lookTarget && (
        <TabRowControl
          disabled={false}
          icon={<ArrowsOutSimpleIcon className="size-4" />}
          label="Expand"
          onClick={() => {
            setLookAt(lookTarget);
          }}
        />
      )}
      {onClose && (
        <TabRowControl
          disabled={false}
          // Rotated: the mark draws a panel at the left, and this one is at
          // the right.
          icon={<SidebarSimpleIcon className="size-4 rotate-180" />}
          label="Hide"
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
  onAuxClick,
  onClick,
  onContextMenu,
}: {
  chord?: WindowShortcutId;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  /** The gestures a control that opens a place answers, where it opens one. */
  onAuxClick?: MouseEventHandler;
  onClick: () => void;
  onContextMenu?: MouseEventHandler;
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
        onAuxClick={onAuxClick}
        onClick={onClick}
        onContextMenu={onContextMenu}
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
  const crumbs = locationCrumbs(location, {
    home: window.api.homeDir,
    ...(places.data ? { volumes: places.data.volumes } : {}),
  });
  const path = useRef<HTMLSpanElement>(null);
  // Past the point where even shortened names fit, the end of the path is
  // what stays in view and its head scrolls off to the left: the place you
  // are at is the part that has to be readable. Offsets are read against the
  // box itself, which is why it is the positioned one.
  const trail = crumbs.map((crumb) => crumb.label).join("/");
  useEffect(() => {
    const box = path.current;
    if (!box) {
      return;
    }
    const showHere = () => {
      const here = box.lastElementChild;
      if (here instanceof HTMLElement) {
        box.scrollLeft = Math.min(
          here.offsetLeft,
          box.scrollWidth - box.clientWidth,
        );
      }
    };
    showHere();
    // Again whenever the box changes size, which is the pane being dragged
    // narrower: the path that fit a moment ago has to give up its head.
    const observer = new ResizeObserver(showHere);
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [trail]);

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
        {locationMark(location)}
        <span className="min-w-0 flex-1 truncate select-text">
          <span className="text-muted-foreground">{host}</span>
          {rest}
        </span>
      </>
    );
  }
  return (
    <>
      {locationMark(location)}
      {/* The parts pulled out to the box's own edge, so the place reads from
          where it read before there was anything to press. */}
      <span
        className="relative -mx-1 scrollbar-hide flex min-w-0 flex-1 items-center overflow-x-auto"
        ref={path}
      >
        {crumbs.map((crumb, index) => {
          const gestures = crumb.to ? gesturesFor(crumb.to) : undefined;
          const open = gestures?.destinations.find(
            (destination) => destination.id === "open",
          );
          const isHere = index === crumbs.length - 1;
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
            ? "max-w-full shrink-0 truncate"
            : crumb.label.length <= 2
              ? "shrink-0"
              : "min-w-6 max-w-max flex-1 truncate";
          return (
            <Fragment key={`${index}:${crumb.label}`}>
              {index > 0 ? (
                <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
              ) : null}
              {open ? (
                <button
                  className={cn(
                    "cursor-default rounded px-1 py-0.5 text-muted-foreground group-hover/field:text-foreground/70 hover:bg-foreground/8 hover:text-foreground",
                    size,
                  )}
                  onAuxClick={gestures?.onAuxClick}
                  onClick={() => {
                    open.run();
                  }}
                  onContextMenu={gestures?.onContextMenu}
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
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </span>
    </>
  );
}

/** What the place is drawn with, ahead of its name. */
function locationMark(location: TabLocation): ReactNode {
  switch (location.kind) {
    case "app": {
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center [&_img]:size-3.5 [&_svg]:size-3.5">
          {location.site ? (
            <AppIcon site={location.site} size="sm" />
          ) : (
            <PageFavicon url={undefined} />
          )}
        </span>
      );
    }
    case "apps": {
      return (
        <AppWindowIcon className="size-3.5 shrink-0 text-muted-foreground" />
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
    // The catalog, and one kind of page in it: an idea is under Ideas the
    // way an app page is under Apps.
    case "idea":
    case "ideas": {
      return (
        <CompassIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    case "newTab": {
      return (
        <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    case "page": {
      return (
        <LockSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    // The skills, and one of them: a skill is under Skills the way an app
    // page is under Apps.
    case "skill":
    case "skills": {
      return (
        <GraduationCapIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
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
    // Written out in full, since a path from the home folder's name is not
    // one the field can open.
    case "file":
    case "folder": {
      return expandHomePath(location.path, window.api.homeDir);
    }
    case "idea": {
      return location.title;
    }
    case "ideas": {
      return "Ideas";
    }
    case "newTab": {
      return "";
    }
    case "page": {
      return location.url;
    }
    case "skill": {
      return location.name;
    }
    case "skills": {
      return "Skills";
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
 * recents are a list rather than a folder, and have no path to hand over.
 */
function openInAppTargetOf(location: TabLocation): OpenInAppTarget | undefined {
  switch (location.kind) {
    case "file": {
      return { hostPath: location.path };
    }
    case "folder": {
      return location.path
        ? { hostPath: expandHomePath(location.path, window.api.homeDir) }
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
