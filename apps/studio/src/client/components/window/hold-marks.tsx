import { FileTypeIcon } from "@/client/components/extend/file-system";
import { Favicon } from "@/client/components/favicon";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { iconHostOf, useIconlessHosts } from "@/client/lib/favicon-url";
import { type OpenTarget } from "@/client/lib/open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { type MouseEvent, type ReactNode, type SyntheticEvent } from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { basename } from "./chats";

/** One thing a chat made or used, with the mark it is drawn as and where it opens. */
interface Hold {
  icon: ReactNode;
  key: string;
  /** What the hold is called: the app's name, the file's name, the site's host. Never a path. */
  name: string;
  /** Whether the name is drawn beside the mark, as a chip, rather than kept for the tooltip. */
  named?: boolean;
  target: OpenTarget;
}

/** How many marks the row carries before the rest fold into a count. */
const MARKS_SHOWN = 5;

/**
 * What a chat has made and used, as marks on a line of it: the apps as
 * their icons, the files as their type's, the sites as their favicons, a
 * handful and then a count that opens every hold by name. The marks are bare
 * unless the files are asked for by name, when each file is a chip with its
 * name the way mail lists attachments, and the apps and sites stay bare
 * beside them. Each mark opens its thing where the surface says, and answers
 * a middle click, a modified click, and a right click the way every openable
 * thing does. None of it reaches the row underneath, and nothing here moves
 * when the row is hovered. Told not to wrap, the line keeps its height
 * whatever it holds: the files come first, and what runs past the edge fades
 * out there, the count with it.
 */
export function HoldMarks({
  appsBySlug,
  className,
  holds,
  namedFiles = false,
  shown = MARKS_SHOWN,
  wrap = true,
}: {
  appsBySlug: AppsBySlug;
  className?: string;
  holds: { apps: string[]; files: string[]; sites: string[] };
  /** Whether the files are chips with their names rather than bare marks. */
  namedFiles?: boolean;
  /** How many marks are drawn before the rest fold into the count. */
  shown?: number;
  /** Whether the marks may take a second line, or are clipped at the edge of the first with a fade. */
  wrap?: boolean;
}) {
  // Read live rather than kept per row: a site whose first lookup failed and
  // that is given an icon a moment later, as when the chat opens it in a
  // browser tab, comes back into the row.
  const iconless = useIconlessHosts();
  const items: Hold[] = [
    // The newest first, so what the chat made last is what shows before
    // the count folds the rest away.
    ...holds.files.toReversed().map((path) => ({
      icon: path.endsWith("/") ? (
        <MacFolderIcon className="size-4" />
      ) : (
        <FileTypeIcon className="size-4" fileName={basename(path)} />
      ),
      key: `file:${path}`,
      name: basename(path),
      named: namedFiles,
      target: { kind: "path" as const, path },
    })),
    ...holds.apps.map((slug) => {
      const app = appsBySlug.get(slug);
      return {
        icon: (
          <AppIcon
            name={app?.name ?? slug}
            icon={app?.icon}
            site={app?.site}
            size="sm"
          />
        ),
        key: `app:${slug}`,
        name: app?.name ?? slug,
        target: { href: `/apps/${slug}`, kind: "screen" as const },
      };
    }),
    // A site with no icon anywhere is left out rather than drawn as a globe:
    // a row of globes says nothing about which sites the chat reached. So is
    // a site of an app the chat holds, which the app's mark already stands for.
    ...holds.sites
      .toReversed()
      .filter((site) => !iconless.has(iconHostOf(addressOf(site))))
      .filter(
        (site) =>
          !holds.apps.some((slug) =>
            isSiteOf(hostOf(site), appsBySlug.get(slug)),
          ),
      )
      .map((site) => ({
        icon: <Favicon className="size-4" url={addressOf(site)} />,
        key: `site:${site}`,
        name: hostOf(site),
        target: { kind: "page" as const, url: addressOf(site) },
      })),
  ];
  const gesturesFor = useGesturesFor();
  if (items.length === 0) {
    return null;
  }
  const marked = items.slice(0, shown);
  const folded = items.length - marked.length;
  const openOf = (item: Hold) => {
    const gestures = gesturesFor(item.target);
    return {
      onAuxClick: gestures.onAuxClick,
      onClick: (event: MouseEvent) => {
        const destination = wantsNewTab(event)
          ? gestures.separate
          : gestures.destinations.find((candidate) => candidate.id === "open");
        destination?.run();
      },
      onContextMenu: gestures.onContextMenu,
    };
  };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        // The fade is a fixed width past a padding of the same width, so a
        // line that fits ends before the fade and only what runs past the
        // edge is faded.
        !wrap &&
          "min-w-0 flex-nowrap overflow-hidden mask-r-from-[calc(100%-1.5rem)] pr-6",
        className,
      )}
      data-slot="holds"
      // A right click is left to reach the row: a mark that opens something
      // raises its own menu and refuses the event, so the row's menu answers
      // only over a bare mark and the empty line past the marks.
      onAuxClick={stopHere}
      onClick={stopHere}
      onKeyDown={stopHere}
    >
      {marked.map((item) =>
        item.named ? (
          <button
            className="inline-flex h-5 max-w-52 shrink-0 items-center gap-1 rounded-md bg-foreground/4 pr-1.5 pl-1 text-[11px] text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
            key={item.key}
            type="button"
            {...openOf(item)}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center [&>*]:size-3.5">
              {item.icon}
            </span>
            <span className="truncate">{item.name}</span>
          </button>
        ) : (
          // A bare mark says what the chat used; it is the chat's face
          // rather than a door, so it names itself on hover and opens
          // nothing, and it is out of the tab order. A file is the thing the
          // chat made, and does open.
          <Tooltip key={item.key}>
            <TooltipTrigger asChild>
              <button
                className="grid size-5 shrink-0 cursor-default place-items-center"
                data-inert=""
                tabIndex={-1}
                type="button"
              >
                {item.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent>{item.name}</TooltipContent>
          </Tooltip>
        ),
      )}
      {folded > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="h-5 shrink-0 rounded-sm px-1 text-[10px] font-medium text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
              type="button"
            >
              +{folded}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 p-1"
            maxHeight="20rem"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
            }}
          >
            <div className="flex max-h-full flex-col overflow-y-auto">
              {items.map((item) =>
                item.target.kind === "path" ? (
                  <button
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent"
                    data-slot="hold"
                    key={item.key}
                    type="button"
                    {...openOf(item)}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  </button>
                ) : (
                  <span
                    className="flex h-7 w-full items-center gap-2 px-2 text-xs text-muted-foreground"
                    data-slot="hold"
                    key={item.key}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  </span>
                ),
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/** A site as somewhere the browser can go: a hostname is opened over https. */
function addressOf(site: string) {
  return URL.canParse(site) ? site : `https://${site}`;
}

/** A site as its name alone: the host, with the address's machinery left off. */
function hostOf(site: string) {
  return URL.canParse(site) ? new URL(site).host : site;
}

/**
 * Whether a host is the app's own site: its domain or a subdomain of it, or
 * the host of its web app, which can sit under another domain (Gmail's at
 * mail.google.com). Matching below the app's domain alone keeps docs.google.com
 * out of Google Calendar. An app that runs on this computer owns no site, even
 * where the directory names its maker's.
 */
function isSiteOf(host: string, app: ReturnType<AppsBySlug["get"]>) {
  if (!app || app.local || !app.site) {
    return false;
  }
  const domain = hostOf(app.site);
  return (
    host === domain ||
    host.endsWith(`.${domain}`) ||
    (app.home !== undefined && host === hostOf(app.home))
  );
}

/** Keeps a mark's gesture from reaching the row it sits on, which would open the chat as well. */
function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}

/** Whether a click asks for a tab of its own: the platform's one modifier for it, since Ctrl and a click is the secondary click on macOS. */
function wantsNewTab(event: { ctrlKey: boolean; metaKey: boolean }) {
  return isMacOS() ? event.metaKey : event.ctrlKey;
}
