import { Favicon } from "@/client/components/favicon";
import { FileIcon } from "@/client/components/file-icon";
import { FileOpenContext } from "@/client/components/file-open-context";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { differenceInCalendarDays, format, isSameYear } from "date-fns";
import {
  type ComponentProps,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { useOrchestrator } from "./context";
import { TopicMark, type TopicMarkSpec } from "./topic-mark";

/** A topic the thread carries, by id, with what it is drawn as. */
export type ThreadTopic = TopicMarkSpec & { id: string; name: string };

/** One thing a thread made or used: a file, a site, or an app, with the way it opens. */
interface Hold {
  icon: ReactNode;
  key: string;
  label: string;
  open: () => void;
}

/**
 * The head of a thread opened as a screen, which does not scroll: its topics'
 * marks, the title the agent keeps for it in bold beside them, since when, and
 * the strip of what it has made and used so far, oldest at the left. The
 * thread's identity, first in the pane rather than a label in a title bar.
 */
export function ThreadHead({
  appsBySlug,
  createdAt,
  holds,
  title,
  topics,
}: {
  appsBySlug: AppsBySlug;
  createdAt: Date | undefined;
  holds: { apps: string[]; files: string[]; sites: string[] };
  title: string;
  topics: ThreadTopic[];
}) {
  const { openPage, openScreen } = useOrchestrator();
  const openFile = useContext(FileOpenContext);
  const items: Hold[] = [
    ...holds.files.map((path) => {
      const name = path.split("/").at(-1) || path;
      return {
        icon: <FileIcon className="size-3.5" filename={name} />,
        key: `file:${path}`,
        label: name,
        open: () => openFile?.(path, { newTab: true }),
      };
    }),
    ...holds.apps.map((slug) => {
      const app = appsBySlug.get(slug);
      return {
        icon: <AppIcon site={app?.site} size="sm" />,
        key: `app:${slug}`,
        label: app?.name ?? slug,
        open: () => {
          openScreen(`/orchestrator/apps/${slug}`, { newTab: true });
        },
      };
    }),
    ...holds.sites.map((site) => ({
      icon: <Favicon className="size-3.5" url={site} />,
      key: `site:${site}`,
      label: hostOf(site),
      open: () => {
        openPage(addressOf(site), { newTab: true });
      },
    })),
  ];
  return (
    <div className="shrink-0 border-b border-border bg-muted/40 px-4 pt-3 pb-2.5">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        {topics.map((topic) => (
          <TopicMark
            className="size-5 rounded-md text-[12px]"
            key={topic.id}
            topic={topic}
          />
        ))}
        <span className="min-w-0 truncate">{title}</span>
      </p>
      {createdAt ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          since {sinceLabel(createdAt, new Date())}
        </p>
      ) : null}
      {items.length > 0 ? (
        <div className="mt-2.5">
          <HoldStrip items={items} />
        </div>
      ) : null}
    </div>
  );
}

/** A site as somewhere the browser can go: a hostname is opened over https. */
function addressOf(site: string) {
  return URL.canParse(site) ? site : `https://${site}`;
}

/**
 * The strip of what the thread made and used, in one row that clips at the
 * right: as many tiles as fit, then a count of what is past the edge, which
 * opens the rest. Every tile is measured off screen so the count is the
 * count of what really did not fit, at this width and this zoom.
 */
function HoldStrip({ items }: { items: Hold[] }) {
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
  const rest = items.slice(shown);
  return (
    <div className="relative">
      {/* The measuring row: every tile, and the widest count the strip could show, laid out but never seen. */}
      <div
        aria-hidden
        className="pointer-events-none invisible absolute inset-x-0 top-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap"
        ref={measure}
      >
        {items.map((item) => (
          <HoldTile data-tile item={item} key={item.key} />
        ))}
        <MoreChip count={total} data-more />
      </div>
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
        {items.slice(0, shown).map((item) => (
          <HoldTile item={item} key={item.key} />
        ))}
        {rest.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <MoreChip count={rest.length} />
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
                    onClick={item.open}
                    type="button"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
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

/** One tile of the strip: the mark and the name, opening the thing on a press. */
function HoldTile({
  item,
  ...rest
}: ComponentProps<"button"> & { "data-tile"?: boolean; item: Hold }) {
  return (
    <button
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-[11px] text-foreground/80 hover:bg-accent"
      onClick={item.open}
      title={item.label}
      type="button"
      {...rest}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center [&_img]:size-3.5 [&_svg]:size-3.5">
        {item.icon}
      </span>
      <span className="max-w-40 truncate">{item.label}</span>
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
  ...rest
}: ComponentProps<"button"> & { count: number; "data-more"?: boolean }) {
  return (
    <button
      className="inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      type="button"
      {...rest}
    >
      +{count}
    </button>
  );
}

/**
 * When the thread began, in the words a person says it in: today, yesterday,
 * a weekday while the week is still in mind, and a date past that.
 */
function sinceLabel(date: Date, now: Date) {
  const days = differenceInCalendarDays(now, date);
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  if (days < 7) {
    return format(date, "EEEE");
  }
  return format(date, isSameYear(date, now) ? "MMM d" : "MMM d, yyyy");
}
