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
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { FileDashedIcon } from "@phosphor-icons/react/FileDashed";
import { PlusSquareIcon } from "@phosphor-icons/react/PlusSquare";
import { StarIcon } from "@phosphor-icons/react/Star";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  choose,
  type Filterable,
  isInbox,
  type ThreadFilters,
  type ThreadPlace,
  type Topic,
} from "./threads";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicActionsButton, TopicContextMenu } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** One of the places beside the picker, each a view of its own. */
interface Place {
  icon: (isOn: boolean) => ReactNode;
  id: ThreadPlace;
  label: string;
}

/** The places in the order they are drawn: what waits on the user, what is starred, what is not yet sent, and the whole of it, put away included. */
const PLACES: Place[] = [
  {
    // The same amber dot a waiting thread wears in its gutter.
    icon: () => <span className="size-2.5 rounded-full bg-warning-500" />,
    id: "needsYou",
    label: "Needs you",
  },
  {
    icon: (isOn) => (
      <StarIcon className="size-7" weight={isOn ? "fill" : "regular"} />
    ),
    id: "starred",
    label: "Starred",
  },
  {
    icon: (isOn) => (
      <FileDashedIcon className="size-7" weight={isOn ? "fill" : "regular"} />
    ),
    id: "drafts",
    label: "Drafts",
  },
  {
    icon: (isOn) => (
      <CardsThreeIcon className="size-7" weight={isOn ? "fill" : "regular"} />
    ),
    id: "all",
    label: "All",
  },
];

/** The view on screen, in the brand's own pale green; the same on the picker, a place's mark, and the picker's row. */
const CHOSEN =
  "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200";

/** A mark that is not the view on screen, and what the pointer does to it. */
const UNCHOSEN =
  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground";

/** What the head is built from. */
interface FilterProps {
  filters: ThreadFilters;
  onFiltersChange: (filters: ThreadFilters) => void;
  /** Opens the dialog that makes a topic; the one made is the one the list then stands in. */
  onNewTopic: () => void;
  /** Opens a topic's details: its name, its mark, and the way to delete it. */
  onTopicDetails: (topic: Topic) => void;
  threads: Filterable[];
  topics: Topic[];
}

/**
 * The line over the inbox that says which view the list is: at its head a
 * picker between the chats (every thread not put away) and each topic, and
 * beside it the places as marks (Needs you while something waits, Starred,
 * Drafts, and All, which is every thread, put away or not). One view at a
 * time: a topic is not narrowed to a place or a place to a topic, and
 * choosing the view already on steps back to the chats. The one figure is
 * how many threads hold replies not yet seen, on the chats and on Starred
 * while there are any. The search under the line adds to whatever is
 * chosen.
 */
export function FilterHead(props: FilterProps) {
  const { chats, onNewTopic, onTopicDetails, places, topics } =
    useFilterModel(props);
  return (
    <div
      aria-label="Filters"
      className="flex shrink-0 items-center gap-1 px-3 pt-2 select-none"
      role="group"
    >
      <ViewPicker
        chats={chats}
        onDetails={onTopicDetails}
        onNew={onNewTopic}
        topics={topics}
      />
      <div
        aria-label="Places"
        className="flex shrink-0 items-center gap-0.5"
        role="toolbar"
      >
        {places.map((place) => (
          <PlaceMark
            isOn={place.isOn}
            key={place.id}
            label={place.label}
            onChoose={place.choose}
            unread={place.unread}
          >
            {place.icon(place.isOn)}
          </PlaceMark>
        ))}
      </div>
    </div>
  );
}

/** One row of the picker: large, with its face, its name, and what stands at its end. */
function PickerRow({
  children,
  isOn,
  muted = false,
  onPick,
  trailing,
}: {
  children: ReactNode;
  isOn: boolean;
  muted?: boolean;
  onPick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/row flex h-11 items-center gap-1 rounded-xl pr-2",
        isOn ? CHOSEN : "hover:bg-foreground/5",
      )}
    >
      <button
        aria-checked={isOn}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-3 pl-2.5 text-left text-[15px]",
          isOn ? "font-medium" : muted && "text-muted-foreground/70",
        )}
        onClick={onPick}
        role="menuitemradio"
        type="button"
      >
        {children}
      </button>
      {trailing}
    </div>
  );
}

/** A place's mark: its glyph alone, named in its tooltip, and its glyph and name together, tinted, while it is the view on screen. */
function PlaceMark({
  children,
  isOn,
  label,
  onChoose,
  unread,
}: {
  children: ReactNode;
  isOn: boolean;
  label: string;
  onChoose: () => void;
  /** How many threads in the place hold replies not yet seen. */
  unread?: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={isOn}
          className={cn(
            "flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl",
            isOn
              ? cn(CHOSEN, "pr-3 pl-2.5 text-[15px] font-semibold")
              : cn(UNCHOSEN, unread === undefined ? "w-10" : "px-2"),
          )}
          data-chosen={isOn || undefined}
          onClick={onChoose}
          type="button"
        >
          {children}
          {isOn && <span>{label}</span>}
          {unread !== undefined && (
            <span className="text-xs font-medium tabular-nums">{unread}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** A topic's face at the size a row of the picker draws it: its emoji, or its mark. */
function TopicFace({ size, topic }: { size: "chip" | "row"; topic: Topic }) {
  return topic.emoji ? (
    <span
      className={cn(
        "leading-none",
        size === "chip" ? "text-xl" : "text-[22px]",
      )}
    >
      {topic.emoji}
    </span>
  ) : (
    <TopicMark
      className={size === "chip" ? "size-6" : "size-7"}
      topic={topic}
    />
  );
}

/** How many of these threads hold replies not yet seen. */
function unreadIn(held: Filterable[]) {
  return held.filter((thread) => thread.unread > 0).length;
}

/**
 * What the head draws from: the chats and the topics with their choosers,
 * and the places with theirs. Needs you is a place only while something
 * needs the user, or while the user stands in it: an empty amber mark would
 * be a warning about nothing.
 */
function useFilterModel({
  filters,
  onFiltersChange,
  onNewTopic,
  onTopicDetails,
  threads,
  topics,
}: FilterProps) {
  const live = topics.filter((topic) => !topic.retired);
  // The threads the counts are read over: what was put away is in All alone.
  const kept = threads.filter((thread) => !thread.archived);
  const needsYou = kept.some((thread) => thread.state === "waiting");
  const chosenTopics = new Set(filters.topics);
  const keptUnread = unreadIn(kept);
  const starredUnread = unreadIn(threads.filter((thread) => thread.starred));
  // Needs you stays a mark while it is the place stood in, whether or not
  // anything still waits: the mark is how the place is stepped out of, and a
  // filter with no mark is one nothing on screen accounts for.
  const places = PLACES.filter(
    (place) =>
      place.id !== "needsYou" || needsYou || filters.place === "needsYou",
  ).map((place) => ({
    ...place,
    choose: () => {
      onFiltersChange(choose(filters, { group: "place", id: place.id }));
    },
    isOn: filters.place === place.id,
    ...(place.id === "starred" && starredUnread
      ? { unread: starredUnread }
      : {}),
  }));
  return {
    chats: {
      // The chats are the view with nothing chosen: no place, no topic.
      choose: () => {
        const { place: _place, ...rest } = filters;
        onFiltersChange({ ...rest, apps: [], topics: [] });
      },
      isOn:
        isInbox(filters) &&
        filters.topics.length === 0 &&
        filters.apps.length === 0,
      ...(keptUnread ? { unread: keptUnread } : {}),
    },
    onNewTopic,
    onTopicDetails,
    places,
    topics: live.map((topic) => ({
      choose: () => {
        onFiltersChange(choose(filters, { group: "topics", id: topic.id }));
      },
      isOn: chosenTopics.has(topic.id),
      topic,
    })),
  };
}

/**
 * The view at the head of the line, and the way to change it: the chats, or
 * the topic the list stands in, large enough to read at a glance and tinted
 * while it is the view on screen. Under it, the chats, every topic with the
 * one on marked, and a new one at the foot; a topic's details by right click
 * or the dots at its edge. A pick closes the list.
 */
function ViewPicker({
  chats,
  onDetails,
  onNew,
  topics,
}: {
  chats: { choose: () => void; isOn: boolean; unread?: number };
  onDetails: (topic: Topic) => void;
  onNew: () => void;
  topics: { choose: () => void; isOn: boolean; topic: Topic }[];
}) {
  const [isOpen, setOpen] = useState(false);
  const chosen = topics.find((entry) => entry.isOn)?.topic;
  const isOn = chats.isOn || chosen !== undefined;
  const pick = (chooseView: () => void) => {
    setOpen(false);
    chooseView();
  };
  // While a place is the view, the chats step back to their mark alone, as
  // the places do when they are not the view, and a press on it is the way
  // back to them rather than a list.
  if (!isOn) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Chats"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              UNCHOSEN,
            )}
            onClick={chats.choose}
            type="button"
          >
            <ChatsCircleIcon className="size-7" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Chats</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={chosen ? `View: ${chosen.name}` : "View: Chats"}
          className={cn(
            "flex h-10 max-w-52 min-w-0 shrink items-center gap-2 rounded-xl pr-2 pl-2.5 text-[15px] font-semibold",
            chosen
              ? "bg-(--topic-tint-surface) text-foreground topic-tint hover:bg-(--topic-tint-edge)"
              : CHOSEN,
          )}
          data-chosen
          style={chosen ? topicTint(topicColor(chosen)) : undefined}
          type="button"
        >
          {chosen ? (
            <TopicFace size="chip" topic={chosen} />
          ) : (
            <ChatsCircleIcon className="size-7 shrink-0 text-brand-800/50 dark:text-brand-200/50" />
          )}
          <span className="truncate">{chosen ? chosen.name : "Chats"}</span>
          {/* Small and heavy: a 10px caret at a 3px stroke, in the chip's
            green let halfway back. */}
          <ChevronDown
            absoluteStrokeWidth
            className="size-2.5 shrink-0 text-brand-800/50 dark:text-brand-200/50"
            strokeWidth={3}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 rounded-2xl p-1.5"
        role="menu"
        side="bottom"
        sideOffset={6}
      >
        <PickerRow
          isOn={chats.isOn}
          onPick={() => {
            pick(chats.choose);
          }}
          trailing={
            chats.unread === undefined ? null : (
              <span className="text-xs text-muted-foreground tabular-nums">
                {chats.unread}
              </span>
            )
          }
        >
          <ChatsCircleIcon
            className={cn(
              "size-7 shrink-0",
              // Green on the green of the chosen row, grey on none.
              chats.isOn
                ? "text-brand-800/50 dark:text-brand-200/50"
                : "text-muted-foreground",
            )}
          />
          <span className="truncate">Chats</span>
        </PickerRow>
        {topics.length > 0 && <div className="mx-2 my-1 h-px bg-border" />}
        {topics.map((entry) => (
          <TopicContextMenu
            key={entry.topic.id}
            onDetails={onDetails}
            topic={entry.topic}
          >
            <PickerRow
              isOn={entry.isOn}
              onPick={() => {
                pick(entry.choose);
              }}
              trailing={
                <TopicActionsButton
                  className="group-hover/row:opacity-100"
                  onDetails={onDetails}
                  topic={entry.topic}
                />
              }
            >
              <TopicFace size="row" topic={entry.topic} />
              <span className="truncate">{entry.topic.name}</span>
            </PickerRow>
          </TopicContextMenu>
        ))}
        <div className="mx-2 my-1 h-px bg-border" />
        <PickerRow
          isOn={false}
          muted
          onPick={() => {
            pick(onNew);
          }}
        >
          <PlusSquareIcon className="size-7 shrink-0" />
          <span>New topic</span>
        </PickerRow>
      </PopoverContent>
    </Popover>
  );
}
