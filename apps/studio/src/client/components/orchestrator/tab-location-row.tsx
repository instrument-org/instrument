import { NEW_TAB_HREF } from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { Omnibar } from "@/client/components/orchestrator/omnibar";
import { SiteIcon } from "@/client/components/orchestrator/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import {
  useGesturesFor,
  useOpenGestures,
} from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { HouseIcon } from "@phosphor-icons/react/House";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
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
 * The row every tab wears: back, forward, home, and where you are.
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
  location,
  onBack,
  onForward,
  onSite,
  ref,
  trailing,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  /** What stands in for the field: a page's own address bar and controls. */
  field?: ReactNode;
  location: TabLocation;
  onBack: () => void;
  onForward: () => void;
  /** Where a site typed into the field goes on this tab, when not a new tab of its own. */
  onSite?: (url: string) => void;
  /** The row itself, so the window can put the caret in the field it holds. */
  ref?: Ref<HTMLDivElement>;
  /** What this page can do with itself, held at the row's right edge. */
  trailing?: ReactNode;
}) {
  const home = useOpenGestures({ href: NEW_TAB_HREF, kind: "screen" });
  const openHome = home.destinations.find(
    (destination) => destination.id === "open",
  );
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2"
      ref={ref}
    >
      <Control
        disabled={!canGoBack}
        icon={<CaretLeftIcon className="size-4" />}
        label="Back"
        onClick={onBack}
      />
      <Control
        disabled={!canGoForward}
        icon={<CaretRightIcon className="size-4" />}
        label="Forward"
        onClick={onForward}
      />
      {/* Where a browser keeps its home button, and what this window's home
          is: the tab back to nothing in particular, ready to be told where
          to go next. */}
      <Control
        disabled={false}
        icon={<HouseIcon className="size-4" />}
        label="Home"
        onAuxClick={home.onAuxClick}
        onClick={() => {
          openHome?.run();
        }}
        onContextMenu={home.onContextMenu}
      />
      {field ?? (
        // The box is the field everywhere the place itself is not: a press on
        // one of the places you are under goes there, and a press anywhere
        // else, edge to edge, puts the caret in the input the way a browser's
        // address bar does.
        <div
          className="group/field relative mx-1 flex h-7 min-w-0 flex-1 cursor-text items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs shadow-sm focus-within:border-foreground/30"
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
            {...(onSite ? { onSite } : {})}
            resting={
              location.kind === "newTab" ? undefined : (
                <Field location={location} />
              )
            }
          />
        </div>
      )}
      {trailing}
    </div>
  );
}

/** One of the row's own controls: a mark, what it is called, and what it does. */
function Control({
  disabled,
  icon,
  label,
  onAuxClick,
  onClick,
  onContextMenu,
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  /** The gestures a control that opens a place answers, where it opens one. */
  onAuxClick?: MouseEventHandler;
  onClick: () => void;
  onContextMenu?: MouseEventHandler;
}) {
  return (
    <button
      aria-label={label}
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
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}

/** The mark and the words, which is all that changes between page types. */
function Field({ location }: { location: TabLocation }) {
  // The home folder, which is what a path says `~` for and the one part of one
  // that is not a name the computer has. Asked for only where a path is on
  // screen, and answered from the same cache the folder browser reads.
  const places = useQuery(
    rpcClient.workspace.computer.places.queryOptions({
      enabled: location.kind === "file" || location.kind === "folder",
    }),
  );
  const home = places.data?.favorites.find(
    (place) => place.name === "Home",
  )?.path;
  const gesturesFor = useGesturesFor();
  const crumbs = locationCrumbs(location, { home });
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
          const size = isHere
            ? "max-w-full shrink-0 truncate"
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
            <SiteIcon url="" />
          )}
        </span>
      );
    }
    case "apps": {
      return (
        <AppWindowIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    case "file": {
      // A file wears its own type's mark, the way a site wears a favicon: it
      // is the one thing about a file you can tell before opening it.
      return <FileIcon className="size-4 shrink-0" filename={location.name} />;
    }
    case "folder": {
      return <FileSystemFolderGlyph className="h-3 w-auto shrink-0" />;
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
    // The work, and one of its tasks: a task is under the list it was opened
    // from, the way an app page is under Apps.
    case "task":
    case "tasks": {
      return <InstrumentGlyph className="size-3.5 shrink-0 text-brand-600" />;
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
    case "file":
    case "folder": {
      return location.path;
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
