import { Favicon } from "@/client/components/favicon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode, useState } from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { PickList } from "./pick-list";
import {
  appsUsed,
  type Filterable,
  hasStatus,
  matchesFilters,
  NO_FILTERS,
  sitesByUse,
  THREAD_STATUSES,
  type ThreadFilters,
  type ThreadStatus,
  type Topic,
} from "./threads";
import { TopicMark } from "./topic-mark";
import { type TopicAction, TopicPickList } from "./topic-menu";

/**
 * The row of disclosures along the top of the chat, always there: a search
 * that opens from a magnifier, then Status, Topics, Apps, and Sites as one
 * chip each that opens a menu. Five click targets and never a wall of chips,
 * so the row costs the same height whether there are five topics or fifty
 * sites. A chosen group goes solid with what was chosen, how many threads that
 * reaches, and the way to undo it.
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
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  /** How many threads one group's own choice reaches, the other groups aside. */
  const reachOf = (group: Partial<ThreadFilters>) =>
    threads.filter((thread) =>
      matchesFilters(thread, { ...NO_FILTERS, ...group }, topicNames),
    ).length;
  const topicReach = new Map(
    topics.map((topic) => [topic.id, reachOf({ topics: [topic.id] })]),
  );
  const toggleIn = (group: "apps" | "sites" | "topics", id: string) => {
    onFiltersChange({ ...filters, [group]: toggled(filters[group], id) });
  };
  const clear = (group: "apps" | "sites" | "status" | "topics") => {
    onFiltersChange({ ...filters, [group]: [] });
  };
  const chosenStatus = THREAD_STATUSES.find(
    (status) => status.id === filters.status[0],
  );
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
      <SearchChip
        count={reachOf({ search: filters.search })}
        onChange={(search) => {
          onFiltersChange({ ...filters, search });
        }}
        value={filters.search}
      />
      <GroupChip
        label="Status"
        menu={
          <PickList
            chosen={new Set(filters.status)}
            entries={THREAD_STATUSES.map((status) => ({
              icon: <StatusDot status={status.id} />,
              id: status.id,
              label: status.label,
              note: String(
                threads.filter((thread) => hasStatus(thread, status.id)).length,
              ),
            }))}
            findPlaceholder="Find a state"
            onToggle={(id) => {
              const status = THREAD_STATUSES.find((entry) => entry.id === id);
              if (status) {
                onFiltersChange({
                  ...filters,
                  status: toggled(filters.status, status.id),
                });
              }
            }}
          />
        }
        onClear={() => {
          clear("status");
        }}
        {...(chosenStatus
          ? {
              chosen: {
                count: reachOf({ status: filters.status }),
                icon: <StatusDot status={chosenStatus.id} />,
                label: chosenStatus.label,
                more: filters.status.length - 1,
              },
            }
          : {})}
      />
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
 * The search as one more chip: a magnifier until it is clicked, then a field
 * in its place that narrows the list as it is typed into, with how many
 * threads the words reach and an x to clear them. Escape clears and closes it;
 * so does leaving it empty. Nothing here takes focus on its own.
 */
function SearchChip({
  count,
  onChange,
  value,
}: {
  count: number;
  onChange: (value: string) => void;
  value: string;
}) {
  const [isOpen, setOpen] = useState(false);
  if (!isOpen && value === "") {
    return (
      <button
        aria-label="Search"
        className={cn(
          CHIP,
          "bg-muted text-foreground/80 hover:text-foreground",
        )}
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        <MagnifyingGlassIcon className="size-3.5" />
      </button>
    );
  }
  const clear = () => {
    onChange("");
    setOpen(false);
  };
  return (
    <div className={cn(CHIP, "gap-0 bg-accent p-0 text-foreground")}>
      <MagnifyingGlassIcon className="ml-1.5 size-3.5 shrink-0 text-muted-foreground" />
      <input
        aria-label="Search threads"
        // Mounted by the click on the magnifier, which is the one moment the
        // field is asked for.
        autoFocus
        className="h-full w-36 bg-transparent px-1.5 text-[11px] outline-hidden placeholder:text-muted-foreground"
        onBlur={() => {
          if (value === "") {
            setOpen(false);
          }
        }}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
            clear();
          }
        }}
        placeholder="Search threads"
        type="text"
        value={value}
      />
      {value ? (
        <>
          <span className="rounded-sm bg-foreground/10 px-1 text-[10px] tabular-nums">
            {count}
          </span>
          <button
            aria-label="Clear search"
            className="grid h-full place-items-center px-1 text-muted-foreground hover:text-foreground"
            onClick={clear}
            type="button"
          >
            <XIcon className="size-2.5" weight="bold" />
          </button>
        </>
      ) : (
        <span className="w-1.5" />
      )}
    </div>
  );
}

/** The mark a state is known by: the same dot the rows wear for it, in its color. */
function StatusDot({ status }: { status: ThreadStatus }) {
  return (
    // Important: the chosen chip sizes every span it holds to the mark's box,
    // which is right for a topic's tile and too big for a dot.
    <span
      className={cn(
        "size-2! rounded-full",
        status === "unread" ? "bg-brand-500" : "bg-warning-500",
      )}
    />
  );
}

/** The list with the entry added when it was missing, and taken out when it was there. */
function toggled<T>(list: T[], entry: T): T[] {
  return list.includes(entry)
    ? list.filter((item) => item !== entry)
    : [...list, entry];
}
