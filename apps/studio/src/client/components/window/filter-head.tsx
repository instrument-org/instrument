import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import { chatSearchAskedAtom } from "@/client/atoms/window";
import { cn } from "@/client/lib/utils";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { NotificationIcon } from "@phosphor-icons/react/Notification";
import {
  OneLineIcon,
  ThreeLinesIcon,
  TwoLinesIcon,
} from "@/client/components/icons/row-density-icons";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useAtom } from "jotai";
import { type ComponentType, useEffect, useRef, useState } from "react";

import {
  type ChatFilters,
  type ChatPlace,
  type ChatTag,
  type Filterable,
  inPlace,
  matchesFilters,
  type Project,
} from "./chats";
import {
  groupByDayAtom,
  type RowDensity,
  rowDensityAtom,
} from "./chat-list-view";
import { type SearchToken, SearchField } from "./search-field";

/** The marks the search offers as tokens, in the order it offers them. */
const TAGS: SearchToken<ChatTag>[] = [
  {
    icon: <NotificationIcon weight="fill" />,
    id: "unread",
    label: "Unread",
  },
  {
    icon: <StarIcon className="text-warning-500" weight="fill" />,
    id: "starred",
    label: "Starred",
  },
];

/** The places a chat can be, as the tabs under the search name them. */
const PLACES: { id: ChatPlace | undefined; label: string }[] = [
  { id: undefined, label: "Inbox" },
  { id: "drafts", label: "Drafts" },
  { id: "archived", label: "Archived" },
];

/**
 * The lines over the list. Outside a project: the search, with the view
 * button at its end, and under them the places a chat can be as tabs, Inbox,
 * Drafts and Archived. Inside one: the way back to the inbox, with the search
 * folded to its glass until it is asked for or holds something. The marks the
 * search narrows by (Unread, Starred) are offered as tokens on clicking into
 * it, each only while the view has any, and narrow whatever view the column
 * is, a project's included; Drafts offers none, since a draft carries
 * neither.
 */
export function FilterHead({
  chats,
  filters,
  onFiltersChange,
  onLeaveProject,
  project,
}: {
  chats: Filterable[];
  filters: ChatFilters;
  onFiltersChange: (filters: ChatFilters) => void;
  /** Steps out of the project the column stands in, back to the inbox. */
  onLeaveProject: () => void;
  /** The project the column stands in, if it stands in one. */
  project: Project | undefined;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [isSearchAsked, setSearchAsked] = useState(false);
  const isSearched = filters.search !== "" || filters.tags.length > 0;
  // Search Chats (Shift+Cmd+F) from anywhere in the window. Cmd+F is the
  // chat's own find, so the search over every chat has a chord of its own.
  const [isChatSearchAsked, setChatSearchAsked] = useAtom(chatSearchAskedAtom);
  useEffect(() => {
    if (!isChatSearchAsked) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      setChatSearchAsked(false);
      setSearchAsked(true);
      // Drawn on the next frame inside a project, where the field was folded.
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isChatSearchAsked, setChatSearchAsked]);
  // A mark is offered while the view, as it stands before any mark narrows
  // it, holds a chat carrying it.
  const unmarked = { ...filters, search: "", tags: [] };
  const offered =
    filters.place === "drafts"
      ? []
      : TAGS.filter((tag) =>
          chats.some((chat) => chat[tag.id] && matchesFilters(chat, unmarked)),
        );
  const placeLabel = PLACES.find((place) => place.id === filters.place)?.label;
  const search = (
    <SearchField
      inputRef={searchRef}
      offered={offered}
      onChange={(words) => {
        onFiltersChange({ ...filters, search: words });
      }}
      onFocusChange={(isFocused) => {
        if (!isFocused && !isSearched) {
          setSearchAsked(false);
        }
      }}
      onTokensChange={(tags) => {
        onFiltersChange({ ...filters, tags });
      }}
      placeholder={
        project
          ? `Search ${project.name}`
          : filters.place === undefined
            ? "Search"
            : `Search ${placeLabel ?? ""}`
      }
      tokens={TAGS.filter((tag) => filters.tags.includes(tag.id)).toSorted(
        (a, b) => filters.tags.indexOf(a.id) - filters.tags.indexOf(b.id),
      )}
      value={filters.search}
    />
  );
  if (project) {
    const isFieldShown = isSearchAsked || isSearched;
    return (
      // Its controls center 24px down, on the line of the chat head's
      // 48px row across the divider.
      <div
        aria-label="Filters"
        className="flex h-13 shrink-0 items-center gap-1.5 px-2 pb-1"
        role="group"
      >
        {!isFieldShown && (
          <button
            className="flex h-8 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-[13px] text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
            onClick={onLeaveProject}
            type="button"
          >
            <CaretLeftIcon className="size-3.5" weight="bold" />
            Inbox
          </button>
        )}
        <span className="flex-1" hidden={isFieldShown} />
        {isFieldShown ? (
          // Grows out of the glass it stood in for.
          <div className="head-field-in flex min-w-0 flex-1">{search}</div>
        ) : (
          <button
            aria-label="Search"
            className={HEAD_ICON_BUTTON}
            onClick={() => {
              setSearchAsked(true);
              requestAnimationFrame(() => {
                searchRef.current?.focus();
              });
            }}
            title="Search"
            type="button"
          >
            <MagnifyingGlassIcon className="size-4" />
          </button>
        )}
        <ViewButton />
      </div>
    );
  }
  return (
    // The search row centers 24px down, on the line of the chat head's 48px
    // row across the divider.
    <div
      aria-label="Filters"
      className="flex shrink-0 flex-col gap-1.5 px-2 pt-1.5 pb-2.5"
      role="group"
    >
      <div className="flex items-center gap-1.5">
        {search}
        <ViewButton />
      </div>
      <div
        aria-label="Places"
        className="flex items-center gap-0.5"
        role="tablist"
      >
        {PLACES.map((place) => {
          const isOn = filters.place === place.id;
          return (
            <button
              aria-selected={isOn}
              className={cn(
                "h-7 rounded-md px-2 text-[13px]",
                isOn
                  ? "bg-foreground/7 font-medium text-foreground"
                  : "text-foreground/60 hover:bg-foreground/4 hover:text-foreground",
              )}
              key={place.label}
              onClick={() => {
                onFiltersChange(inPlace(filters, place.id));
              }}
              role="tab"
              type="button"
            >
              {place.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A square control at the head's height, its glyph in the muted ink. */
const HEAD_ICON_BUTTON =
  "grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/6 data-[state=open]:text-foreground";

/** The row densities as the view menu offers them. */
const DENSITIES: {
  icon: ComponentType<{ className?: string }>;
  id: RowDensity;
  label: string;
  note: string;
}[] = [
  {
    icon: ThreeLinesIcon,
    id: "three",
    label: "Three lines",
    note: "Title, preview, project and files",
  },
  {
    icon: TwoLinesIcon,
    id: "two",
    label: "Two lines",
    note: "Title, then project or last reply",
  },
  { icon: OneLineIcon, id: "one", label: "One line", note: "Just the titles" },
];

/**
 * The view button at the search's end, wearing the density the rows are
 * drawn at: under it the three densities and the switch that puts a heading
 * over each day. Both are kept for every window on this computer.
 */
function ViewButton() {
  const [density, setDensity] = useAtom(rowDensityAtom);
  const [groupByDay, setGroupByDay] = useAtom(groupByDayAtom);
  const Current =
    DENSITIES.find((entry) => entry.id === density)?.icon ?? ThreeLinesIcon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="View options"
          className={HEAD_ICON_BUTTON}
          title="View options"
          type="button"
        >
          <Current className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5" sideOffset={6}>
        <div
          aria-label="Rows"
          className="flex flex-col gap-0.5"
          role="radiogroup"
        >
          {DENSITIES.map((entry) => {
            const isOn = entry.id === density;
            return (
              <button
                aria-checked={isOn}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left",
                  isOn ? "bg-foreground/6" : "hover:bg-foreground/4",
                )}
                key={entry.id}
                onClick={() => {
                  setDensity(entry.id);
                }}
                role="radio"
                type="button"
              >
                <entry.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{entry.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {entry.note}
                  </span>
                </span>
                {isOn && <CheckIcon className="mt-0.5 size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="-mx-1.5 my-1.5 h-px bg-border" />
        <label className="flex h-9 items-center justify-between px-2.5 text-sm">
          Group by day
          <Switch checked={groupByDay} onCheckedChange={setGroupByDay} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
