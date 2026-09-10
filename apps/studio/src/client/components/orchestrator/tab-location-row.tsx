import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { Omnibar } from "@/client/components/orchestrator/omnibar";
import { SiteIcon } from "@/client/components/orchestrator/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, type Ref, useEffect, useRef } from "react";

import { locationCrumbs, type TabLocation } from "./tab-location";

/**
 * The row every tab wears: back, forward, and where you are.
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
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2"
      ref={ref}
    >
      <Arrow
        disabled={!canGoBack}
        icon={<CaretLeftIcon className="size-4" />}
        label="Back"
        onClick={onBack}
      />
      <Arrow
        disabled={!canGoForward}
        icon={<CaretRightIcon className="size-4" />}
        label="Forward"
        onClick={onForward}
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

function Arrow({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
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
      onClick={onClick}
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
  // The place you are at is the part that has to be readable, so a path too
  // long for the box keeps its end and the walk down to it scrolls off the
  // left, the way a folder window's own path bar does. Shrinking the parts to
  // fit instead is what turns a deep path into a row of single letters.
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
        className="-mx-1 scrollbar-hide flex min-w-0 flex-1 items-center overflow-x-auto"
        ref={path}
      >
        {crumbs.map((crumb, index) => {
          const gestures = crumb.to ? gesturesFor(crumb.to) : undefined;
          const open = gestures?.destinations.find(
            (destination) => destination.id === "open",
          );
          return (
            <Fragment key={`${index}:${crumb.label}`}>
              {index > 0 ? (
                <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
              ) : null}
              {open ? (
                <button
                  className="shrink-0 cursor-default rounded px-1 py-0.5 whitespace-nowrap text-muted-foreground group-hover/field:text-foreground/70 hover:bg-foreground/8 hover:text-foreground"
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
                    "shrink-0 px-1 whitespace-nowrap select-text",
                    // A part with nowhere to go, before the last, is a place
                    // the window cannot open: it reads as the lead it is.
                    index < crumbs.length - 1 && "text-muted-foreground",
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
