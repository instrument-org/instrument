import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { FileDashedIcon } from "@phosphor-icons/react/FileDashed";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { StarIcon } from "@phosphor-icons/react/Star";
import { TrayIcon } from "@phosphor-icons/react/Tray";
import { type ReactNode, useState } from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { type PickEntry } from "./pick-list";
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
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicActionsButton, TopicContextMenu } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** One of the places under the topics: where the column stands when no topic or app is chosen. The inbox is no filter at all. */
interface Place {
  icon: ReactNode;
  id: "inbox" | ThreadPlace;
  label: string;
}

/** The places in the order they are drawn: the inbox, what is new, what waits on the user, what is starred, what is not yet sent, and the whole of it, put away included. */
const PLACES: Place[] = [
  { icon: <TrayIcon className="size-4" />, id: "inbox", label: "Inbox" },
  {
    icon: <EnvelopeSimpleIcon className="size-4" />,
    id: "unread",
    label: "Unread",
  },
  {
    // The same amber dot a waiting thread wears in its gutter.
    icon: <span className="size-2 rounded-full bg-warning-500" />,
    id: "needsYou",
    label: "Needs you",
  },
  { icon: <StarIcon className="size-4" />, id: "starred", label: "Starred" },
  {
    icon: <FileDashedIcon className="size-4" />,
    id: "drafts",
    label: "Drafts",
  },
  { icon: <CardsThreeIcon className="size-4" />, id: "all", label: "All" },
];

/** A chosen row or mark: a tint, never a fill, so the column reads the same in either theme. */
const CHOSEN = "bg-foreground/8 text-foreground";

/** A row or mark that is not chosen, and what the pointer does to it. */
const UNCHOSEN =
  "text-foreground/80 hover:bg-foreground/5 hover:text-foreground";

/** The apps section: which are on, the rows, and how a row is turned. */
interface AppSection {
  chosen: ReadonlySet<string>;
  entries: PickEntry[];
  onToggle: (id: string) => void;
}

/** What both shapes of the column are built from. */
interface FilterProps {
  appsBySlug: AppsBySlug;
  filters: ThreadFilters;
  onFiltersChange: (filters: ThreadFilters) => void;
  /** Opens a draft of a new thread. */
  onNew: () => void;
  onNewTopic: () => void;
  /** Opens a topic's details: its name, its mark, and the way to delete it. */
  onTopicDetails: (topic: Topic) => void;
  threads: Filterable[];
  topics: Topic[];
}

/** One of the places as the column reads it: its row's entry, whether it is stood in, and how to stand in it. */
interface PlaceModel extends Place {
  choose: () => void;
  entry: PickEntry;
}

/**
 * The sections at the inbox's side, inside the pane: the topics as a grid of
 * tiles first, unlabeled, since a tile is its own label; the places under
 * them (Inbox, which is every thread not put away, Unread, Needs you,
 * Starred, Drafts, and All, which is every thread, put away or not); and past
 * a rule the apps, as rows. No counts on any of them: a figure beside every
 * row is detail nobody reads. The rows and tiles are one radio group across
 * the whole column: choosing one is standing in it, choosing another is
 * moving, and choosing it again is stepping back out to the inbox, so the
 * list is never narrowed by two kinds at once; only the search over the list
 * adds to whatever is chosen. When the pane is narrow the column gives way to
 * `FilterHead` over the list, which holds the same choices.
 */
export function FilterColumn(props: FilterProps) {
  const { apps, isPlaceOn, onNew, onNewTopic, onTopicDetails, places, topics } =
    useFilterModel(props);
  return (
    <aside
      aria-label="Filters"
      className="hidden h-full w-40 shrink-0 flex-col border-r border-border bg-muted/40 @[30rem]/chat:flex"
      role="group"
    >
      {/* The way to a new thread, at the top of the column and across it,
        in the brand's own green: a draft opens at the corner, not a field
        at the foot of the list. */}
      <div className="shrink-0 px-2 pt-2">
        <Button className="h-8 w-full" onClick={onNew} variant="brand">
          <PencilSimpleIcon className="size-3.5" />
          New
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <TopicGrid
          onDetails={onTopicDetails}
          onNewTopic={onNewTopic}
          topics={topics}
        />
        <section aria-label="Places" className="pt-1">
          {places.map((place) => (
            <FilterRow
              entry={place.entry}
              isOn={isPlaceOn(place)}
              key={place.id}
              onToggle={place.choose}
            />
          ))}
        </section>
        {apps.entries.length > 0 && (
          <>
            <Rule />
            <AppRows section={apps} />
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * The same choices over the list, for a pane too narrow for a column beside
 * it: the places as marks on one line, the one stood in wearing its name,
 * with the way to a new thread at the line's end; then the topics as tiles.
 * The apps stay out of the head: a narrow pane has no room for a row of
 * them, and the search over the list finds a thread by its app.
 */
export function FilterHead(props: FilterProps) {
  const { isPlaceOn, onNew, onNewTopic, onTopicDetails, places, topics } =
    useFilterModel(props);
  return (
    <div
      aria-label="Filters"
      className="flex shrink-0 flex-col gap-2 px-3 pt-2 @[30rem]/chat:hidden"
      role="group"
    >
      <div
        aria-label="Places"
        className="flex items-center gap-1"
        role="toolbar"
      >
        {places.map((place) => (
          <PlaceMark
            isOn={isPlaceOn(place)}
            key={place.id}
            label={place.label}
            onChoose={place.choose}
          >
            {place.icon}
          </PlaceMark>
        ))}
        <Button
          aria-label="New"
          className="ml-auto size-8 rounded-full"
          onClick={onNew}
          size="icon"
          variant="brand"
        >
          <PencilSimpleIcon className="size-3.5" />
        </Button>
      </div>
      <TopicGrid
        onDetails={onTopicDetails}
        onNewTopic={onNewTopic}
        topics={topics}
      />
    </div>
  );
}

/**
 * The apps as rows past the rule, folded past the first several behind a row
 * saying how many more there are that opens the rest, then reads "Less" and
 * folds them again. A chosen row past the fold shows regardless, so it can
 * be turned off from where it was turned on.
 */
function AppRows({ section }: { section: AppSection }) {
  const [isExpanded, setExpanded] = useState(false);
  const folded = foldSection(section.entries, section.chosen);
  const shown = isExpanded ? section.entries : folded.shown;
  return (
    <section aria-label="Apps">
      {shown.map((entry) => (
        <FilterRow
          entry={entry}
          isOn={section.chosen.has(entry.id)}
          key={entry.id}
          onToggle={() => {
            section.onToggle(entry.id);
          }}
        />
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

/** One row of the column: its mark, its name, and whether it is on, which the row's whole face says. */
function FilterRow({
  entry,
  isOn,
  onToggle,
}: {
  entry: PickEntry;
  isOn: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={isOn}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-2 rounded-md pl-1.5 text-left text-xs",
        isOn ? CHOSEN : UNCHOSEN,
      )}
      onClick={onToggle}
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
    </button>
  );
}

/**
 * A place's mark in the head: its glyph alone, and its name beside the glyph
 * while it is the place stood in, so the line says where the list is without
 * a label on every mark.
 */
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
  const mark = (
    <button
      aria-label={label}
      aria-pressed={isOn}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-lg text-xs",
        isOn
          ? cn(CHOSEN, "px-2.5 font-medium")
          : cn(UNCHOSEN, "w-8 justify-center"),
      )}
      data-chosen={isOn || undefined}
      onClick={onChoose}
      type="button"
    >
      {children}
      {isOn && <span>{label}</span>}
    </button>
  );
  if (isOn) {
    return mark;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{mark}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** A hairline between the column's sections. */
function Rule() {
  return <span aria-hidden className="my-2 block h-px w-full bg-border" />;
}

/**
 * The topics as tiles in a grid, each the topic's mark on its own tinted
 * tile, the way a home screen holds its apps: a tile is its own label, so
 * the grid has none and the name is the tooltip. The tile stood in wears a
 * ring. A right click, or the dots that show on hover, open the topic's
 * details; the dashed tile at the end makes a new one.
 */
function TopicGrid({
  onDetails,
  onNewTopic,
  topics,
}: {
  onDetails: (topic: Topic) => void;
  onNewTopic: () => void;
  topics: { choose: () => void; isOn: boolean; topic: Topic }[];
}) {
  return (
    <div
      aria-label="Topics"
      className="grid grid-cols-[repeat(auto-fill,2.75rem)] gap-1 py-2"
      role="toolbar"
    >
      {topics.map(({ choose, isOn, topic }) => (
        <TopicContextMenu key={topic.id} onDetails={onDetails} topic={topic}>
          <div className="group/tile relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={topic.name}
                  aria-pressed={isOn}
                  className={cn(
                    "grid size-11 place-items-center rounded-xl bg-(--topic-tint-surface) text-[22px] leading-none topic-tint hover:bg-(--topic-tint-edge)",
                    isOn && "bg-(--topic-tint-edge) ring-2 ring-foreground/30",
                  )}
                  data-chosen={isOn || undefined}
                  onClick={choose}
                  style={topicTint(topicColor(topic))}
                  type="button"
                >
                  <TopicMark
                    className="bg-transparent!"
                    size="lg"
                    topic={topic}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{topic.name}</TooltipContent>
            </Tooltip>
            <span className="absolute -top-1 -right-1 hidden group-hover/tile:flex focus-within:flex has-[[data-state=open]]:flex">
              <TopicActionsButton
                className="bg-background opacity-100 shadow-xs ring-1 ring-border"
                onDetails={onDetails}
                topic={topic}
              />
            </span>
          </div>
        </TopicContextMenu>
      ))}
      <button
        aria-label="New topic"
        className="grid size-11 place-items-center rounded-xl border border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
        onClick={onNewTopic}
        type="button"
      >
        <PlusIcon className="size-4" weight="bold" />
      </button>
    </div>
  );
}

/**
 * What both shapes draw from: the places with their choosers, the topics
 * with their choosers, and the apps as a section. Needs you is a place only
 * while something needs the user: an empty amber row would be a warning about
 * nothing.
 */
function useFilterModel({
  appsBySlug,
  filters,
  onFiltersChange,
  onNew,
  onNewTopic,
  onTopicDetails,
  threads,
  topics,
}: FilterProps) {
  const live = topics.filter((topic) => !topic.retired);
  // The threads the apps are read over: what was put away is in All alone.
  const kept = threads.filter((thread) => !thread.archived);
  const needsYou = kept.some((thread) => thread.state === "waiting");
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
  const places: PlaceModel[] = PLACES.filter(
    (place) => place.id !== "needsYou" || needsYou,
  ).map((place) => ({
    ...place,
    choose: () => {
      choosePlace(place.id);
    },
    entry: { icon: place.icon, id: place.id, label: place.label },
  }));
  const chosenTopics = new Set(filters.topics);
  const apps: AppSection = {
    chosen: new Set(filters.apps),
    entries: appsUsed(kept)
      .map((slug) => ({
        icon: (
          <AppIcon
            className="size-4"
            name={appsBySlug.get(slug)?.name ?? slug}
            site={appsBySlug.get(slug)?.site}
            size="sm"
          />
        ),
        id: slug,
        label: appsBySlug.get(slug)?.name ?? slug,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    onToggle: (id) => {
      onFiltersChange(chooseOnly(filters, { group: "apps", id }));
    },
  };
  return {
    apps,
    isPlaceOn,
    onNew,
    onNewTopic,
    onTopicDetails,
    places,
    topics: live.map((topic) => ({
      choose: () => {
        onFiltersChange(chooseOnly(filters, { group: "topics", id: topic.id }));
      },
      isOn: chosenTopics.has(topic.id),
      topic,
    })),
  };
}
