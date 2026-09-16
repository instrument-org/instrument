import { Favicon } from "@/client/components/favicon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode, useState } from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { PickList } from "./pick-list";
import {
  appsUsed,
  type Filterable,
  isUnread,
  matchesFilters,
  needsYou,
  NO_FILTERS,
  sitesByUse,
  type ThreadFilters,
  type Topic,
} from "./threads";
import { TopicMark } from "./topic-mark";
import { type TopicAction, TopicPickList } from "./topic-menu";

/**
 * The row of disclosures along the top of the chat, always there: Unread and
 * Needs you while there is any, each with its count, then Topics, Apps, and
 * Sites as one chip each that opens a menu. Five click targets at most and
 * never a wall of chips, so the row costs the same height whether there are
 * five topics or fifty sites. A chosen group goes solid with what was chosen,
 * how many threads that reaches, and the way to undo it.
 */
export function FilterBar({
  appsBySlug,
  filters,
  onFiltersChange,
  onManageTopic,
  onNewTopic,
  threads,
  topics,
}: {
  appsBySlug: AppsBySlug;
  filters: ThreadFilters;
  onFiltersChange: (filters: ThreadFilters) => void;
  onManageTopic: (action: TopicAction, topic: Topic) => void;
  onNewTopic: () => void;
  threads: Filterable[];
  topics: Topic[];
}) {
  const unreadCount = threads.filter(isUnread).length;
  const needsYouCount = threads.filter(needsYou).length;
  /** How many threads one group's own choice reaches, the other groups aside. */
  const reachOf = (group: Partial<ThreadFilters>) =>
    threads.filter((thread) =>
      matchesFilters(thread, { ...NO_FILTERS, ...group }),
    ).length;
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const topicReach = new Map(
    topics.map((topic) => [topic.id, reachOf({ topics: [topic.id] })]),
  );
  const toggleIn = (group: "apps" | "sites" | "topics", id: string) => {
    const current = filters[group];
    onFiltersChange({
      ...filters,
      [group]: current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    });
  };
  const clear = (group: "apps" | "sites" | "topics") => {
    onFiltersChange({ ...filters, [group]: [] });
  };
  const chosenTopic = topicsById.get(filters.topics[0] ?? "");
  const chosenApp = filters.apps[0];
  const chosenSite = filters.sites[0];
  const apps = appsUsed(threads);
  const sites = sitesByUse(threads);

  return (
    <div
      aria-label="Filters"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5"
      role="toolbar"
    >
      {unreadCount > 0 && (
        <ToggleChip
          count={unreadCount}
          on={filters.unread}
          onToggle={() => {
            onFiltersChange({ ...filters, unread: !filters.unread });
          }}
          tone="brand"
        >
          Unread
        </ToggleChip>
      )}
      {needsYouCount > 0 && (
        <ToggleChip
          count={needsYouCount}
          on={filters.needsYou}
          onToggle={() => {
            onFiltersChange({ ...filters, needsYou: !filters.needsYou });
          }}
          tone="warning"
        >
          Needs you
        </ToggleChip>
      )}
      <GroupChip
        label="Topics"
        menu={
          <TopicPickList
            chosen={new Set(filters.topics)}
            notes={topicReach}
            onManage={onManageTopic}
            onNew={onNewTopic}
            onToggle={(id) => {
              toggleIn("topics", id);
            }}
            topics={topics}
          />
        }
        onClear={() => {
          clear("topics");
        }}
        {...(chosenTopic
          ? {
              chosen: {
                count: reachOf({ topics: filters.topics }),
                icon: <TopicMark topic={chosenTopic} />,
                label: chosenTopic.name,
                more: filters.topics.length - 1,
              },
            }
          : {})}
      />
      <GroupChip
        label="Apps"
        menu={
          <PickList
            chosen={new Set(filters.apps)}
            entries={apps
              .map((slug) => ({
                icon: (
                  <AppIcon
                    className="size-4"
                    site={appsBySlug.get(slug)?.site}
                    size="sm"
                  />
                ),
                id: slug,
                label: appsBySlug.get(slug)?.name ?? slug,
                note: String(reachOf({ apps: [slug] })),
              }))
              .sort((a, b) => a.label.localeCompare(b.label))}
            findPlaceholder="Find an app"
            onToggle={(id) => {
              toggleIn("apps", id);
            }}
          />
        }
        onClear={() => {
          clear("apps");
        }}
        {...(chosenApp
          ? {
              chosen: {
                count: reachOf({ apps: filters.apps }),
                icon: (
                  <AppIcon
                    className="size-4"
                    site={appsBySlug.get(chosenApp)?.site}
                    size="sm"
                  />
                ),
                label: appsBySlug.get(chosenApp)?.name ?? chosenApp,
                more: filters.apps.length - 1,
              },
            }
          : {})}
      />
      <GroupChip
        label="Sites"
        menu={
          <PickList
            chosen={new Set(filters.sites)}
            entries={sites.map((host) => ({
              icon: <Favicon className="size-4" url={`https://${host}`} />,
              id: host,
              label: host,
              note: String(reachOf({ sites: [host] })),
            }))}
            findPlaceholder="Find a site"
            onToggle={(id) => {
              toggleIn("sites", id);
            }}
          />
        }
        onClear={() => {
          clear("sites");
        }}
        {...(chosenSite
          ? {
              chosen: {
                count: reachOf({ sites: filters.sites }),
                icon: (
                  <Favicon className="size-4" url={`https://${chosenSite}`} />
                ),
                label: chosenSite,
                more: filters.sites.length - 1,
              },
            }
          : {})}
      />
    </div>
  );
}

const CHIP =
  "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px]";

/**
 * A group of filters as one chip: a suggestion with a caret until something
 * in its menu is chosen, then solid with the choice, its reach, and an x.
 */
function GroupChip({
  chosen,
  label,
  menu,
  onClear,
}: {
  chosen?: {
    count: number;
    icon: ReactNode;
    label: string;
    /** How many more were chosen in the same group, past the one named. */
    more: number;
  };
  label: string;
  menu: ReactNode;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <div
        className={cn(
          CHIP,
          "gap-0 p-0",
          chosen
            ? "bg-foreground text-background"
            : open
              ? "bg-accent text-foreground"
              : "bg-muted text-foreground/80 hover:text-foreground",
        )}
      >
        <PopoverTrigger asChild>
          <button
            aria-expanded={open}
            aria-label={chosen ? `${label}: ${chosen.label}` : label}
            className="flex h-full items-center gap-1 pl-1.5"
            type="button"
          >
            {chosen ? (
              <>
                <span className="flex size-3.5 items-center justify-center [&_img]:size-3.5 [&_span]:size-3.5">
                  {chosen.icon}
                </span>
                <span className="max-w-28 truncate">
                  {chosen.label}
                  {chosen.more > 0 ? ` +${chosen.more}` : ""}
                </span>
                <span className="rounded-sm bg-background/20 px-1 text-[10px] tabular-nums">
                  {chosen.count}
                </span>
              </>
            ) : (
              <>
                <span>{label}</span>
                <CaretDownIcon className="size-2.5 text-muted-foreground" />
              </>
            )}
          </button>
        </PopoverTrigger>
        {chosen ? (
          <button
            aria-label={`Clear ${label}`}
            className="grid h-full place-items-center px-1 text-background/70 hover:text-background"
            onClick={onClear}
            type="button"
          >
            <XIcon className="size-2.5" weight="bold" />
          </button>
        ) : (
          <span className="w-1.5" />
        )}
      </div>
      <PopoverContent
        align="start"
        className="w-60 p-1"
        role="menu"
        side="bottom"
        sideOffset={4}
      >
        {menu}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A filter that is a state rather than a group: on or off, carrying how many
 * threads are in that state, in the color the rows wear for it.
 */
function ToggleChip({
  children,
  count,
  on,
  onToggle,
  tone,
}: {
  children: ReactNode;
  count: number;
  on: boolean;
  onToggle: () => void;
  tone: "brand" | "warning";
}) {
  return (
    <button
      aria-pressed={on}
      className={cn(
        CHIP,
        "gap-1.5",
        tone === "brand"
          ? on
            ? "bg-brand-600 text-white"
            : "bg-brand-50 text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-200 dark:ring-brand-800"
          : on
            ? "bg-warning-500 text-white"
            : "bg-warning-50 text-warning-900 ring-1 ring-warning-300 hover:bg-warning-100 dark:bg-warning-900/30 dark:text-warning-300 dark:ring-warning-700",
      )}
      onClick={onToggle}
      type="button"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          on
            ? "bg-white"
            : tone === "brand"
              ? "bg-brand-500"
              : "bg-warning-500",
        )}
      />
      <span>{children}</span>
      <span className={cn(on ? "text-white/80" : "opacity-80")}>{count}</span>
    </button>
  );
}
