import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { Omnibar } from "@/client/components/orchestrator/omnibar";
import { SiteIcon } from "@/client/components/orchestrator/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { type ReactNode } from "react";

/** What the tab on screen is showing, in the terms that page has for itself. */
export type TabLocation =
  | { kind: "app"; name: string; site?: string }
  | { kind: "file"; name: string; path: string }
  | { kind: "folder"; path: string }
  | { kind: "newTab" }
  | { kind: "page"; url: string }
  | { kind: "tasks" };

/**
 * The row every tab wears: back, forward, and where you are.
 *
 * It spans the pane rather than the window, which is the whole point of it.
 * History belongs to a tab: an arrow in the window bar would sit beside a
 * strip that means every tab and read as the window's, and back would be
 * something that could move you between tabs, which is the behavior this
 * replaces.
 *
 * The field says where you are in whatever terms the page has. It is a label
 * in most of them, since nobody types their way to an app page, and selecting
 * its text is how a path is copied without the row pretending to be a URL bar.
 */
export function TabLocationRow({
  canGoBack,
  canGoForward,
  field,
  location,
  onBack,
  onForward,
  trailing,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  /** What stands in for the field: a page's own address bar and controls. */
  field?: ReactNode;
  location: TabLocation;
  onBack: () => void;
  onForward: () => void;
  /** What this page can do with itself, held at the row's right edge. */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
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
        // The whole box is the field: a press anywhere on it, edge to edge,
        // puts the caret in the input, the way a browser's address bar does.
        <div
          className="relative mx-1 flex h-7 min-w-0 flex-1 cursor-text items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs shadow-sm focus-within:border-foreground/30"
          onPointerDown={(event) => {
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
  if (location.kind === "newTab") {
    return (
      <>
        <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Search, open a file, or ask
        </span>
      </>
    );
  }
  if (location.kind === "page") {
    const { host, rest } = splitUrl(location.url);
    return (
      <>
        <LockSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate select-text">
          <span className="text-muted-foreground">{host}</span>
          {rest}
        </span>
      </>
    );
  }
  if (location.kind === "file" || location.kind === "folder") {
    // The path as it is on the Mac, the parent quiet and the name loud. Never
    // a path relative to a mount: the field tells the truth about where a
    // thing is, which is the one thing a location field is for.
    const parts = location.path.split("/").filter(Boolean);
    const name = location.kind === "file" ? location.name : parts.at(-1);
    const lead = location.path.startsWith("/")
      ? ["", ...parts.slice(0, -1)]
      : parts.slice(0, -1);
    return (
      <>
        {/* A file wears its own type's mark, the way a site wears a favicon:
          it is the one thing about a file you can tell before opening it. */}
        {location.kind === "file" ? (
          <FileIcon className="size-4 shrink-0" filename={location.name} />
        ) : (
          <FileSystemFolderGlyph className="h-3 w-auto shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate select-text">
          <span className="text-muted-foreground">
            {lead.length > 0 ? `${lead.join("/")}/` : ""}
          </span>
          {name}
        </span>
      </>
    );
  }
  if (location.kind === "app") {
    return (
      <>
        <span className="flex size-3.5 shrink-0 items-center justify-center [&_img]:size-3.5 [&_svg]:size-3.5">
          {location.site ? (
            <AppIcon site={location.site} size="sm" />
          ) : (
            <SiteIcon url="" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {location.name}
          {location.site ? (
            <span className="text-muted-foreground">
              {" · "}
              {hostOf(location.site)}
            </span>
          ) : null}
        </span>
      </>
    );
  }
  return (
    <>
      <InstrumentGlyph className="size-3.5 shrink-0 text-brand-600" />
      <span className="min-w-0 flex-1 truncate">Tasks</span>
    </>
  );
}

function hostOf(site: string) {
  try {
    return new URL(site).host;
  } catch {
    return site;
  }
}

/** What the field holds when it is edited: the place, in words that can be typed over. */
function locationText(location: TabLocation) {
  switch (location.kind) {
    case "app": {
      return location.name;
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
      rest: `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`,
    };
  } catch {
    return { host: url, rest: "" };
  }
}
