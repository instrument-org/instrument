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
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { FileDashedIcon } from "@phosphor-icons/react/FileDashed";
import { StarIcon } from "@phosphor-icons/react/Star";
import { TrayIcon } from "@phosphor-icons/react/Tray";
import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
import { TopicPickList } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** One of the places: where the head stands when no topic is chosen. The inbox is no filter at all. */
interface Place {
  icon: ReactNode;
  id: "inbox" | ThreadPlace;
  label: string;
}

/** The places in the order they are drawn: the inbox, what waits on the user, what is starred, what is not yet sent, and the whole of it, put away included. */
const PLACES: Place[] = [
  { icon: <TrayIcon className="size-4" />, id: "inbox", label: "Inbox" },
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

/** A chosen mark: a tint, never a fill, so the head reads the same in either theme. */
const CHOSEN = "bg-foreground/8 text-foreground";

/** A mark that is not chosen, and what the pointer does to it. */
const UNCHOSEN =
  "text-foreground/80 hover:bg-foreground/5 hover:text-foreground";

/** How many topics the picker shows the marks of while it stands in none. */
const HINTED_TOPICS = 3;

/** The line's own side padding (`px-3`) and the gap before the picker (`gap-1`): what the room left for the picker is short by. */
const HEAD_PADDING = 24;
const HEAD_GAP = 4;

/** What the chip comes to, in layout px, wearing the marks and the word, and wearing the word alone: the room it takes to keep each. */
const FULL_CHIP = 112;
const WORD_CHIP = 72;

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

/** One of the places as the head reads it: its mark, how to stand in it, and how many threads in it hold replies not yet seen, where the place counts them. */
interface PlaceModel extends Place {
  choose: () => void;
  unread?: number;
}

/**
 * The line over the inbox that says where the list stands: the places as
 * marks, the one stood in wearing its name and the inbox its unread count
 * (Inbox is every thread not put away, Needs you, Starred, Drafts, and All,
 * which is every thread, put away or not); and at the line's end the topic
 * picker, the one topic the place is narrowed to, or the word Topic while
 * it is narrowed to none. The one figure on any of them is how many threads
 * in the place hold replies not yet seen, on Inbox and on Starred while
 * there are any, the way mail counts its unread on the inbox rather than
 * keeping a place for them. The places are one radio group and the topic
 * another: a topic chosen narrows whatever place the head stands in, so the
 * unread filed under one topic is a click on each; choosing the same place
 * again steps out of it. The search under the line adds to whatever is
 * chosen.
 */
export function FilterHead(props: FilterProps) {
  const { onNewTopic, onTopicDetails, places, topics } = useFilterModel(props);
  const lineRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const room = useRoomAfter(lineRef, marksRef);
  return (
    <div
      aria-label="Filters"
      className="flex shrink-0 items-center gap-1 px-3 pt-2"
      ref={lineRef}
      role="group"
    >
      {/* Never gives ground: the places are where the list stands, and a
        wrapper that shrinks under its own marks puts them under the picker
        rather than making the line any narrower. */}
      <div
        aria-label="Places"
        className="flex shrink-0 items-center gap-1"
        ref={marksRef}
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
            {place.icon}
          </PlaceMark>
        ))}
      </div>
      <TopicPicker
        className="ml-auto"
        onDetails={onTopicDetails}
        onNew={onNewTopic}
        room={room}
        topics={topics}
      />
    </div>
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
  unread,
}: {
  children: ReactNode;
  isOn: boolean;
  label: string;
  onChoose: () => void;
  /** How many threads in the place hold replies not yet seen, said beside the glyph whether or not the place is stood in. */
  unread?: number;
}) {
  const mark = (
    <button
      aria-label={label}
      aria-pressed={isOn}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-lg text-xs",
        isOn
          ? cn(CHOSEN, "px-2.5 font-medium")
          : cn(UNCHOSEN, unread === undefined ? "w-8 justify-center" : "px-2"),
      )}
      data-chosen={isOn || undefined}
      onClick={onChoose}
      type="button"
    >
      {children}
      {isOn && <span>{label}</span>}
      {unread !== undefined && (
        <span className="text-[11px] font-medium tabular-nums">{unread}</span>
      )}
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

/**
 * What the picker wears while it stands in no topic: the topics handed to
 * it as their own marks, rounded and overlapped like a hand of them, ahead
 * of the word. A chip that says only Topic gives no reason to open it, where
 * the marks show what the user named and colored, which is what they would
 * recognize. Nothing while there are no topics yet, since an empty stack
 * would promise a list with nothing in it.
 */
function TopicHint({ topics }: { topics: Topic[] }) {
  if (topics.length === 0) {
    return null;
  }
  return (
    <span aria-hidden className="flex shrink-0 -space-x-1">
      {topics.map((topic) => (
        <TopicMark
          // The ring is the pane behind the chip, which is what cuts one
          // mark's tint from the next where they overlap.
          className="size-4 rounded-full text-[10px] ring-2 ring-background"
          key={topic.id}
          topic={topic}
        />
      ))}
    </span>
  );
}

/**
 * The topic the list is narrowed to, at the line's end, and the way to
 * change it: the same fully rounded pill a thread wears, in the topic's own
 * tint, once one is chosen; and while none is, an outlined pill of the same
 * shape reading Topic behind a few of the topics' marks, so the colors and
 * faces inside are on the line before it is opened. Under it, every topic
 * with a check on the one on, and a new one at the foot: the same list a
 * row's tag control opens, so filing and filtering are learned once. A pick
 * closes the list, since the line holds one topic at a time.
 *
 * What it wears comes off as the column narrows, in that order: the marks
 * first, then the word and its caret, down to a single mark, which is the
 * same thing a place does when it is not the one stood in. It gives up the
 * line before it crowds the places, and a name it cannot fit whole is on its
 * label for the screen reader and in the list it opens either way.
 */
function TopicPicker({
  className,
  onDetails,
  onNew,
  room,
  topics,
}: {
  className?: string;
  onDetails: (topic: Topic) => void;
  onNew: () => void;
  /** What the line has left after the places, in layout px; nothing until it has been measured. */
  room: number | undefined;
  topics: { choose: () => void; isOn: boolean; topic: Topic }[];
}) {
  const [isOpen, setOpen] = useState(false);
  const chosen = topics.find((entry) => entry.isOn)?.topic;
  const hinted = topics.slice(0, HINTED_TOPICS).map((entry) => entry.topic);
  const wears = whatFits(room, hinted.length > 0);
  const wearsMark = wears === "mark";
  // Every mark while they all fit, one while nothing else does, and none in
  // between: a single mark beside the word would say the user has one topic.
  const shown = wears === "full" ? hinted : wearsMark ? hinted.slice(0, 1) : [];
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={chosen ? `Topic: ${chosen.name}` : "Topic"}
          className={cn(
            "flex h-8 max-w-44 min-w-0 items-center gap-1.5 rounded-full text-xs",
            chosen
              ? "bg-(--topic-tint-surface) font-medium text-foreground topic-tint hover:bg-(--topic-tint-edge)"
              : cn(UNCHOSEN, "ring-1 ring-border ring-inset"),
            // The marks' rings stand outside their tiles, so a chip wearing
            // them starts closer in than one wearing a word.
            shown.length > 0 && !wearsMark && !chosen
              ? "pr-2.5 pl-1.5"
              : wearsMark
                ? "px-1.5"
                : "px-2.5",
            className,
          )}
          data-chosen={chosen ? true : undefined}
          style={chosen ? topicTint(topicColor(chosen)) : undefined}
          type="button"
        >
          {chosen ? (
            <>
              {chosen.emoji ? (
                <span className="text-[13px] leading-none">{chosen.emoji}</span>
              ) : (
                <TopicMark className="bg-transparent!" topic={chosen} />
              )}
              {!wearsMark && <span className="truncate">{chosen.name}</span>}
            </>
          ) : (
            <>
              <TopicHint topics={shown} />
              {!wearsMark && <span className="truncate">Topic</span>}
            </>
          )}
          {/* The caret goes with the word, except where it is the only
            thing the chip has left to show. */}
          {(!wearsMark || (!chosen && hinted.length === 0)) && (
            <CaretDownIcon className="size-3 shrink-0" weight="bold" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-60 p-1"
        role="menu"
        side="bottom"
        sideOffset={4}
      >
        <TopicPickList
          chosen={new Set(chosen ? [chosen.id] : [])}
          onDetails={onDetails}
          onNew={() => {
            setOpen(false);
            onNew();
          }}
          onToggle={(id) => {
            setOpen(false);
            topics.find((entry) => entry.topic.id === id)?.choose();
          }}
          topics={topics.map((entry) => entry.topic)}
        />
      </PopoverContent>
    </Popover>
  );
}

/** How many of these threads hold replies not yet seen. */
function unreadIn(held: Filterable[]) {
  return held.filter((thread) => thread.unread > 0).length;
}

/**
 * What the head draws from: the places with their choosers, and the topics
 * with theirs. Needs you is a place only while something needs the user, or
 * while the user stands in it: an empty amber mark would be a warning about
 * nothing.
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
  const isPlaceOn = (place: Place) =>
    place.id === "inbox" ? isInbox(filters) : filters.place === place.id;
  /** Standing in a place: the inbox is standing in no place, whatever topic narrows it. */
  const choosePlace = (id: Place["id"]) => {
    if (id === "inbox") {
      const { place: _place, ...rest } = filters;
      onFiltersChange(rest);
      return;
    }
    onFiltersChange(choose(filters, { group: "place", id }));
  };
  /** How many of a place's threads hold replies not yet seen, for the places that count them. */
  const unreadOf = (id: Place["id"]): number | undefined => {
    switch (id) {
      case "inbox": {
        return unreadIn(kept);
      }
      case "starred": {
        return unreadIn(threads.filter((thread) => thread.starred));
      }
      default: {
        return undefined;
      }
    }
  };
  // Needs you stays a mark while it is the place stood in, whether or not
  // anything still waits: the mark is how the place is stepped out of, and a
  // filter with no mark is one nothing on screen accounts for.
  const places: (PlaceModel & { isOn: boolean })[] = PLACES.filter(
    (place) =>
      place.id !== "needsYou" || needsYou || filters.place === "needsYou",
  ).map((place) => {
    const unread = unreadOf(place.id);
    return {
      ...place,
      choose: () => {
        choosePlace(place.id);
      },
      isOn: isPlaceOn(place),
      ...(unread ? { unread } : {}),
    };
  });
  const chosenTopics = new Set(filters.topics);
  return {
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
 * How much of the line is left after the places, in layout px, so the picker
 * can wear what fits. Measured rather than read off the column's width: how
 * wide the places are depends on which one is stood in and on what each one
 * counts, so a column that leaves one inbox room crowds the next.
 */
function useRoomAfter(
  line: RefObject<HTMLDivElement | null>,
  marks: RefObject<HTMLDivElement | null>,
) {
  const [room, setRoom] = useState<number>();
  useLayoutEffect(() => {
    const head = line.current;
    const places = marks.current;
    if (!head || !places) {
      return;
    }
    const measure = () => {
      // A line of no width has not been laid out: the pane is hidden behind
      // another place, or this is a renderer with no layout at all. Keeping
      // the last room rather than reading nought out of it is what stops the
      // picker from collapsing while it cannot be seen and flinching back
      // when it can.
      if (head.clientWidth === 0) {
        return;
      }
      // `clientWidth` and `offsetWidth` rather than a rect: these are layout
      // px, the unit the widths they are compared against are written in,
      // where a rect would be that times the window's zoom.
      setRoom(head.clientWidth - HEAD_PADDING - places.offsetWidth - HEAD_GAP);
    };
    measure();
    // Both, since the line grows with the column and the places grow with
    // what they have to say.
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    observer.observe(places);
    return () => {
      observer.disconnect();
    };
  }, [line, marks]);
  return room;
}

/**
 * What the picker can wear in the room the line has left it: the marks, the
 * word and its caret, or a mark alone. Until the line has been laid out once
 * there is no measurement, and the full chip is what it starts from, since
 * that is the common case and a step down would be a visible flinch.
 */
function whatFits(room: number | undefined, hasMarks: boolean) {
  if (room === undefined || room >= (hasMarks ? FULL_CHIP : WORD_CHIP)) {
    return "full";
  }
  return room >= WORD_CHIP ? "word" : "mark";
}
