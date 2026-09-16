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
import { cn } from "@/client/lib/utils";
import {
  type ComponentProps,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { basename } from "./threads";

/** One thing a thread made or used, with the mark it is drawn as and where it opens. */
interface Hold {
  icon: ReactNode;
  key: string;
  /** Beside the mark; absent for an app, whose mark is the whole tile. */
  label?: string;
  target: OpenTarget;
  /** What the tile says on hover: the app's name, the file's path, the site's host. */
  tip: string;
}

type Size = "md" | "sm";

/** The strip's measurements at each size: the tiles, the marks in them, and the count at the end. */
const SIZES = {
  md: {
    gap: "gap-1.5",
    label: "max-w-40",
    mark: "size-4",
    more: "h-6 px-1.5 text-[11px]",
    tile: "h-6 gap-1.5 rounded-md px-2 text-[11px]",
  },
  sm: {
    gap: "gap-1",
    label: "max-w-36",
    mark: "size-3.5",
    more: "h-5 px-1 text-[10px]",
    tile: "h-5 gap-1 rounded px-1 text-[10px]",
  },
} satisfies Record<Size, Record<string, string>>;

/**
 * What a thread has made and used, in one row that clips at the right: the
 * apps first as their icons, since an icon is all an app ever is here, then
 * the files by name with their type's icon, then the sites as their favicons
 * with their host. As many tiles as fit, then a count of what is past the
 * edge, which opens the rest. Every tile is measured off screen so the count
 * is the count of what really did not fit, at this width and this zoom. Each
 * tile opens its thing where the surface says, and answers a middle click, a
 * modified click, and a right click the way every openable thing does.
 */
export function HoldsStrip({
  appsBySlug,
  className,
  holds,
  size,
}: {
  appsBySlug: AppsBySlug;
  className?: string;
  holds: { apps: string[]; files: string[]; sites: string[] };
  size: Size;
}) {
  const sizes = SIZES[size];
  const items: Hold[] = [
    ...holds.apps.map((slug) => {
      const app = appsBySlug.get(slug);
      return {
        icon: <AppIcon className={sizes.mark} site={app?.site} size="sm" />,
        key: `app:${slug}`,
        target: { href: `/orchestrator/apps/${slug}`, kind: "screen" as const },
        tip: app?.name ?? slug,
      };
    }),
    ...holds.files.map((path) => {
      const name = basename(path);
      return {
        icon: <FileIcon className={sizes.mark} filename={name} />,
        key: `file:${path}`,
        label: name,
        target: { kind: "path" as const, path },
        tip: path,
      };
    }),
    ...holds.sites.map((site) => ({
      icon: <Favicon className={sizes.mark} url={addressOf(site)} />,
      key: `site:${site}`,
      label: hostOf(site),
      target: { kind: "page" as const, url: addressOf(site) },
      tip: hostOf(site),
    })),
  ];
  const gesturesFor = useGesturesFor();
  const measure = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(items.length);
  const total = items.length;
  // By content: the strip is rebuilt from the thread on every update, and a
  // tile swapped for one of another width has to be measured again.
  const keys = items.map((item) => item.key).join("\n");
  useLayoutEffect(() => {
    const row = measure.current;
    if (!row) {
      return;
    }
    const fit = () => {
      const tiles = [...row.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.dataset.tile !== undefined,
      );
      const more = row.querySelector<HTMLElement>("[data-more]");
      const room = row.clientWidth;
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      // Everything fits, or the last tile is the count and the tiles before it
      // have to leave room for it.
      const fitsWhole = tiles.every(
        (tile) => tile.offsetLeft + tile.offsetWidth <= room,
      );
      if (fitsWhole) {
        setShown(tiles.length);
        return;
      }
      const reserve = (more?.offsetWidth ?? 0) + gap;
      let count = 0;
      for (const tile of tiles) {
        if (tile.offsetLeft + tile.offsetWidth + reserve > room) {
          break;
        }
        count++;
      }
      setShown(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [keys]);
  if (items.length === 0) {
    return null;
  }
  const rest = items.slice(shown);
  const openOf = (item: Hold) => {
    const gestures = gesturesFor(item.target);
    return {
      onAuxClick: gestures.onAuxClick,
      onClick: () => {
        gestures.destinations
          .find((destination) => destination.id === "open")
          ?.run();
      },
      onContextMenu: gestures.onContextMenu,
    };
  };
  return (
    <div className={cn("relative", className)}>
      {/* The measuring row: every tile, and the widest count the strip could show, laid out but never seen. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none invisible absolute inset-x-0 top-0 flex items-center overflow-hidden whitespace-nowrap",
          sizes.gap,
        )}
        ref={measure}
      >
        {items.map((item) => (
          <HoldTile data-tile item={item} key={item.key} size={size} />
        ))}
        <MoreChip count={total} data-more size={size} />
      </div>
      <div
        className={cn(
          "flex items-center overflow-hidden whitespace-nowrap",
          sizes.gap,
        )}
      >
        {items.slice(0, shown).map((item) => (
          <Tooltip key={item.key}>
            <TooltipTrigger asChild>
              <HoldTile item={item} size={size} {...openOf(item)} />
            </TooltipTrigger>
            <TooltipContent>{item.tip}</TooltipContent>
          </Tooltip>
        ))}
        {rest.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <MoreChip count={rest.length} size={size} />
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
                {rest.map((item) => (
                  <button
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent"
                    key={item.key}
                    title={item.tip}
                    type="button"
                    {...openOf(item)}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center [&_img]:size-4 [&_span]:size-4 [&_svg]:size-4">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.label ?? item.tip}
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

/** A site as somewhere the browser can go: a hostname is opened over https. */
function addressOf(site: string) {
  return URL.canParse(site) ? site : `https://${site}`;
}

/**
 * One tile of the strip: the mark and, past an app's, the name. The marks
 * inside take no pointer, so a favicon's own tooltip never doubles the tile's.
 */
function HoldTile({
  item,
  size,
  ...rest
}: ComponentProps<"button"> & {
  "data-tile"?: boolean;
  item: Hold;
  size: Size;
}) {
  const sizes = SIZES[size];
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center text-foreground/80 hover:bg-accent",
        item.label === undefined
          ? cn("rounded-sm p-0.5", size === "md" ? "h-6" : "h-5")
          : cn("border border-border bg-card", sizes.tile),
      )}
      type="button"
      {...rest}
    >
      <span
        className={cn(
          "pointer-events-none flex shrink-0 items-center justify-center",
          sizes.mark,
        )}
      >
        {item.icon}
      </span>
      {item.label === undefined ? null : (
        <span className={cn("truncate", sizes.label)}>{item.label}</span>
      )}
    </button>
  );
}

/** A site as its name alone: the host, with the address's machinery left off. */
function hostOf(site: string) {
  return URL.canParse(site) ? new URL(site).host : site;
}

/** The count of tiles past the strip's edge, which is the door to them. */
function MoreChip({
  count,
  size,
  ...rest
}: ComponentProps<"button"> & {
  count: number;
  "data-more"?: boolean;
  size: Size;
}) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center rounded-md font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
        SIZES[size].more,
      )}
      type="button"
      {...rest}
    >
      +{count}
    </button>
  );
}
