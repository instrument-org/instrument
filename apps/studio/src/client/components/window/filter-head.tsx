import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { cn } from "@/client/lib/utils";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { CircleDashedIcon } from "@phosphor-icons/react/CircleDashed";
import { NotificationIcon } from "@phosphor-icons/react/Notification";
import { PlusSquareIcon } from "@phosphor-icons/react/PlusSquare";
import { StarIcon } from "@phosphor-icons/react/Star";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import {
  type ChatFilters,
  type ChatPlace,
  choose,
  type Filterable,
  isInbox,
  matchesFilters,
  type Project,
} from "./chats";
import { PlaceIcon } from "./place-icons";
import { SearchField } from "./search-field";
import { ProjectMark } from "./project-mark";
import { ProjectActionsButton, ProjectContextMenu } from "./project-menu";

/** A view the picker offers above the projects: the chats, or one of the places. */
interface View {
  /** How many chats it holds, drawn at the end of its row; none for a view whose size says nothing. */
  count?: number;
  icon: (size: string, isOn: boolean) => ReactNode;
  id: "chats" | ChatPlace;
  label: string;
}

/**
 * The picker's face whatever it shows: bare on the card at rest, a soft
 * grey under the pointer or while its list is up, the name in full ink then.
 */
const PICKER_TONE =
  "text-foreground/80 hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground";

const ICON_WEIGHT = (isOn: boolean) => (isOn ? "fill" : "regular");

/** What the head is built from. */
interface FilterProps {
  chats: Filterable[];
  /** How many drafts are not yet sent: Drafts is a view only while there are some, or while it is the one on screen. */
  drafts: number;
  filters: ChatFilters;
  onFiltersChange: (filters: ChatFilters) => void;
  /** Opens the dialog that makes a project; the one made is the one the list then stands in. */
  onNewProject: () => void;
  /** Opens a project's details: its name, its mark, and the way to delete it. */
  onProjectDetails: (project: Project) => void;
  projects: Project[];
}

/**
 * The line over the inbox: one picker that names the view the list is and
 * changes it, and the search beside it, which reads inside that view. The
 * picker holds the chats (every chat not put away), Unread, Starred, Drafts
 * while there are any, and Archived, then each project, one view at a time:
 * choosing the view already on steps back to the chats. The picker wears
 * the view's color, a project's own tint for a project, and while the search is
 * in use it draws in to its mark so the words have the line.
 */
export function FilterHead(props: FilterProps) {
  const { filters, onFiltersChange } = props;
  const model = useFilterModel(props);
  const [isSearchFocused, setSearchFocused] = useState(false);
  const isSearching = isSearchFocused || filters.search !== "";
  const searchRef = useRef<HTMLInputElement>(null);
  useFindTarget({
    anchor: searchRef,
    openFind: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });
  return (
    <div
      aria-label="Filters"
      // 8px in from the card's side, down from its top, and down to the
      // first row or the project's line, so the controls sit evenly in their
      // band.
      className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-2"
      role="group"
    >
      <ViewPicker {...model} isCompact={isSearching} />
      <SearchField
        inputRef={searchRef}
        onChange={(search) => {
          onFiltersChange({ ...filters, search });
        }}
        onFocusChange={setSearchFocused}
        placeholder={
          model.chosenProject
            ? `Search ${model.chosenProject.name}`
            : model.current.id === "chats"
              ? "Search"
              : `Search ${model.current.label}`
        }
        value={filters.search}
      />
    </div>
  );
}

/**
 * One row of the picker: large, with its face, its name, and what stands at
 * its end. It keeps its height in the menu's flex column, where the rows
 * outside the projects' scroll would otherwise shrink to make room for them.
 */
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
        "group/row flex h-9 shrink-0 items-center gap-1 rounded-lg pr-2",
        // Focus is the hover's fill, inside the row's corners, rather than
        // the browser's square ring around the button.
        isOn
          ? "bg-foreground/6"
          : "hover:bg-foreground/5 has-focus-visible:bg-foreground/5",
      )}
    >
      <button
        aria-checked={isOn}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-3 pl-2.5 text-left text-sm outline-hidden",
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
    <span className="text-xs text-muted-foreground/60 tabular-nums">
      {count}
    </span>
  ) : null;
}

/** A project's face at the size the picker draws it: its emoji, or its mark. */
function ProjectFace({
  size,
  project,
}: {
  size: "chip" | "row";
  project: Project;
}) {
  return project.emoji ? (
    <span
      className={cn(
        "leading-none",
        size === "chip" ? "text-[15px]" : "text-lg",
      )}
    >
      {project.emoji}
    </span>
  ) : (
    <ProjectMark
      className={size === "chip" ? "size-4" : "size-6"}
      project={project}
    />
  );
}

/**
 * What the head draws from: the views with their counts and choosers, each
 * project with its own, and which of them is on screen. A count is the chats
 * the view would list, so it reads the same predicate the list does.
 */
function useFilterModel({
  chats,
  drafts,
  filters,
  onFiltersChange,
  onNewProject,
  onProjectDetails,
  projects,
}: FilterProps) {
  const live = projects.filter((project) => !project.retired);
  const countIn = (place: ChatPlace) =>
    chats.filter((chat) =>
      matchesFilters(chat, { apps: [], place, search: "", projects: [] }),
    ).length;
  const isChats =
    isInbox(filters) &&
    filters.projects.length === 0 &&
    filters.apps.length === 0;
  const chatsView: View = {
    // The rail's Chat, so the chats look the same wherever they are named.
    icon: (size, isOn) => (
      <PlaceIcon className={size} place="chat" weight={ICON_WEIGHT(isOn)} />
    ),
    id: "chats",
    label: "Chats",
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
    },
    {
      count: countIn("starred"),
      icon: (size, isOn) => (
        <StarIcon className={size} weight={ICON_WEIGHT(isOn)} />
      ),
      id: "starred",
      label: "Starred",
    },
    ...(drafts > 0 || filters.place === "drafts"
      ? [
          {
            count: drafts,
            icon: (size: string, isOn: boolean) => (
              <CircleDashedIcon className={size} weight={ICON_WEIGHT(isOn)} />
            ),
            id: "drafts",
            label: "Drafts",
          } satisfies View,
        ]
      : []),
    {
      icon: (size, isOn) => (
        <ArchiveIcon className={size} weight={ICON_WEIGHT(isOn)} />
      ),
      id: "archived",
      label: "Archived",
    },
  ];
  const chosenProject = live.find((project) =>
    filters.projects.includes(project.id),
  );
  const current = isChats
    ? chatsView
    : views.find((view) => view.id === filters.place);
  return {
    chosenProject,
    // A project or an app narrows the list with no place chosen; the picker
    // then names the project, or the chats for an app.
    current: current ?? chatsView,
    onDetails: onProjectDetails,
    onNew: onNewProject,
    projects: live.map((project) => ({
      choose: () => {
        onFiltersChange(choose(filters, { group: "projects", id: project.id }));
      },
      count: chats.filter((chat) => chat.project === project.id).length,
      isOn: chosenProject?.id === project.id,
      project,
    })),
    views: views.map((view) => ({
      ...view,
      choose: () => {
        if (view.id === "chats") {
          const { place: _place, ...rest } = filters;
          onFiltersChange({ ...rest, apps: [], projects: [] });
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
 * views, every project with its count, and a new one at the foot; a project's
 * details by right click or the dots at its edge. A pick closes the list.
 */
function ViewPicker({
  chosenProject,
  current,
  isCompact,
  onDetails,
  onNew,
  projects,
  views,
}: {
  chosenProject: Project | undefined;
  current: View;
  isCompact: boolean;
  onDetails: (project: Project) => void;
  onNew: () => void;
  projects: {
    choose: () => void;
    count: number;
    isOn: boolean;
    project: Project;
  }[];
  views: (View & { choose: () => void; isOn: boolean })[];
}) {
  const [isOpen, setOpen] = useState(false);
  const pick = (chooseView: () => void) => {
    setOpen(false);
    chooseView();
  };
  const label = chosenProject ? chosenProject.name : current.label;
  // The chats are named alone, the way the inbox is; every other view
  // carries its mark beside its name, so a narrowed list never passes for
  // the whole of it. Drawn in to its mark, every view shows that mark.
  const hasFace =
    isCompact || chosenProject !== undefined || current.id !== "chats";
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={`View: ${label}`}
          className={cn(
            "flex h-9 max-w-48 min-w-0 shrink-0 items-center rounded-lg text-[15px] font-semibold transition-[padding] duration-200 ease-out motion-reduce:transition-none",
            // Its face starts on the rows' own keyline, 16px in, and the
            // hover's grey stands 8px off the card's side, as the search's
            // field does at the other end.
            "px-2",
            PICKER_TONE,
          )}
          data-chosen
          data-compact={isCompact || undefined}
          title={isCompact ? label : undefined}
          type="button"
        >
          <Reveal isOpen={hasFace}>
            <span className="grid size-5 place-items-center">
              {chosenProject ? (
                <ProjectFace size="chip" project={chosenProject} />
              ) : (
                // Outlined: the button's tint already says the view is chosen.
                current.icon("size-5", false)
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
        className="flex w-64 flex-col gap-0.5 p-1.5"
        maxHeight="30rem"
        // Focus lands on the row the list stands in, as a menu of choices
        // does, so the one lit row is the chosen one rather than the first.
        onOpenAutoFocus={(event) => {
          const chosen = event.currentTarget;
          if (!(chosen instanceof HTMLElement)) {
            return;
          }
          const row = chosen.querySelector<HTMLElement>(
            '[aria-checked="true"]',
          );
          if (row) {
            event.preventDefault();
            row.focus();
          }
        }}
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
        {projects.length > 0 && (
          <div className="-mx-1.5 my-0.5 h-px shrink-0 bg-black/5 dark:bg-white/5" />
        )}
        {/* The projects scroll between the views and the foot, which stay. */}
        <MenuScrollArea className="flex flex-col gap-0.5 p-0">
          {projects.map((entry) => (
            <ProjectContextMenu
              key={entry.project.id}
              onDetails={onDetails}
              project={entry.project}
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
                    <ProjectActionsButton
                      className="absolute right-0 group-hover/row:opacity-100"
                      onDetails={onDetails}
                      project={entry.project}
                    />
                  </span>
                }
              >
                <span className="grid size-6 shrink-0 place-items-center">
                  <ProjectFace size="row" project={entry.project} />
                </span>
                <span className="truncate">{entry.project.name}</span>
              </PickerRow>
            </ProjectContextMenu>
          ))}
        </MenuScrollArea>
        <div className="-mx-1.5 my-0.5 h-px shrink-0 bg-black/5 dark:bg-white/5" />
        <PickerRow
          isOn={false}
          muted
          onPick={() => {
            pick(onNew);
          }}
        >
          {/* In the views' own slot, at their size and weight. */}
          <span className="grid size-6 shrink-0 place-items-center">
            <PlusSquareIcon className="size-5" weight="regular" />
          </span>
          <span>New project</span>
        </PickerRow>
      </PopoverContent>
    </Popover>
  );
}
