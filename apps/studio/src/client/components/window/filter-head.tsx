import { ChatsOutlineIcon } from "@/client/components/icons/chats-outline-icon";
import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { CircleDashedIcon } from "@phosphor-icons/react/CircleDashed";
import { NotificationIcon } from "@phosphor-icons/react/Notification";
import { PlusSquareIcon } from "@phosphor-icons/react/PlusSquare";
import { StarIcon } from "@phosphor-icons/react/Star";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  type ChatFilters,
  type ChatPlace,
  choose,
  type Filterable,
  isInbox,
  matchesFilters,
  type Topic,
} from "./chats";
import { SearchField } from "./search-field";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicActionsButton, TopicContextMenu } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** A view the picker offers above the topics: the chats, or one of the places. */
interface View {
  /** How many chats it holds, drawn at the end of its row; none for a view whose size says nothing. */
  count?: number;
  icon: (size: string, isOn: boolean) => ReactNode;
  id: "chats" | ChatPlace;
  label: string;
  /** The picker's color while this is the view on screen. */
  tone: string;
}

/** The brand's own pale green: the chats and what in them is unread. */
const BRAND =
  "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200";

/** The star's amber. */
const AMBER =
  "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300";

/** A quiet grey for what is set aside: what was put away, what was never sent, and the whole of it. */
const GREY = "bg-foreground/6 text-foreground/80";

const ICON_WEIGHT = (isOn: boolean) => (isOn ? "fill" : "regular");

/** What the head is built from. */
interface FilterProps {
  chats: Filterable[];
  /** How many drafts are not yet sent: Drafts is a view only while there are some, or while it is the one on screen. */
  drafts: number;
  filters: ChatFilters;
  onFiltersChange: (filters: ChatFilters) => void;
  /** Opens the dialog that makes a topic; the one made is the one the list then stands in. */
  onNewTopic: () => void;
  /** Opens a topic's details: its name, its mark, and the way to delete it. */
  onTopicDetails: (topic: Topic) => void;
  topics: Topic[];
}

/**
 * The line over the inbox: one picker that names the view the list is and
 * changes it, and the search beside it, which reads inside that view. The
 * picker holds the chats (every chat not put away), Unread, Starred, Drafts
 * while there are any, and Archived, then each topic, one view at a time:
 * choosing the view already on steps back to the chats. The picker wears
 * the view's color, a topic's own tint for a topic, and while the search is
 * in use it draws in to its mark so the words have the line.
 */
export function FilterHead(props: FilterProps) {
  const { filters, onFiltersChange } = props;
  const model = useFilterModel(props);
  const [isSearchFocused, setSearchFocused] = useState(false);
  const isSearching = isSearchFocused || filters.search !== "";
  return (
    <div
      aria-label="Filters"
      // 8px in from the card's side and 12px down from its top, and 16px
      // with the list's own 4px down to the first row: a heading over the
      // rows, set apart from them as well as larger than their titles.
      className="flex shrink-0 items-center gap-2 px-2 pt-3 pb-3 select-none"
      role="group"
    >
      <ViewPicker {...model} isCompact={isSearching} />
      <SearchField
        onChange={(search) => {
          onFiltersChange({ ...filters, search });
        }}
        onFocusChange={setSearchFocused}
        placeholder={
          model.chosenTopic
            ? `Search ${model.chosenTopic.name}`
            : model.current.id === "chats"
              ? "Search"
              : `Search ${model.current.label}`
        }
        value={filters.search}
      />
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
        "group/row flex h-10 items-center gap-1 rounded-xl pr-2",
        isOn ? "bg-foreground/6" : "hover:bg-foreground/5",
      )}
    >
      <button
        aria-checked={isOn}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-3 pl-2.5 text-left text-sm",
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

/**
 * A part of the picker that slides open or shut along the line: its column
 * of the grid eases between its width and none, so the picker and the
 * search beside it move together rather than jumping.
 */
function Reveal({
  children,
  isOpen,
}: {
  children: ReactNode;
  isOpen: boolean;
}) {
  return (
    <span
      aria-hidden={!isOpen || undefined}
      className={cn(
        "grid min-w-0 transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none",
        isOpen ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
      )}
    >
      <span className="min-w-0 overflow-hidden whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}

/** How many chats a view holds, at the end of its row. */
function RowCount({ count }: { count: number | undefined }) {
  return count ? (
    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
  ) : null;
}

/** A topic's face at the size the picker draws it: its emoji, or its mark. */
function TopicFace({ size, topic }: { size: "chip" | "row"; topic: Topic }) {
  return topic.emoji ? (
    <span
      className={cn(
        "leading-none",
        size === "chip" ? "text-[15px]" : "text-lg",
      )}
    >
      {topic.emoji}
    </span>
  ) : (
    <TopicMark
      className={size === "chip" ? "size-4" : "size-6"}
      topic={topic}
    />
  );
}

/**
 * What the head draws from: the views with their counts and choosers, each
 * topic with its own, and which of them is on screen. A count is the chats
 * the view would list, so it reads the same predicate the list does.
 */
function useFilterModel({
  chats,
  drafts,
  filters,
  onFiltersChange,
  onNewTopic,
  onTopicDetails,
  topics,
}: FilterProps) {
  const live = topics.filter((topic) => !topic.retired);
  const countIn = (place: ChatPlace) =>
    chats.filter((chat) =>
      matchesFilters(chat, { apps: [], place, search: "", topics: [] }),
    ).length;
  const isChats =
    isInbox(filters) &&
    filters.topics.length === 0 &&
    filters.apps.length === 0;
  const chatsView: View = {
    icon: (size, isOn) =>
      isOn ? (
        <ChatsCircleIcon className={size} weight="fill" />
      ) : (
        <ChatsOutlineIcon className={size} />
      ),
    id: "chats",
    label: "Chats",
    tone: BRAND,
  };
  const views: View[] = [
    chatsView,
    {
      count: countIn("unread"),
      icon: (size, isOn) => (
        <NotificationIcon className={size} weight={ICON_WEIGHT(isOn)} />
      ),
      id: "unread",
      label: "Unread",
      tone: BRAND,
    },
    {
      count: countIn("starred"),
      icon: (size, isOn) => (
        <StarIcon className={size} weight={ICON_WEIGHT(isOn)} />
      ),
      id: "starred",
      label: "Starred",
      tone: AMBER,
    },
    ...(drafts > 0 || filters.place === "drafts"
      ? [
          {
            count: drafts,
            icon: (size: string) => <CircleDashedIcon className={size} />,
            id: "drafts",
            label: "Drafts",
            tone: GREY,
          } satisfies View,
        ]
      : []),
    {
      icon: (size, isOn) => (
        <ArchiveIcon className={size} weight={ICON_WEIGHT(isOn)} />
      ),
      id: "archived",
      label: "Archived",
      tone: GREY,
    },
  ];
  // All is reached only by widening a search past the view it was typed in,
  // so it names itself on the picker but has no row of its own.
  const everything: View = {
    icon: (size) => <CardsThreeIcon className={size} />,
    id: "all",
    label: "All chats",
    tone: GREY,
  };
  const chosenTopic = live.find((topic) => filters.topics.includes(topic.id));
  const current = isChats
    ? chatsView
    : (views.find((view) => view.id === filters.place) ??
      (filters.place === "all" ? everything : undefined));
  return {
    chosenTopic,
    // A topic or an app narrows the list with no place chosen; the picker
    // then names the topic, or the chats for an app.
    current: current ?? chatsView,
    onDetails: onTopicDetails,
    onNew: onNewTopic,
    topics: live.map((topic) => ({
      choose: () => {
        onFiltersChange(choose(filters, { group: "topics", id: topic.id }));
      },
      count: chats.filter((chat) => chat.topics.includes(topic.id)).length,
      isOn: chosenTopic?.id === topic.id,
      topic,
    })),
    views: views.map((view) => ({
      ...view,
      choose: () => {
        if (view.id === "chats") {
          const { place: _place, ...rest } = filters;
          onFiltersChange({ ...rest, apps: [], topics: [] });
          return;
        }
        onFiltersChange(choose(filters, { group: "place", id: view.id }));
      },
      isOn: view.id === "chats" ? isChats : filters.place === view.id,
    })),
  };
}

/**
 * The view at the head of the line, and the way to change it: its name in
 * its color, or its mark alone while the search is in use. Under it, the
 * views, every topic with its count, and a new one at the foot; a topic's
 * details by right click or the dots at its edge. A pick closes the list.
 */
function ViewPicker({
  chosenTopic,
  current,
  isCompact,
  onDetails,
  onNew,
  topics,
  views,
}: {
  chosenTopic: Topic | undefined;
  current: View;
  isCompact: boolean;
  onDetails: (topic: Topic) => void;
  onNew: () => void;
  topics: {
    choose: () => void;
    count: number;
    isOn: boolean;
    topic: Topic;
  }[];
  views: (View & { choose: () => void; isOn: boolean })[];
}) {
  const [isOpen, setOpen] = useState(false);
  const pick = (chooseView: () => void) => {
    setOpen(false);
    chooseView();
  };
  const label = chosenTopic ? chosenTopic.name : current.label;
  // The chats are named alone, the way the inbox is; every other view
  // carries its mark beside its name, so a narrowed list never passes for
  // the whole of it. Drawn in to its mark, every view shows that mark.
  const hasFace =
    isCompact || chosenTopic !== undefined || current.id !== "chats";
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={`View: ${label}`}
          className={cn(
            "flex h-9 max-w-48 min-w-0 shrink-0 items-center rounded-full text-[15px] font-semibold transition-[padding] duration-200 ease-out motion-reduce:transition-none",
            isCompact ? "px-2.5" : hasFace ? "pr-2.5 pl-3" : "pr-2.5 pl-3.5",
            chosenTopic
              ? "bg-(--topic-tint-surface) text-foreground topic-tint hover:bg-(--topic-tint-edge)"
              : current.tone,
          )}
          data-chosen
          data-compact={isCompact || undefined}
          style={chosenTopic ? topicTint(topicColor(chosenTopic)) : undefined}
          title={isCompact ? label : undefined}
          type="button"
        >
          <Reveal isOpen={hasFace}>
            <span className="grid size-4 place-items-center">
              {chosenTopic ? (
                <TopicFace size="chip" topic={chosenTopic} />
              ) : (
                current.icon("size-4", true)
              )}
            </span>
          </Reveal>
          <Reveal isOpen={!isCompact}>
            {/* Its own width whatever the slide has opened, so the name is
              uncovered as it opens rather than cut short. */}
            <span
              className={cn("flex w-max items-center gap-1", hasFace && "pl-1")}
            >
              <span className="max-w-36 truncate">{label}</span>
              <ChevronDown
                absoluteStrokeWidth
                className="size-3.5 shrink-0 opacity-50"
                strokeWidth={2.5}
              />
            </span>
          </Reveal>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-64 flex-col rounded-2xl p-1.5"
        maxHeight="30rem"
        role="menu"
        side="bottom"
        sideOffset={6}
      >
        {views.map((view) => (
          <PickerRow
            isOn={view.isOn}
            key={view.id}
            onPick={() => {
              pick(view.choose);
            }}
            trailing={<RowCount count={view.count} />}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center",
                !view.isOn && "text-muted-foreground",
              )}
            >
              {view.icon("size-5", view.isOn)}
            </span>
            <span className="truncate">{view.label}</span>
          </PickerRow>
        ))}
        {topics.length > 0 && (
          <div className="mx-2 my-1 h-px shrink-0 bg-border" />
        )}
        {/* The topics scroll between the views and the foot, which stay. */}
        <MenuScrollArea className="p-0">
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
                  // The count gives way to the dots under the pointer, in
                  // the one place at the row's end.
                  <span className="relative flex h-5 min-w-5 items-center justify-end">
                    <span className="group-hover/row:invisible group-has-data-[state=open]/row:invisible">
                      <RowCount count={entry.count} />
                    </span>
                    <TopicActionsButton
                      className="absolute right-0 group-hover/row:opacity-100"
                      onDetails={onDetails}
                      topic={entry.topic}
                    />
                  </span>
                }
              >
                <span className="grid size-6 shrink-0 place-items-center">
                  <TopicFace size="row" topic={entry.topic} />
                </span>
                <span className="truncate">{entry.topic.name}</span>
              </PickerRow>
            </TopicContextMenu>
          ))}
        </MenuScrollArea>
        <div className="mx-2 my-1 h-px shrink-0 bg-border" />
        <PickerRow
          isOn={false}
          muted
          onPick={() => {
            pick(onNew);
          }}
        >
          {/* The light weight: an outlined square is all stroke, and at the
            regular weight it reads heavier than the marks over it. */}
          <PlusSquareIcon className="size-6 shrink-0" weight="light" />
          <span>New topic</span>
        </PickerRow>
      </PopoverContent>
    </Popover>
  );
}
