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
import { cn } from "@/client/lib/utils";
import { CircleIcon } from "@phosphor-icons/react/Circle";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { TrayIcon } from "@phosphor-icons/react/Tray";
import { Fragment, type ReactNode, useState } from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { type PickEntry, PickList } from "./pick-list";
import {
  appsUsed,
  chooseOnly,
  type Filterable,
  foldSection,
  isInbox,
  NO_FILTERS,
  type ThreadFilters,
  type ThreadPlace,
  type Topic,
} from "./threads";
import { TopicMark } from "./topic-mark";
import {
  TopicActionsButton,
  TopicContextMenu,
  TopicPickList,
} from "./topic-menu";

/** How many of a section's marks the strip shows before the rest fold behind a dots mark. */
const STRIP_SHOWN = 4;

/** The groups whose rows carry ids of the user's things, in the order the column draws them under the places. */
type Group = "apps" | "topics";

/** One of the places above the topics: where the column stands when no topic or app is chosen. The inbox is no filter at all. */
interface Place {
  icon: ReactNode;
  id: "inbox" | ThreadPlace;
  label: string;
}

/** One section of the column: its rows, which are on, and how a row is turned. */
interface Section {
  chosen: ReadonlySet<string>;
  entries: PickEntry[];
  findPlaceholder: string;
  id: Group;
  label: string;
  onToggle: (id: string) => void;
}

/** The places in the order they are drawn: everything, what is new, and what is not yet sent. */
const PLACES: Place[] = [
  { icon: <TrayIcon className="size-4" />, id: "inbox", label: "Inbox" },
  { icon: <CircleIcon className="size-4" />, id: "unread", label: "Unread" },
  {
    icon: <PencilSimpleIcon className="size-4" />,
    id: "drafts",
    label: "Drafts",
  },
];

/** A chosen row or mark: a tint, never a fill, so the column reads the same in either theme. */
const CHOSEN = "bg-foreground/8 text-foreground";

/** A row or mark that is not chosen, and what the pointer does to it. */
const UNCHOSEN =
  "text-foreground/80 hover:bg-foreground/5 hover:text-foreground";

/**
 * The sections down the left of the inbox, inside the pane: the places
 * (Inbox, which is everything, Unread, and Drafts), then the topics as rows
 * with their marks, then the apps. A row is a place to click from and to
 * find again, which a menu is not, and the places and the topics carry how
 * many threads each holds at their right edge. The rows are one radio group
 * across the whole column: choosing one is standing in it, choosing another
 * is moving, and choosing it again is stepping back out to the inbox, so the
 * list is never narrowed by two kinds at once; only the search over the list
 * adds to whatever is chosen. When the pane is narrow the column shrinks in
 * place to a strip of marks, one per row; it never moves to the top.
 */
export function FilterColumn({
  appsBySlug,
  filters,
  onFiltersChange,
  onNewTopic,
  onTopicDetails,
  threads,
  topics,
}: {
  appsBySlug: AppsBySlug;
  filters: ThreadFilters;
  onFiltersChange: (filters: ThreadFilters) => void;
  onNewTopic: () => void;
  /** Opens a topic's details: its name, its mark, and the way to delete it. */
  onTopicDetails: (topic: Topic) => void;
  threads: Filterable[];
  topics: Topic[];
}) {
  const live = topics.filter((topic) => !topic.retired);
  const topicsById = new Map(live.map((topic) => [topic.id, topic]));
  const chooseIn = (group: Group, id: string) => {
    onFiltersChange(chooseOnly(filters, { group, id }));
  };
  /** How many threads a place holds, said on its row above zero: drafts are not threads, so that row says nothing yet. */
  const placeCount = (id: Place["id"]) =>
    id === "inbox"
      ? threads.length
      : id === "unread"
        ? threads.filter((thread) => thread.unread > 0).length
        : 0;
  const placeEntry = (place: Place): PickEntry => ({
    icon: place.icon,
    id: place.id,
    label: place.label,
    ...noteOf(placeCount(place.id)),
  });
  const isPlaceOn = (place: Place) =>
    place.id === "inbox" ? isInbox(filters) : filters.place === place.id;
  /** Standing in a place: the inbox is standing nowhere in particular, so choosing it steps out of everything. */
  const choosePlace = (id: Place["id"]) => {
    onFiltersChange(
      id === "inbox"
        ? { ...NO_FILTERS, search: filters.search }
        : chooseOnly(filters, { group: "place", id }),
    );
  };
  const sections: Section[] = [
    {
      chosen: new Set(filters.topics),
      entries: live.map((topic) => ({
        icon: <TopicMark topic={topic} />,
        id: topic.id,
        label: topic.name,
        ...noteOf(
          threads.filter((thread) => thread.topics.includes(topic.id)).length,
        ),
      })),
      findPlaceholder: "Find a topic",
      id: "topics",
      label: "Topics",
      onToggle: (id) => {
        chooseIn("topics", id);
      },
    },
    {
      chosen: new Set(filters.apps),
      entries: appsUsed(threads)
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
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      findPlaceholder: "Find an app",
      id: "apps",
      label: "Apps",
      onToggle: (id) => {
        chooseIn("apps", id);
      },
    },
  ];
  /** The list a section's marks open in the strip: the topics' own, with its menus and its new-topic foot, or a plain pick list. */
  const listOf = (section: Section) =>
    section.id === "topics" ? (
      <TopicPickList
        chosen={section.chosen}
        onDetails={onTopicDetails}
        onNew={onNewTopic}
        onToggle={section.onToggle}
        topics={topics}
      />
    ) : (
      <PickList
        chosen={section.chosen}
        entries={section.entries}
        findPlaceholder={section.findPlaceholder}
        onToggle={section.onToggle}
      />
    );

  return (
    <aside className="flex h-full w-9 shrink-0 flex-col border-r border-border bg-muted/40 @[30rem]/chat:w-40">
      {/* The full column, at width. */}
      <div
        aria-label="Filters"
        className="hidden min-h-0 flex-1 flex-col @[30rem]/chat:flex"
        role="group"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <section aria-label="Places" className="pt-2">
            {PLACES.map((place) => (
              <FilterRow
                entry={placeEntry(place)}
                isOn={isPlaceOn(place)}
                key={place.id}
                onToggle={() => {
                  choosePlace(place.id);
                }}
              />
            ))}
          </section>
          {sections.map((section) =>
            section.id === "topics" ? (
              <ColumnSection
                headTrailing={
                  <button
                    aria-label="New topic"
                    className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    onClick={onNewTopic}
                    type="button"
                  >
                    <PlusIcon className="size-3.5" weight="bold" />
                  </button>
                }
                key={section.id}
                rowOf={(entry, isOn) => {
                  const topic = topicsById.get(entry.id);
                  if (!topic) {
                    return null;
                  }
                  return (
                    <TopicContextMenu onDetails={onTopicDetails} topic={topic}>
                      <FilterRow
                        entry={entry}
                        isOn={isOn}
                        onToggle={section.onToggle}
                        trailing={
                          <TopicActionsButton
                            className="group-hover/row:opacity-100"
                            onDetails={onTopicDetails}
                            topic={topic}
                          />
                        }
                      />
                    </TopicContextMenu>
                  );
                }}
                section={section}
              />
            ) : (
              section.entries.length > 0 && (
                <ColumnSection
                  key={section.id}
                  rowOf={(entry, isOn) => (
                    <FilterRow
                      entry={entry}
                      isOn={isOn}
                      onToggle={section.onToggle}
                    />
                  )}
                  section={section}
                />
              )
            ),
          )}
        </div>
      </div>
      {/* The strip of marks the column shrinks to: the same order, the same place. */}
      <div
        aria-label="Filter marks"
        aria-orientation="vertical"
        className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto pt-2 pb-2 @[30rem]/chat:hidden"
        role="toolbar"
      >
        {PLACES.map((place) => (
          <PlaceMark
            isOn={isPlaceOn(place)}
            key={place.id}
            label={place.label}
            onChoose={() => {
              choosePlace(place.id);
            }}
          >
            {place.icon}
          </PlaceMark>
        ))}
        {sections.map((section) => {
          if (section.id !== "topics" && section.entries.length === 0) {
            return null;
          }
          return (
            <Fragment key={section.id}>
              <Rule />
              <SectionMarks list={listOf(section)} section={section} />
            </Fragment>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * A section at width: its head, its rows, and past the first several a row
 * saying how many more there are that opens the rest, then reads "Less" and
 * folds them again. A chosen row past the fold shows regardless, so it can
 * be turned off from where it was turned on.
 */
function ColumnSection({
  headTrailing,
  rowOf,
  section,
}: {
  /** At the right of the head: the section's own action. */
  headTrailing?: ReactNode;
  rowOf: (entry: PickEntry, isOn: boolean) => ReactNode;
  section: Section;
}) {
  const [isExpanded, setExpanded] = useState(false);
  const folded = foldSection(section.entries, section.chosen);
  const shown = isExpanded ? section.entries : folded.shown;
  return (
    <section aria-label={section.label}>
      <div className="flex h-8 items-center justify-between pt-2 pl-1.5">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {section.label}
        </p>
        {headTrailing}
      </div>
      {shown.map((entry) => (
        <Fragment key={entry.id}>
          {rowOf(entry, section.chosen.has(entry.id))}
        </Fragment>
      ))}
      {folded.hidden > 0 && (
        <button
          className="flex h-7 w-full items-center rounded-md px-1.5 text-left text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => {
            setExpanded(!isExpanded);
          }}
          type="button"
        >
          {isExpanded ? "Less" : `${folded.hidden} more`}
        </button>
      )}
    </section>
  );
}

/** One row of the column: its mark, its name, its figure if it has one, and whether it is on, which the row's whole face says. */
function FilterRow({
  entry,
  isOn,
  onToggle,
  trailing,
}: {
  entry: PickEntry;
  isOn: boolean;
  onToggle: (id: string) => void;
  /** Something at the row's edge past the name, for the row's own menu. */
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/row flex h-7 items-center rounded-md pr-1",
        isOn ? CHOSEN : UNCHOSEN,
      )}
    >
      <button
        aria-pressed={isOn}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-1.5 text-left text-xs"
        onClick={() => {
          onToggle(entry.id);
        }}
        type="button"
      >
        {/* The row is named by its words; the mark beside them is decoration, whatever alt text it brings. */}
        <span
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center"
        >
          {entry.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.note && (
          <span className="shrink-0 pr-0.5 text-[10px] text-muted-foreground tabular-nums">
            {entry.note}
          </span>
        )}
      </button>
      {trailing}
    </div>
  );
}

/** One mark of the strip: a tile that is tinted when its row is on, and opens a list beside it. */
function Mark({
  children,
  isOn,
  label,
  list,
}: {
  children: ReactNode;
  isOn: boolean;
  label: string;
  list: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              aria-label={label}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground",
                isOn ? CHOSEN : UNCHOSEN,
              )}
              data-chosen={isOn || undefined}
              type="button"
            >
              {children}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-60 p-1"
        role="menu"
        side="right"
        sideOffset={6}
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}

/** A count as a row's note, and nothing when there is nothing to count. */
function noteOf(count: number): { note?: string } {
  return count > 0 ? { note: String(count) } : {};
}

/** A place's mark in the strip: the row itself at a smaller size, since a place has no list to open. */
function PlaceMark({
  children,
  isOn,
  label,
  onChoose,
}: {
  children: ReactNode;
  isOn: boolean;
  label: string;
  onChoose: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={isOn}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md",
            isOn ? CHOSEN : UNCHOSEN,
          )}
          data-chosen={isOn || undefined}
          onClick={onChoose}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** A hairline between the strip's sections, where the column has a head. */
function Rule() {
  return <span aria-hidden className="my-1 h-px w-5 shrink-0 bg-border" />;
}

/**
 * A section's marks in the strip: one per row up to a few, then a dots mark
 * for the rest, tinted when one of the rest is on. Every mark opens the same
 * list, since a mark alone says what is on and not what else there is.
 */
function SectionMarks({
  list,
  section,
}: {
  list: ReactNode;
  section: Section;
}) {
  const { hidden, shown } = foldSection(
    section.entries,
    section.chosen,
    STRIP_SHOWN,
  );
  const shownIds = new Set(shown.map((entry) => entry.id));
  const isRestOn = [...section.chosen].some((id) => !shownIds.has(id));
  return (
    <>
      {shown.map((entry) => (
        <Mark
          isOn={section.chosen.has(entry.id)}
          key={entry.id}
          label={entry.label}
          list={list}
        >
          {entry.icon}
        </Mark>
      ))}
      {hidden > 0 && (
        <Mark isOn={isRestOn} label={`${hidden} more`} list={list}>
          <DotsThreeIcon className="size-4" weight="bold" />
        </Mark>
      )}
    </>
  );
}
