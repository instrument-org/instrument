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

import {
  type ActivityFilters,
  type ActivityRow,
  appsIn,
  matchesActivityFilters,
  NO_ACTIVITY_FILTERS,
  sitesByUse,
} from "./activity";
import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { PickList } from "./pick-list";
import { type Topic } from "./threads";
import { TopicMark } from "./topic-mark";

const CHIP =
  "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px]";

/**
 * The row of disclosures along the top of Activity, in the shape of the
 * chat's own: Yours as a toggle carrying how many rows are the user's, then
 * Topics, Apps, and Sites as one chip each that opens a menu. A chosen group
 * goes solid with what was chosen, how many rows that reaches, and the way to
 * undo it.
 */
export function ActivityFilterBar({
  appsBySlug,
  filters,
  onFiltersChange,
  rows,
  topics,
}: {
  appsBySlug: AppsBySlug;
  filters: ActivityFilters;
  onFiltersChange: (filters: ActivityFilters) => void;
  rows: ActivityRow[];
  topics: Topic[];
}) {
  /** How many rows one group's own choice reaches, the other groups aside. */
  const reachOf = (group: Partial<ActivityFilters>) =>
    rows.filter((row) =>
      matchesActivityFilters(row, { ...NO_ACTIVITY_FILTERS, ...group }),
    ).length;
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
  const chosenTopic = topics.find((topic) => topic.id === filters.topics[0]);
  const chosenApp = filters.apps[0];
  const chosenSite = filters.sites[0];
  const apps = appsIn(rows);
  const sites = sitesByUse(rows);
  const yoursCount = reachOf({ yours: true });

  return (
    <div
      aria-label="Filters"
      className="flex shrink-0 flex-wrap items-center gap-1"
      role="toolbar"
    >
      <button
        aria-pressed={filters.yours}
        className={cn(
          CHIP,
          "gap-1.5",
          filters.yours
            ? "bg-foreground text-background"
            : "bg-muted text-foreground/80 hover:text-foreground",
        )}
        onClick={() => {
          onFiltersChange({ ...filters, yours: !filters.yours });
        }}
        type="button"
      >
        <span>Yours</span>
        <span
          className={cn(filters.yours ? "text-background/80" : "opacity-80")}
        >
          {yoursCount}
        </span>
      </button>
      <GroupChip
        label="Topics"
        menu={
          <PickList
            chosen={new Set(filters.topics)}
            entries={topics
              .filter(
                (topic) => !topic.retired || filters.topics.includes(topic.id),
              )
              .map((topic) => ({
                icon: <TopicMark size="sm" topic={topic} />,
                id: topic.id,
                label: topic.name,
                note: String(reachOf({ topics: [topic.id] })),
              }))}
            findPlaceholder="Find a topic"
            onToggle={(id) => {
              toggleIn("topics", id);
            }}
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
