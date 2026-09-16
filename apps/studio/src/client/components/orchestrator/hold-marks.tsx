import { Favicon } from "@/client/components/favicon";
import { FileIcon } from "@/client/components/file-icon";
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
import { type OpenTarget } from "@/client/lib/open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { type MouseEvent, type ReactNode, type SyntheticEvent } from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { basename } from "./threads";

/** One thing a thread made or used, with the mark it is drawn as and where it opens. */
interface Hold {
  icon: ReactNode;
  key: string;
  /** What the hold is called: the app's name, the file's name, the site's host. Never a path. */
  name: string;
  target: OpenTarget;
}

/** How many marks the row carries before the rest fold into a count. */
const MARKS_SHOWN = 5;

/**
 * What a thread has made and used, as bare marks at the end of its replies
 * line: the apps as their icons, the files as their type's, the sites as
 * their favicons, a handful and then a count that opens every hold by name.
 * No names on the line. Each mark opens its thing where the surface says,
 * and answers a middle click, a modified click, and a right click the way
 * every openable thing does. None of it reaches the row underneath, and
 * nothing here moves when the row is hovered.
 */
export function HoldMarks({
  appsBySlug,
  className,
  holds,
}: {
  appsBySlug: AppsBySlug;
  className?: string;
  holds: { apps: string[]; files: string[]; sites: string[] };
}) {
  const items: Hold[] = [
    ...holds.apps.map((slug) => {
      const app = appsBySlug.get(slug);
      return {
        icon: <AppIcon site={app?.site} size="sm" />,
        key: `app:${slug}`,
        name: app?.name ?? slug,
        target: { href: `/orchestrator/apps/${slug}`, kind: "screen" as const },
      };
    }),
    ...holds.files.map((path) => ({
      icon: <FileIcon className="size-4" filename={basename(path)} />,
      key: `file:${path}`,
      name: basename(path),
      target: { kind: "path" as const, path },
    })),
    ...holds.sites.map((site) => ({
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
  const marked = items.slice(0, MARKS_SHOWN);
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
      className={cn("flex shrink-0 items-center gap-0.5", className)}
      onAuxClick={stopHere}
      onClick={stopHere}
      onContextMenu={stopHere}
      onKeyDown={stopHere}
    >
      {marked.map((item) => (
        <Tooltip key={item.key}>
          <TooltipTrigger asChild>
            <button
              className="grid size-5 shrink-0 place-items-center rounded-sm hover:bg-foreground/8"
              type="button"
              {...openOf(item)}
            >
              {item.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent>{item.name}</TooltipContent>
        </Tooltip>
      ))}
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
              {items.map((item) => (
                <button
                  className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent"
                  key={item.key}
                  type="button"
                  {...openOf(item)}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </button>
              ))}
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

/** Keeps a mark's gesture from reaching the row it sits on, which would open the thread as well. */
function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}

/** Whether a click asks for a tab of its own: the platform's one modifier for it, since Ctrl and a click is the secondary click on macOS. */
function wantsNewTab(event: { ctrlKey: boolean; metaKey: boolean }) {
  return isMacOS() ? event.metaKey : event.ctrlKey;
}
