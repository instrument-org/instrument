import { PlaceIcon } from "@/client/components/window/place-icons";
import { OpenInAppButton } from "@/client/components/open-in-app";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { FileMark } from "./file-mark";
import { FolderMark } from "@/client/components/window/folder-mark";
import { fileAddressOf } from "@/client/bookmarks/address";
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
import { ProjectMark } from "./project-mark";
import { AppIcon } from "@/client/components/window/app-icon";
import { FoldingTrail } from "@/client/components/window/folding-trail";
import {
  PlaceMenu,
  usePlaceMenuProps,
} from "@/client/components/window/place-menu";
import {
  ExtensionPageBadge,
  isExtensionPageUrl,
} from "@/client/components/window/browser-extensions";
import {
  contentOfAddress,
  useContentDrag,
} from "@/client/components/window/drag/content-drag";
import { Omnibar } from "@/client/components/window/omnibar";
import { editField } from "@/client/components/window/omnibar-field";
import {
  type OpenInAppTarget,
  openInAppTargetOfUrl,
} from "@/client/hooks/use-open-in-app";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { fileUrlOf } from "@/client/lib/file-url";
import { pageConnection } from "@/client/lib/page-connection";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type WindowShortcutId } from "@/shared/window-shortcuts";
import { expandHomePath } from "@instrument-org/shared";
import { TOOLBAR_GROUP_CLASSNAME } from "@/client/components/toolbar-control";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { FilesIcon } from "@phosphor-icons/react/Files";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { LinkBreakIcon } from "@phosphor-icons/react/LinkBreak";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useContext, useState } from "react";

import {
  AppChip,
  AppMark,
  appIndexHref,
  appName,
  type BuiltInApp,
  SiteAppChip,
} from "./app-chip";
import { appOfPage } from "./app-visits";
import { useOwnApps } from "./use-own-apps";
import { useShowAppPage } from "./use-show-app-page";
import { BookmarkStar } from "./bookmark-star";
import { ShellContext } from "./shell-context";
import {
  type LocationCrumb,
  locationChip,
  locationCrumbs,
  type TabLocation,
} from "./tab-location";
import { PANE_TOP_ROW, usePaneTop } from "./pane-top";

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
 * and a task reaches the work, without the row pretending to be a URL bar. A
 * chip ahead of the parts names which of the app's own apps the tab is in and
 * goes to its index. With the caret the field holds the place's real address to
 * edit; the star at the field's end keeps the tab's address as a bookmark.
 */
export function TabLocationRow({
  address,
  canGoBack,
  canGoForward,
  chat,
  className,
  fieldEnd,
  fieldHint,
  fieldTakesCaret,
  hasField = true,
  isBare = false,
  leading,
  liveAddress,
  location,
  onBack,
  onFolder,
  onForward,
  onSite,
  onVisit,
  reload,
  title,
  trailing,
}: {
  /**
   * The tab's address (`addressOfTab`): what the star keeps. A tab with
   * none has no star.
   */
  address?: string | undefined;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** What opens a chat beside the tab, inside the field ahead of the app that opens it and the star (`ChatBesideChip`). */
  chat?: ReactNode;
  className?: string;
  /** What the page says about itself inside the field, at its end, ahead of the app that opens it: its zoom while not 100%. */
  fieldEnd?: ReactNode;
  /** What an empty field shows until it has the caret: the keys that put it there. */
  fieldHint?: ReactNode;
  /** Whether an empty field takes the caret as it arrives (see `Omnibar`). */
  fieldTakesCaret?: boolean;
  /** Whether the row has the field that says where you are; a tab whose own page takes addresses has only the arrows and reload. */
  hasField?: boolean;
  /** Whether back, forward and reload stand as bare marks, out of their framed group: a new tab's, which only hints at a browser. */
  isBare?: boolean;
  /** What the page puts ahead of the row's own controls, at its far left: a toggle for a panel along the page's left edge. */
  leading?: ReactNode;
  /** The address of the page up as it stands, read when the field is pressed: a page's file, with wherever the page has gone in itself. */
  liveAddress?: () => string | undefined;
  location: TabLocation;
  /** Back through what the thing up has been at, drawn with forward; a row over a screen that is the tab's own route leaves both to the window's bar. */
  onBack?: () => void;
  onForward?: () => void;
  /** What a press on the folder a file is in does: shows it beside the file, false when the press goes to the folder as any other part's does. */
  onFolder?: () => boolean;
  /** Where a site typed into the field goes on this tab, when not a new tab of its own. */
  onSite?: (url: string) => void;
  /** Where a screen typed into the field goes, for a row over a tab the router does not follow. */
  onVisit?: (href: string) => void;
  /** A page's reload, beside the arrows where a browser keeps it. */
  reload?: ReactNode;
  /** What a bookmark of the tab is called until renamed; the place's own name unless given (a page's title). */
  title?: string | undefined;
  /** What this page can do with itself, held at the row's right edge. */
  trailing?: ReactNode;
}) {
  const top = usePaneTop();
  const openIn = openInAppTargetOf(location);
  // The web's start is where an address is typed: its field is empty and
  // takes the caret, as a new tab's does, with nothing to star.
  const isWebStart =
    location.kind === "builtin" && location.screen === "browser";
  const place = isWebStart ? "" : locationText(location, address);
  // Whether the field's words have the caret, where a press selects in them
  // rather than carrying the address out.
  const [isEditing, setIsEditing] = useState(false);
  const fieldKey = `${location.kind}:${place}`;
  // The field's key from when words were typed into it until the caret
  // leaves them: a place that changes under words half typed, as a page its
  // own redirect or an agent's press moves on does, leaves them as they are.
  const [typedIn, setTypedIn] = useState<string | null>(null);
  const fieldDrag = useContentDrag(
    address
      ? contentOfAddress(address, title || bookmarkTitleOf(location))
      : undefined,
    { isOff: isEditing },
  );
  return (
    <div
      // A container, so what a screen or a page draws into the row can give
      // up its words for its mark when the row is narrow.
      className={cn(
        "@container/tabrow flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-background px-1.5",
        top && PANE_TOP_ROW,
        className,
      )}
      data-tab-location=""
    >
      {top?.lead}
      {leading}
      {/* Back, forward and a page's reload framed as one control, the way a
        browser keeps them together. */}
      <div
        className={
          isBare
            ? "flex shrink-0 items-center gap-0.5 not-has-[button]:hidden"
            : TOOLBAR_GROUP_CLASSNAME
        }
      >
        {onBack && onForward && (
          <>
            <TabRowControl
              chord="back"
              disabled={!canGoBack}
              icon={<ArrowLeftIcon className="size-4" />}
              label="Back"
              onClick={onBack}
            />
            <TabRowControl
              chord="forward"
              disabled={!canGoForward}
              icon={<ArrowRightIcon className="size-4" />}
              label="Forward"
              onClick={onForward}
            />
          </>
        )}
        {reload}
      </div>
      {/* The box is the field everywhere the place itself is not: a press on
        one of the places you are under goes there, and a press anywhere else,
        edge to edge, puts the caret in the input the way a browser's address
        bar does. Its fill is a solid shade of the row's own ground, named as
        `--field-fill` so what covers the words at its end (the open-in
        button, as it grows) paints the same color. */}
      {hasField ? (
        <div
          className={cn(
            "group/field @container/field relative flex h-8 min-w-0 flex-1 cursor-text items-center gap-2 rounded-xl bg-(--field-fill) px-3 text-[13px] ring-1 ring-foreground/[0.06] [-webkit-app-region:no-drag] [--field-fill:color-mix(in_oklab,var(--foreground)_4.5%,var(--background))] focus-within:ring-foreground/20 focus-within:[--field-fill:var(--card)]",
            // The app's icon and the star sit at the field's end, with room
            // to breathe inside the curve.
            (openIn || address) && "pr-2",
          )}
          {...fieldDrag}
          onBlur={(event) => {
            if (event.target instanceof HTMLInputElement) {
              setIsEditing(false);
              setTypedIn(null);
            }
          }}
          onInput={(event) => {
            if (event.target instanceof HTMLInputElement) {
              setTypedIn((was) => was ?? fieldKey);
            }
          }}
          onFocus={(event) => {
            if (event.target instanceof HTMLInputElement) {
              setIsEditing(true);
            }
          }}
          onPointerDown={(event) => {
            // Only a primary press edits: a right press on the place is its
            // menu, and so is a Control press on a Mac.
            if (event.button !== 0 || (event.ctrlKey && isMacOS())) {
              return;
            }
            // A press on a menu a part of the place opened reaches here
            // through React's tree though it is drawn outside the box, and
            // is the menu's alone.
            if (
              event.target instanceof Node &&
              !event.currentTarget.contains(event.target)
            ) {
              return;
            }
            const input = event.currentTarget.querySelector("input");
            // While the words are being edited, a press selects in them.
            if (input && document.activeElement === input) {
              return;
            }
            // Anywhere else in the field, the chip and the place's parts
            // included, a press that moves carries what the address names
            // out by the system's drag (`fieldDrag`), the file itself for a
            // file or folder and the link for anything else, as a browser's
            // address bar does; one that goes nowhere is a click, which
            // edits the field or does what the part pressed does.
            fieldDrag.onPointerDown?.(event);
            if (
              !input ||
              event.target === input ||
              (event.target instanceof Element &&
                event.target.closest("button"))
            ) {
              return;
            }
            // A canceled press never becomes the system's drag, so only a
            // field with nothing to carry keeps the press to itself.
            if (!fieldDrag.draggable) {
              event.preventDefault();
            }
            editOnClick(input, event);
          }}
        >
          <Omnibar
            {...(fieldHint === undefined ? {} : { hint: fieldHint })}
            {...(fieldTakesCaret === undefined
              ? {}
              : { takesCaret: fieldTakesCaret })}
            initial={place}
            // The field starts over whenever the place changes, a new tab
            // turning into a chat among them, once nothing is being typed
            // into it.
            key={typedIn ?? fieldKey}
            {...(liveAddress ? { liveAddress } : {})}
            location={location}
            onSent={() => {
              setTypedIn(null);
            }}
            {...(onSite ? { onSite } : {})}
            {...(onVisit ? { onVisit } : {})}
            resting={
              location.kind === "newTab" ||
              location.kind === "newChat" ||
              isWebStart ? undefined : (
                <Field
                  location={location}
                  {...(onFolder ? { onFolder } : {})}
                  {...(onVisit ? { onVisit } : {})}
                />
              )
            }
          />
          {fieldEnd}
          {/* A field too narrow for the place's name keeps the name and the
              star. Both of these are a right press away: the tab's menu
              splits, and the place's menu opens it in another app. */}
          {chat && (
            <span className="contents @max-[12rem]/field:hidden">{chat}</span>
          )}
          {openIn && (
            <OpenInAppButton
              className="@max-[12rem]/field:hidden"
              target={openIn}
            />
          )}
          {address && !isWebStart && (
            <BookmarkStar
              address={address}
              title={title || bookmarkTitleOf(location)}
            />
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {trailing}
      {top?.corner}
    </div>
  );
}

/**
 * Chat at the end of a page's, a folder's or a file's field, before the
 * app that opens it and the star: a new chat beside the tab, the one way the
 * row offers to split. Its bubble is the brand's green, the only color in
 * the field, and a narrow field (`@container/field`) keeps the bubble alone.
 */
export function ChatBesideChip({ onClick }: { onClick: () => void }) {
  return (
    <ToolbarTooltip chord="newTabInSplit" label="New Chat in Split">
      <button
        aria-label="Chat"
        className="flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-lg bg-card pr-2 pl-1.5 text-[13px] font-medium text-foreground/80 ring-1 ring-foreground/8 hover:text-foreground hover:ring-foreground/15 @max-[18rem]/field:pr-1.5"
        onClick={onClick}
        type="button"
      >
        <ChatCircleIcon
          className="size-3.5 shrink-0 text-brand-400 dark:text-brand-300"
          weight="fill"
        />
        <span className="@max-[18rem]/field:sr-only">Chat</span>
      </button>
    </ToolbarTooltip>
  );
}

/**
 * One of the row's own controls: a mark, what it is called, and what it
 * does, with the chord that does the same in the tooltip where it has one.
 * `word` is shown after the mark, where the mark alone would not say enough.
 */
export function TabRowControl({
  chord,
  disabled,
  icon,
  label,
  onClick,
  word,
}: {
  chord?: WindowShortcutId;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  word?: string;
}) {
  return (
    <ToolbarTooltip chord={chord} label={label}>
      <button
        className={cn(
          "shrink-0 rounded-lg",
          word === undefined
            ? "grid size-7 place-items-center"
            : "flex h-7 items-center gap-1.5 pr-2.5 pl-2 text-[13px] font-medium",
          disabled
            ? "text-foreground/25"
            : "text-foreground/60 hover:bg-foreground/8 hover:text-foreground",
        )}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {icon}
        {word}
      </button>
    </ToolbarTooltip>
  );
}

/** The mark and the words, which is all that changes between page types. */
function Field({
  location,
  onFolder,
  onVisit,
}: {
  location: TabLocation;
  onFolder?: () => boolean;
  onVisit?: (href: string) => void;
}) {
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
          Search or open a file
        </span>
      </>
    );
  }
  const chip = locationChip(location);
  // A built-in page at its start is the chip alone.
  if (chip && crumbs.length === 0) {
    return (
      <>
        <FieldChip app={chip} {...(onVisit ? { onVisit } : {})} />
        <span className="flex-1" />
      </>
    );
  }
  // A debug page's address is said whole, as a page's is: what every debug
  // page shares quiet, the page's own part loud.
  if (location.kind === "debug") {
    const { lead, rest } = splitDebugAddress(location.address);
    return (
      <>
        {locationMark(location)}
        <span className="min-w-0 flex-1 truncate select-text">
          <span className="text-muted-foreground">{lead}</span>
          {rest}
        </span>
      </>
    );
  }
  // A page that doesn't exist says the address it was asked for, as typed.
  if (location.kind === "missing") {
    return (
      <>
        {locationMark(location)}
        <span className="min-w-0 flex-1 truncate select-text">
          {location.address}
        </span>
      </>
    );
  }
  if (location.kind === "page") {
    // An address is one thing you type rather than a trail you walk, so it is
    // said whole: the host quiet, the part of it you are reading loud. An
    // extension's own page keeps its scheme, which is what says whose it is.
    const isExtensionPage = isExtensionPageUrl(location.url);
    const { host, rest } = splitUrl(location.url, {
      withScheme: isExtensionPage,
    });
    return (
      <>
        {isExtensionPage ? null : (
          <PageAppChip url={location.url} {...(onVisit ? { onVisit } : {})} />
        )}
        {isExtensionPage ? (
          <ExtensionPageBadge url={location.url} />
        ) : (
          <ConnectionBadge url={location.url} />
        )}
        <span className="min-w-0 flex-1 truncate select-text">
          <span className="text-muted-foreground">{host}</span>
          {rest}
        </span>
      </>
    );
  }
  // Where the chip leads, the location's own mark moves beside its name, so
  // two marks never sit side by side.
  const itemMark = chip ? locationItemMark(location) : null;
  const separator = (
    <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
  );
  const crumbAt = (crumb: LocationCrumb, index: number, content: ReactNode) => {
    const gestures = crumb.to ? gesturesFor(crumb.to) : undefined;
    const open = gestures?.destinations.find(
      (destination) => destination.id === "open",
    );
    const isHere = index === crumbs.length - 1;
    const isFolderOfFile =
      location.kind === "file" && index === crumbs.length - 2;
    // Several picked read as a count, set apart from the folder it is in.
    const isCount =
      isHere && location.kind === "folder" && location.picked !== undefined;
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
          name={crumb.label}
        />
      );
    const part = open ? (
      <button
        className="flex cursor-default items-center rounded px-1 py-0.5 text-muted-foreground group-hover/field:text-foreground/70 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
        onAuxClick={gestures?.onAuxClick}
        onClick={(event) => {
          // A click with Command or Shift opens the part in a tab of its
          // own, as it does on any row that opens something.
          gestures
            ?.opening(() => {
              // A part of one of the app's own pages is a step back out on
              // this tab, the way a folder above a file is: the window would
              // only bring up the page's tab as it is, the one tab it keeps
              // for it.
              if (isFolderOfFile && onFolder?.()) {
                return;
              }
              if (
                onVisit &&
                crumb.to?.kind === "screen" &&
                crumb.path === undefined
              ) {
                onVisit(crumb.to.href);
              } else {
                open.run();
              }
            })
            .onClick(event);
        }}
        {...(menu ? {} : { onContextMenu: gestures?.onContextMenu })}
        type="button"
      >
        {content}
      </button>
    ) : (
      <span
        className={cn(
          "flex items-center px-1 select-text",
          isCount && "rounded-md bg-foreground/8 font-medium",
          // A part with nowhere to go, before the last, is a place
          // the window cannot open: it reads as the lead it is.
          !isHere && "text-muted-foreground",
          menu && "rounded data-[state=open]:bg-foreground/8",
        )}
      >
        {content}
      </span>
    );
    return menu ? (
      <ContextMenu>
        <ContextMenuTrigger asChild>{part}</ContextMenuTrigger>
        {menu}
      </ContextMenu>
    ) : (
      part
    );
  };
  return (
    <>
      {chip ? (
        <FieldChip app={chip} nameFolds {...(onVisit ? { onVisit } : {})} />
      ) : (
        <LocationMark location={location} />
      )}
      {/* The parts pulled out to the box's own edge, so the place reads from
          where it read before there was anything to press. */}
      <FoldingTrail
        className="-mx-1 flex-1"
        // A file's or folder's name loses its middle, as the Finder cuts
        // one; a title keeps its start.
        cutsAtEnd={() => location.kind !== "file" && location.kind !== "folder"}
        labelClassName="px-1"
        labels={crumbs.map((crumb) => crumb.label)}
        mark={(at) => {
          const crumb = crumbs[at];
          if (at === crumbs.length - 1) {
            return itemMark;
          }
          return crumb?.path === undefined ? null : (
            <FolderMark path={crumb.path} />
          );
        }}
        part={(at, content) => {
          const crumb = crumbs[at];
          return crumb ? crumbAt(crumb, at, content) : null;
        }}
        separator={separator}
      />
    </>
  );
}

/**
 * The chip of the person's own app whose site a page is on, which takes the
 * tab to the app's page in Instrument, a step Back undoes (`onVisit`); a row
 * with no `onVisit` brings the app's page up as its own tab.
 */
function PageAppChip({
  onVisit,
  url,
}: {
  onVisit?: (href: string) => void;
  url: string;
}) {
  const app = appOfPage(url, useOwnApps());
  const showAppPage = useShowAppPage();
  if (app === undefined) {
    return null;
  }
  return (
    <SiteAppChip
      icon={app.icon}
      name={app.name}
      onPress={() => {
        if (onVisit) {
          onVisit(`/apps/${app.slug}`);
        } else {
          showAppPage(app.slug);
        }
      }}
      site={app.site}
    />
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

/**
 * The mark of the place, which drags it out of the window with the rest of
 * the field (`fieldDrag`), the way a Mac window's title bar icon does.
 */
function LocationMark({ location }: { location: TabLocation }) {
  if (!draggedHostPath(location)) {
    return locationMark(location);
  }
  return (
    <span className="flex shrink-0 cursor-default items-center">
      {locationMark(location)}
    </span>
  );
}

/** How far a press may stray and still be a click that edits the field. */
const CLICK_SLOP_PX = 20;

/**
 * Puts the caret in the field once a press on it ends as a click: not once
 * it has become a drag, which takes the release (`pointercancel` for a
 * link's, nothing at all for a file's), and not past the next press.
 */
function editOnClick(input: HTMLInputElement, press: React.PointerEvent) {
  const stop = () => {
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("pointerdown", stop, { capture: true });
  };
  const up = (event: PointerEvent) => {
    stop();
    if (
      Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) <
      CLICK_SLOP_PX
    ) {
      editField(input);
    }
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("pointerdown", stop, { capture: true });
}

/**
 * The chip at the field's start, which goes to the app's index
 * (`appIndexHref`) the way a file's folders go to each folder: on this tab,
 * through `onVisit`, which puts what a chat's tab goes to in a tab after it.
 * A row with no `onVisit` has Files' and Apps' do what the rail's own entry
 * does: the place, at its root when the window is already in it.
 */
function FieldChip({
  app,
  nameFolds = false,
  onVisit,
}: {
  app: BuiltInApp;
  /** A name follows the chip, which keeps the room in a narrow field. */
  nameFolds?: boolean;
  onVisit?: (href: string) => void;
}) {
  const shell = useContext(ShellContext);
  const index = appIndexHref(app);
  const place = app === "apps" ? "apps" : app === "files" ? "files" : undefined;
  const onPress =
    onVisit && index !== undefined
      ? () => {
          onVisit(index);
        }
      : shell && place
        ? () => {
            shell.goToPlace(place);
          }
        : undefined;
  return (
    <AppChip
      app={app}
      nameFolds={nameFolds}
      {...(onPress ? { onPress } : {})}
    />
  );
}

/**
 * The location's own mark where it sits beside its name: the app's icon, the
 * file's or folder's mark, still dragged out from there, a task's box, and a
 * stack for several picked. The top of the computer has none, and nor does a
 * place the chip already marks (a chat, a built-in page).
 */
function locationItemMark(location: TabLocation): ReactNode {
  if (
    location.kind === "chat" ||
    (location.kind === "chats" && location.project === undefined) ||
    location.kind === "builtin" ||
    location.kind === "apps" ||
    location.kind === "newChat"
  ) {
    return null;
  }
  if (location.kind === "folder") {
    if (location.path === COMPUTER_ROOT) {
      return null;
    }
    if (location.picked !== undefined) {
      return <FilesIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    }
  }
  return <LocationMark location={location} />;
}

/** The file or folder on disk a location's mark stands for, if it is one. */
function draggedHostPath(location: TabLocation) {
  if (location.kind === "file") {
    return location.path;
  }
  // The recents and the disks are no one folder, and a folder with several
  // picked in it stands for them.
  if (
    location.kind === "folder" &&
    location.path !== "" &&
    location.path !== COMPUTER_ROOT &&
    location.picked === undefined
  ) {
    return location.hostPath ?? location.path;
  }
  return undefined;
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
    case "builtin": {
      return <AppMark app={location.screen} />;
    }
    case "chats": {
      return location.project ? (
        <ProjectMark project={location.project} />
      ) : (
        <AppMark app="chat" />
      );
    }
    case "chat":
    case "newChat": {
      return <AppMark app="chat" />;
    }
    case "debug": {
      return <CodeIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    }
    case "missing": {
      return (
        <LinkBreakIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    case "file": {
      // A file wears its own type's mark, the way a site wears a favicon: it
      // is the one thing about a file you can tell before opening it.
      return (
        <FileMark
          className="size-4"
          hostPath={location.path}
          name={location.name}
        />
      );
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
  }
}

/**
 * What the field holds when it is edited: the address of what is up, which
 * opens it again from any field. A page's is its URL, a file's and a folder's
 * the `file://` one a browser opens them at, and a place of the app's own its
 * `instrument://` one (`address`, the tab's). The recents, the disks and a
 * new tab have none, and open empty.
 */
function locationText(location: TabLocation, address: string | undefined) {
  switch (location.kind) {
    case "app":
    case "apps":
    case "builtin":
    case "chat":
    case "chats":
    case "newChat":
    case "newTab":
    case "task": {
      return address ?? "";
    }
    // A file is at its `file://` address, the one a browser opens it at, so
    // what is copied from the field carries over to one as it stands.
    case "file": {
      return fileUrlOf(expandHomePath(location.path, window.api.homeDir));
    }
    case "folder": {
      return location.path === "" || location.path === COMPUTER_ROOT
        ? ""
        : fileAddressOf(
            location.hostPath ??
              expandHomePath(location.path, window.api.homeDir),
            { isFolder: true },
          );
    }
    case "page": {
      return location.url;
    }
    // A debug page's own address, which the field opens again, and the
    // address a page that doesn't exist was asked for.
    case "debug":
    case "missing": {
      return location.address;
    }
  }
}

/** What a bookmark of the place is called until it is renamed: the name the field shows it by. */
function bookmarkTitleOf(location: TabLocation): string {
  switch (location.kind) {
    case "builtin": {
      return location.part === undefined
        ? appName(location.screen)
        : `${appName(location.screen)} › ${location.part}`;
    }
    case "file":
    case "folder": {
      return (
        locationCrumbs(location, { home: window.api.homeDir }).at(-1)?.label ??
        location.path
      );
    }
    case "page": {
      return splitUrl(location.url).host;
    }
    default: {
      return (
        locationCrumbs(location, { home: window.api.homeDir }).at(-1)?.label ??
        appName(locationChip(location) ?? "")
      );
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
            ...(location.selected ? { reveal: location.selected } : {}),
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

/** A debug page's address as the part every one shares and the page's own. */
function splitDebugAddress(address: string) {
  const at = address.indexOf("/", address.indexOf("://") + 3);
  return at === -1
    ? { lead: address, rest: "" }
    : { lead: address.slice(0, at), rest: address.slice(at) };
}

/** The host quiet, the path loud: the part of an address you are reading. */
function splitUrl(url: string, { withScheme = false } = {}) {
  try {
    const parsed = new URL(url);
    return {
      host: withScheme ? `${parsed.protocol}//${parsed.host}` : parsed.host,
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
