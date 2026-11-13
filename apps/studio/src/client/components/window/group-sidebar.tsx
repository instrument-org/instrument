import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import {
  groupSearchAtom,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarProjectAtom,
  sidebarViewAtom,
} from "@/client/atoms/tab-groups";
import { type WindowTab } from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
import { NetworkStatusIndicator } from "@/client/components/network-status/network-status-pill";
import { type RailBounds } from "@/client/components/studio-sidebar-rail";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { UpdateStatusIndicator } from "@/client/components/update-status-indicator";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { getInitials } from "@/client/lib/get-initials";
import { showProjectInFiles } from "@/client/lib/show-in-files";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { groupOfWholeKey } from "@/shared/tabs";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { updateDraftAtom } from "@/client/drafts/store";

import { useChatActionsFor } from "./chat-actions";
import { ChatTitleField } from "./chat-title";
import { GroupRowMenu, type GroupRowMenuActions } from "./group-row-menu";
import { HelpMenu } from "./help-menu";
import { toggleLeft } from "./inbox-toggle";
import { useAppsBySlug } from "./apps-by-slug";
import { hasWords, matchesSearch, type Project } from "./chats";
import { Peek } from "./chat-row";
import { NotificationsBell } from "./notifications-bell";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { ProjectsSection } from "./projects-section";
import { RowActionBar } from "./row-action-bar";
import { stopHere } from "./row-shell";
import { pageTabTitle } from "./file-tabs";
import { ScreenMark, stripKeyOf } from "./pane-tabs";
import { screenPresentation } from "./screen-presentation";
import { SearchField } from "./search-field";
import {
  filledRoomAtom,
  heldOverSidebarAtom,
  LIST_GAP_PX,
  liftedRowAtom,
  roomSnapsAtom,
  sidebarDropAtom,
} from "./sidebar-drop";
import { useGroupRowDrag } from "./tab-drag";
import { useChatSearchFallback } from "./use-chat-search-fallback";
import { useGroupRename } from "./use-group-rename";
import { useProjectShift } from "./use-project-shift";
import { useSetChatProject } from "./use-set-chat-project";
import {
  draftWordsTitle,
  lastActiveAt,
  type TabGroup,
  windowTabGroupsAtom,
} from "./tab-groups";
import { isHomeTab } from "./tab-model";
import { chatOfGroup } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/** A key printed beside the control it works, in a light keycap. */
function SoftKey({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-4.5 shrink-0 items-center rounded-[4px] bg-foreground/[0.04] px-1 font-sans text-[11px] font-medium text-muted-foreground/70 ring-1 ring-foreground/[0.06]">
      {children}
    </span>
  );
}

/** Dragged narrower than this, the sidebar slides shut rather than stopping at its floor. */
const SIDEBAR_COLLAPSE_THRESHOLD = 240;
/** The least the group beside the sidebar keeps while the sidebar is dragged wider. */
const GROUP_WIDTH_MIN = 560;

/**
 * How wide the sidebar may be in a window whose sidebar and group share
 * `width`: the row less what the group keeps, within the sidebar's own floor
 * and ceiling. It slides shut under its floor, since the toggle brings it
 * back.
 */
export function sidebarBounds(width: number): RailBounds {
  return {
    collapse: SIDEBAR_COLLAPSE_THRESHOLD,
    initial: SIDEBAR_WIDTH_MIN,
    max: Math.min(
      SIDEBAR_WIDTH_MAX,
      Math.max(SIDEBAR_WIDTH_MIN, width - GROUP_WIDTH_MIN),
    ),
    min: SIDEBAR_WIDTH_MIN,
  };
}

/**
 * The sidebar of tab groups down the window's left: the window's own row at
 * its top (past the traffic lights, the bell; the update pill at its end),
 * the search, the projects, the pinned groups over a plain line, New, the
 * rest under it, newest first, and the way into History at the list's end,
 * and the account, Settings and Help at its foot. Opening a project takes the list over,
 * under its banner. A row dragged within the list lands where it is let
 * go, pinned above the line or unpinned below it, and one dragged out goes
 * to a window of its own or to another window's list (`useGroupRowDrag`).
 * A tab held over it goes as a row at the pointer (`HeldPicture`).
 */
export function GroupSidebar({
  chatTitles,
  elsewhere,
  groupUp,
  history,
  onClose,
  onCloseAll,
  onNew,
  onNewProject,
  onNewProjectFor,
  onRestore,
  onShow,
  open,
  projects,
  searchRef,
}: {
  chatTitles: Map<ChatId, string>;
  /** The chats other windows have open, which choosing brings forward there. */
  elsewhere: TabGroup[];
  /** The group this window shows. */
  groupUp: string | undefined;
  /** History: every chat and kept draft no window has open, most recently active first. */
  history: TabGroup[];
  onClose: (group: string) => void;
  /** Closes several groups at once, from the row whose menu asked (`keep`). */
  onCloseAll: (groups: string[], keep: string) => void;
  onNew: (projectId?: string) => void;
  onNewProject: () => void;
  /** The new-project dialog for one group, which files it under the project it makes. */
  onNewProjectFor: (target: { chatId: ChatId } | { draftId: string }) => void;
  onRestore: (group: string) => void;
  onShow: (group: string, options: { newWindow: boolean }) => void;
  open: TabGroup[];
  projects: Project[];
  searchRef?: Ref<HTMLInputElement>;
}) {
  const [view, setView] = useAtom(sidebarViewAtom);
  const [search, setSearch] = useAtom(groupSearchAtom);
  const [projectId, setProjectId] = useAtom(sidebarProjectAtom);
  const project = projects.find((entry) => entry.id === projectId);
  // The search and the list slide in together as the sidebar steps into a
  // project or back out of one.
  const shiftRef = useRef<HTMLDivElement>(null);
  useProjectShift(shiftRef, project?.id);
  // The wash keeps the last project's color while it fades out, since the
  // sidebar's own tint goes the moment the list leaves.
  const [lastProject, setLastProject] = useState<Project>();
  if (project && project !== lastProject) {
    setLastProject(project);
  }
  const washProject = project ?? lastProject;
  const isSearching = search.trim() !== "";

  const inProject = (entry: TabGroup) =>
    project === undefined ||
    (entry.kind === "chat"
      ? entry.chat.project === project.id
      : entry.draft.projectId === project.id);
  const listed = open.filter(inProject);
  const pinned = listed.filter(
    (entry) => entry.kind === "chat" && entry.chat.starred,
  );
  const rest = listed.filter(
    (entry) => !(entry.kind === "chat" && entry.chat.starred),
  );
  const { allTabs } = useWindowTabs();
  const projectNames = new Map(projects.map((each) => [each.id, each.name]));
  /**
   * Whether a group turns up for the search: by the name the person gave it,
   * a chat by what the chat list searches on its row, a draft by its words,
   * its project, and the pages its tabs have open, one of which names its
   * row while it has no words.
   */
  const matches = (entry: TabGroup) =>
    entry.kind === "chat"
      ? matchesSearch(entry.chat, search, projectNames) ||
        (entry.name !== undefined && hasWords(search, [entry.name]))
      : hasWords(search, [
          entry.title,
          entry.draft.words,
          entry.draft.projectId === undefined
            ? ""
            : (projectNames.get(entry.draft.projectId) ?? ""),
          ...allTabs.flatMap((tab) =>
            tab.group === entry.group && tab.kind === "page"
              ? [pageTabTitle(tab) || (tab.url ?? "")]
              : [],
          ),
        ]);
  const matching = (entries: TabGroup[]) => entries.filter(matches);
  const chats = open.flatMap((entry) =>
    entry.kind === "chat" ? [entry.chat] : [],
  );
  const arriving = useArrivals(useAtomValue(windowTabGroupsAtom) ?? NO_GROUPS);
  const pressRow = useGroupRowDrag();
  const drop = useAtomValue(sidebarDropAtom);
  const lifted = useAtomValue(liftedRowAtom);
  const roomSnaps = useAtomValue(roomSnapsAtom);
  const filled = useAtomValue(filledRoomAtom);
  const room = drop?.kind === "between" ? drop : undefined;
  const isPinned = (entry: TabGroup) =>
    entry.kind === "chat" && entry.chat.starred;
  // The rows the list shows, in its order, which a row's menu closes around.
  const shownRows = isSearching ? matching(open) : [...pinned, ...rest];
  const liftedEntry =
    lifted && open.find((entry) => entry.group === lifted.group);
  const actionsFor = useChatActionsFor();
  const setChatProject = useSetChatProject();
  const updateDraft = useSetAtom(updateDraftAtom);
  const menuOf = (entry: TabGroup): GroupRowMenuActions => {
    // Pinned rows stay open, as a browser's pinned tabs do.
    const closing = (around: TabGroup[]) => {
      const groups = around.flatMap((each) =>
        isPinned(each) ? [] : [each.group],
      );
      return groups.length === 0
        ? undefined
        : () => {
            onCloseAll(groups, entry.group);
          };
    };
    const at = shownRows.findIndex((each) => each.group === entry.group);
    return {
      actions: entry.kind === "chat" ? actionsFor(entry.chat) : [],
      onClose: () => {
        onClose(entry.group);
      },
      onCloseAbove: at === -1 ? undefined : closing(shownRows.slice(0, at)),
      onCloseBelow: at === -1 ? undefined : closing(shownRows.slice(at + 1)),
      onCloseOthers: closing(
        shownRows.filter((each) => each.group !== entry.group),
      ),
      onNewProject: () => {
        onNewProjectFor(
          entry.kind === "chat"
            ? { chatId: entry.chat.id }
            : { draftId: entry.draft.id },
        );
      },
      onNewWindow: () => {
        onShow(entry.group, { newWindow: true });
      },
      onSetProject: (filed) => {
        if (entry.kind === "chat") {
          setChatProject(entry.chat.id, filed);
          return;
        }
        updateDraft({
          id: entry.draft.id,
          update: (draft) => {
            if (filed !== null) {
              return { ...draft, projectId: filed, projectSource: "chosen" };
            }
            const { projectId: _dropped, ...unfiled } = draft;
            return { ...unfiled, projectSource: "chosen" };
          },
        });
      },
      projects,
    };
  };

  const row = (
    entry: TabGroup,
    extra?: { isElsewhere?: boolean; isListed?: boolean; restore?: boolean },
  ) => (
    <GroupRow
      chatTitles={chatTitles}
      entry={entry}
      isDropInto={drop?.kind === "into" && drop.group === entry.group}
      isUp={entry.group === groupUp}
      key={entry.group}
      {...(extra?.isElsewhere ? {} : { onClose })}
      {...(extra?.isListed ? { onPress: pressRow } : {})}
      {...(extra?.isElsewhere || extra?.restore ? {} : { menu: menuOf(entry) })}
      onShow={onShow}
      {...(extra?.restore
        ? {
            restore: () => {
              onRestore(entry.group);
              setView("list");
              setSearch("");
            },
          }
        : {})}
    />
  );

  const found = isSearching ? matching(open) : [];
  const inOtherWindows = isSearching ? matching(elsewhere) : [];
  const fromHistory = isSearching ? matching(history) : [];
  const isNothingFound =
    found.length === 0 &&
    inOtherWindows.length === 0 &&
    fromHistory.length === 0;
  // Words that turn up in no group anywhere go to the decision model, which
  // reads the chats' titles for the ones the search means, as the chat list
  // does.
  const everyGroup = [...open, ...elsewhere, ...history];
  const aiSearch = useChatSearchFallback({
    active: isSearching && isNothingFound,
    candidates: everyGroup.flatMap((entry) =>
      entry.kind === "chat" ? [entry.chat] : [],
    ),
    search,
  });

  let body: ReactNode;
  if (isSearching) {
    const aiFound = isNothingFound
      ? aiSearch.chats.flatMap((chat) => {
          const entry = everyGroup.find((each) => each.group === chat.id);
          return entry ? [entry] : [];
        })
      : [];
    body = (
      <>
        {found.map((entry) => row(entry))}
        {isNothingFound && aiFound.length === 0 && (
          <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
            {aiSearch.isLooking
              ? "Looking through your chats…"
              : "Nothing matches that."}
          </p>
        )}
        {aiFound.length > 0 && <SearchSection label="AI Results" />}
        {aiFound.map((entry) =>
          open.includes(entry)
            ? row(entry)
            : elsewhere.includes(entry)
              ? row(entry, { isElsewhere: true })
              : row(entry, { restore: true }),
        )}
        {inOtherWindows.length > 0 && (
          <SearchSection label="In Other Windows" />
        )}
        {inOtherWindows.map((entry) => row(entry, { isElsewhere: true }))}
        {fromHistory.length > 0 && <SearchSection label="From History" />}
        {fromHistory.map((entry) => row(entry, { restore: true }))}
      </>
    );
  } else if (view === "history") {
    body = (
      <>
        <BackRow
          label="History"
          onBack={() => {
            setView("list");
          }}
        />
        <HistoryList
          history={history}
          row={(entry) => row(entry, { restore: true })}
        />
      </>
    );
  } else {
    // What the list shows in order, for the room a drag opens in it: the
    // items from the one it opens in front of on move aside.
    const items = [
      ...pinned.map((entry) => `row:${entry.group}`),
      ...(pinned.length > 0 ? [":divider"] : []),
      ":new",
      ...rest.map((entry) => `row:${entry.group}`),
      ...(project ? [] : [":history"]),
    ];
    const roomAt = room?.before === undefined ? -1 : items.indexOf(room.before);
    const place = (item: string) => ({
      item,
      ...(room && roomAt !== -1 && items.indexOf(item) >= roomAt
        ? { shift: room.gap }
        : {}),
      snaps: roomSnaps,
    });
    const listItem = (entry: TabGroup, section: "pinned" | "rest") => (
      <ListItem
        group={entry.group}
        isArriving={arriving.has(entry.group) && entry.group !== filled}
        isLifted={lifted?.group === entry.group}
        key={`row:${entry.group}`}
        section={section}
        {...place(`row:${entry.group}`)}
      >
        {row(entry, { isListed: true })}
      </ListItem>
    );
    body = (
      <>
        {project ? (
          <>
            <BackRow
              label="Back"
              onBack={() => {
                setProjectId(undefined);
              }}
            />
            <ProjectBanner
              onDetails={(shown) => {
                openProjectDetails(shown.id);
              }}
              onOpenInFiles={(shown) => {
                void showProjectInFiles(shown);
              }}
              project={project}
            />
          </>
        ) : (
          <ProjectsSection
            chats={chats}
            onChoose={(chosen) => {
              setProjectId(chosen.id);
            }}
            onDetails={(chosen) => {
              openProjectDetails(chosen.id);
            }}
            onNew={onNewProject}
            projects={projects}
          />
        )}
        <AnimatePresence>
          {pinned.map((entry) => listItem(entry, "pinned"))}
          {pinned.length > 0 && (
            <ListItem isInstant key=":divider" {...place(":divider")}>
              <div className="mx-2.5 my-1.5 h-px bg-border" />
            </ListItem>
          )}
          <ListItem key=":new" {...place(":new")}>
            <NewRow
              isDropTarget={drop?.kind === "new" && drop.over === "new"}
              onNew={() => {
                onNew(project?.id);
              }}
            />
          </ListItem>
          {rest.map((entry) => listItem(entry, "rest"))}
          {!project && (
            <ListItem key=":history" {...place(":history")}>
              <HistoryRow
                onOpen={() => {
                  setView("history");
                }}
              />
            </ListItem>
          )}
        </AnimatePresence>
        {room && room.before === undefined && (
          <div
            className="shrink-0"
            style={{ height: room.gap - LIST_GAP_PX }}
          />
        )}
        {/* The list's empty space under the rows, where a tab held over it
            becomes a group of its own. */}
        <div
          className={cn(
            "min-h-0 flex-1 rounded-lg",
            drop?.kind === "new" && drop.over === "empty" && "bg-foreground/5",
          )}
          data-drop-empty=""
        />
      </>
    );
  }

  return (
    // Its own stacking context, so the project's wash can sit under the rows.
    <nav
      aria-label="Tab groups"
      className={cn(
        "relative isolate flex h-full w-full flex-col",
        project && "project-tint",
      )}
      style={project ? projectTint(projectColor(project)) : undefined}
    >
      {/* While the list is one project, its tint washes down from the
          window's top and fades out past the banner, behind the first rows;
          sized against the whole sidebar, so a taller window washes further
          down it. */}
      {washProject && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(20%+14rem)] bg-linear-to-b from-(--project-tint-surface)/50 to-transparent transition-opacity duration-300 ease-out project-tint motion-reduce:transition-none dark:from-(--project-tint-surface)/25 starting:opacity-0",
            !project && "opacity-0",
          )}
          style={projectTint(projectColor(washProject))}
        />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <SidebarTop />
        <div className="flex min-h-0 flex-1 flex-col" ref={shiftRef}>
          {!project && (
            <div className="flex shrink-0 items-center gap-1 px-2">
              <div className="relative flex min-w-0 flex-1">
                <SearchField
                  className="pl-8.75 [&>svg]:left-2.25 [&>svg]:size-4"
                  inputRef={searchRef}
                  label="Search Tab Groups"
                  onChange={setSearch}
                  placeholder="Search"
                  value={search}
                />
                {!isSearching && (
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
                    <SoftKey>
                      {formatAcceleratorText(
                        WINDOW_SHORTCUTS.searchChats.accelerator,
                      )}
                    </SoftKey>
                  </span>
                )}
              </div>
            </div>
          )}
          <GroupList>
            {body}
            {liftedEntry && !lifted?.isOff && (
              <div
                className="pointer-events-none absolute inset-x-2 z-10 rotate-1 rounded-lg bg-card shadow-xl ring-1 ring-black/[0.06]"
                data-lifted-copy=""
                style={{ top: lifted?.top }}
              >
                <GroupRow
                  chatTitles={chatTitles}
                  entry={liftedEntry}
                  isLifted
                  isUp={liftedEntry.group === groupUp}
                />
              </div>
            )}
          </GroupList>
        </div>
        <SidebarFoot chatId={chatOfGroup(groupUp)} />
      </div>
      <HeldPicture
        chatTitles={chatTitles}
        entries={[...open, ...elsewhere, ...history]}
      />
    </nav>
  );
}

/** The list of a window that has none yet, one array for every render. */
const NO_GROUPS: readonly string[] = [];

/** How long a row takes to open its room in the list, or to close it. */
const ROW_MOTION_MS = 200;
const ROW_MOTION = {
  duration: ROW_MOTION_MS / 1000,
  ease: [0.2, 0.8, 0.2, 1],
} as const;
/** How long a row arriving wears the inbox's arrival (`chat-arrive`). */
const ARRIVAL_MS = 320;

/**
 * The groups the window has taken on since the sidebar came up, for as long
 * as their rows take to arrive: one made, opened from History or search, or
 * dropped in. Read off the window's list rather than the rows, so groups
 * whose chats are still loading as the window opens never count.
 */
function useArrivals(listed: readonly string[]): ReadonlySet<string> {
  const [last, setLast] = useState(listed);
  const [arriving, setArriving] = useState<ReadonlySet<string>>(new Set());
  if (listed !== last) {
    setLast(listed);
    const fresh = listed.filter((group) => !last.includes(group));
    if (fresh.length > 0) {
      setArriving(new Set([...arriving, ...fresh]));
    }
  }
  useEffect(() => {
    if (arriving.size === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setArriving(new Set());
    }, ARRIVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [arriving]);
  return arriving;
}

/**
 * One thing in the list: a row arriving opens its room as it slides into
 * it the way a chat arrives in the inbox, and one leaving closes its room as
 * it fades, out of reach meanwhile. While a drag over the list opens a room
 * in front of it, it and everything after it move aside by the room's
 * height; a row lifted out of the list shuts its place. Marked for where a
 * drag lands (`sidebarDropAt`), which measures it as laid out.
 */
function ListItem({
  children,
  group,
  isArriving = false,
  isInstant = false,
  isLifted = false,
  item,
  section,
  shift = 0,
  snaps,
}: {
  children: ReactNode;
  group?: string;
  isArriving?: boolean;
  /** It comes and goes at once, as the line under the pinned rows does with the first pinned and the last unpinned. */
  isInstant?: boolean;
  isLifted?: boolean;
  item: string;
  section?: "pinned" | "rest";
  shift?: number;
  /** The room moves at once rather than sliding. */
  snaps: boolean;
}) {
  const isPresent = useIsPresent();
  const isReduced = useReducedMotion() === true;
  return (
    <motion.div
      animate={{
        height: "auto",
        opacity: 1,
        transitionEnd: { overflow: "visible" },
      }}
      className={cn(
        "relative shrink-0",
        isArriving && "chat-arrive",
        isLifted && "hidden",
      )}
      data-drop-group={group}
      data-drop-item={item}
      data-drop-section={section}
      data-leaving={isPresent ? undefined : ""}
      data-lifted={isLifted ? "" : undefined}
      exit={{ height: 0, opacity: 0, overflow: "hidden" }}
      inert={!isPresent}
      initial={isArriving ? { height: 0, overflow: "hidden" } : false}
      transition={isReduced || isInstant ? { duration: 0 } : ROW_MOTION}
    >
      <div
        className={cn(
          !snaps &&
            "transition-[translate] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
        )}
        style={shift === 0 ? undefined : { translate: `0 ${shift}px` }}
      >
        {children}
      </div>
    </motion.div>
  );
}

/**
 * The list, which scrolls whole, New with it, and where a drag over it
 * shows where it lands (`sidebarDropAt`) and a lifted row stands.
 */
function GroupList({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
      data-group-list=""
    >
      {children}
    </div>
  );
}

/** How far under the pointer a tab held over the sidebar hangs. */
const TAB_HANGS_PX = 10;

/**
 * What is held over the sidebar from a tab's strip, its own window's or
 * another's, drawn at the pointer as a row: a tab as a one-line row of its
 * mark and title, a whole group from another window as its row. It stands in
 * for main's picture of the window, which shows only where letting go would
 * make a window. Files dragged in are drawn as the tab the first would be.
 */
function HeldPicture({
  chatTitles,
  entries,
}: {
  chatTitles: Map<ChatId, string>;
  /** Every group this window can name, another window's included. */
  entries: readonly TabGroup[];
}) {
  const held = useAtomValue(heldOverSidebarAtom);
  const { allTabs } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const ref = useRef<HTMLDivElement>(null);
  const isWhole = held !== undefined && groupOfWholeKey(held.key) !== undefined;
  // In the sidebar's own px, which the window's zoom scales: a group's row
  // centered on the pointer, as a row lifted out of the list is held, and a
  // tab hanging just under it, so the row or New it would land in shows.
  useLayoutEffect(() => {
    const element = ref.current;
    const sidebar = element?.offsetParent;
    if (!element || !held || !(sidebar instanceof HTMLElement)) {
      return;
    }
    const bounds = sidebar.getBoundingClientRect();
    const zoom =
      sidebar.offsetHeight > 0 ? bounds.height / sidebar.offsetHeight : 1;
    const at = (held.clientY - bounds.top) / zoom;
    element.style.top = `${isWhole ? at - element.offsetHeight / 2 : at + TAB_HANGS_PX}px`;
  });
  if (!held) {
    return null;
  }
  const whole = groupOfWholeKey(held.key);
  const entry =
    whole === undefined
      ? undefined
      : entries.find((each) => each.group === whole);
  const tab =
    whole === undefined
      ? (held.files?.[0] ??
        allTabs.find((each) => stripKeyOf(each) === held.key))
      : undefined;
  // Files dragged in go as the first of them, saying how many more there are.
  const more = (held.files?.length ?? 1) - 1;
  let shown: ReactNode = null;
  if (entry) {
    shown = (
      <GroupRow chatTitles={chatTitles} entry={entry} isLifted isUp={false} />
    );
  } else if (tab) {
    const title = `${
      tab.kind === "page"
        ? pageTabTitle(tab) || (tab.url ?? tab.openedUrl ?? "")
        : screenPresentation(tab.href, { appsBySlug, chatTitles }).title
    }${more > 0 ? ` and ${more} more` : ""}`;
    shown = (
      <div className="flex h-9 items-center gap-2.5 px-2.5">
        <span className="grid size-4 shrink-0 place-items-center">
          <TabMark appsBySlug={appsBySlug} chatTitles={chatTitles} tab={tab} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85">
          {title}
        </span>
      </div>
    );
  }
  if (!shown) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-2 z-20 rotate-1 rounded-lg bg-card shadow-xl ring-1 ring-black/[0.06]"
      data-held-picture=""
      ref={ref}
    >
      {shown}
    </div>
  );
}

/** New, which also lights while a tab held over it would become a group of its own. */
function NewRow({
  isDropTarget,
  onNew,
}: {
  isDropTarget: boolean;
  onNew: () => void;
}) {
  return (
    <button
      className={cn(
        "flex h-9 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
        isDropTarget && "bg-foreground/5 text-foreground",
      )}
      data-drop-target={isDropTarget ? "" : undefined}
      onClick={onNew}
      type="button"
    >
      <PlusIcon className="size-4" />
      <span className="flex-1 text-left">New</span>
      <SoftKey>
        {formatAcceleratorText(WINDOW_SHORTCUTS.newChat.accelerator)}
      </SoftKey>
    </button>
  );
}

/**
 * The way into History at the list's end, dimmed so it reads as past the
 * groups rather than one of them, naming none of what is there.
 */
function HistoryRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="mt-1 flex h-8 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground"
      onClick={onOpen}
      type="button"
    >
      <ClockCounterClockwiseIcon className="size-4" />
      <span className="flex-1 text-left">History</span>
      <CaretRightIcon className="size-3.5" />
    </button>
  );
}

function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      className="flex h-8 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-foreground/75 hover:bg-foreground/5"
      onClick={onBack}
      type="button"
    >
      <span className="grid size-4 place-items-center">
        <CaretLeftIcon className="size-3.5" />
      </span>
      {label}
    </button>
  );
}

/** A line over a part of the search's results, naming where they are. */
function SearchSection({ label }: { label: string }) {
  return (
    <div className="mx-1 mt-2 mb-1 flex items-center gap-2 px-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The chats and drafts in History, most recently active first, under the day each last had something happen. */
function HistoryList({
  history,
  row,
}: {
  history: TabGroup[];
  row: (entry: TabGroup) => ReactNode;
}) {
  if (history.length === 0) {
    return (
      <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
        Tab groups you close show up here.
      </p>
    );
  }
  const days = new Map<string, TabGroup[]>();
  for (const entry of history) {
    const day = dayLabel(lastActiveAt(entry));
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return (
    <>
      {[...days].map(([day, entries]) => (
        <div className="flex flex-col gap-0.5" key={day}>
          <p className="px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            {day}
          </p>
          {entries.map(row)}
        </div>
      ))}
    </>
  );
}

function dayLabel(at: number): string {
  const day = new Date(at);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) {
    return "Today";
  }
  if (day.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return day.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * One tab group as two lines: its title, bold while it holds something not
 * yet seen; then its chat's latest line (the step it is on, the question it
 * waits on, or its last reply), with the marks of the group's tabs at the
 * line's end. A group whose chat has not started has only its tabs' marks
 * there. While the pointer is on a row that closes, a close X stands at the
 * title line's end, and a middle click closes it too. While a tab held over
 * it would land in its group, it takes the tone of the row up. A right click
 * raises its menu (`GroupRowMenu`), whose Rename turns the title into a
 * field, as a double click on the title does. The title is the name the
 * person gave the group, else its own: its chat's title, or what a group
 * whose chat has not started is called.
 */
export function GroupRow({
  chatTitles,
  entry,
  isDropInto = false,
  isLifted = false,
  isUp,
  menu,
  onClose,
  onPress,
  onShow,
  restore,
}: {
  chatTitles: Map<ChatId, string>;
  entry: TabGroup;
  isDropInto?: boolean;
  /** The copy of a row lifted out of the list, which stands for it under the pointer. */
  isLifted?: boolean;
  isUp: boolean;
  /** What its menu does, for a row of this window's own groups. */
  menu?: GroupRowMenuActions;
  onClose?: (group: string) => void;
  /** A press that may become a drag of the row. */
  onPress?: (group: string, event: ReactPointerEvent<HTMLElement>) => void;
  onShow?: (group: string, options: { newWindow: boolean }) => void;
  restore?: () => void;
}) {
  const chat = entry.kind === "chat" ? entry.chat : undefined;
  const isUnread = chat?.unread === true;
  const { selectedTabIn } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  // A group whose chat has no words yet is named by the tab it has up,
  // until the person names it.
  const up =
    entry.kind === "draft" && entry.draft.words.trim() === ""
      ? selectedTabIn(entry.group)
      : undefined;
  let ownTitle =
    entry.kind === "draft" ? draftWordsTitle(entry.draft) : entry.chat.title;
  if (up?.kind === "page") {
    ownTitle = pageTabTitle(up) || ownTitle;
  } else if (up !== undefined) {
    ownTitle = screenPresentation(up.href, { appsBySlug, chatTitles }).title;
  }
  const title = entry.name ?? ownTitle;
  const rename = useGroupRename(entry, ownTitle);
  const shown = (
    <div
      className={cn(
        "group/row flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5",
        isUp || isDropInto
          ? "bg-card shadow-xs ring-1 ring-black/[0.04]"
          : "hover:bg-foreground/[0.04]",
        onShow && "cursor-default",
        onPress && "select-none",
      )}
      {...(restore || isLifted ? {} : { "data-group-row": entry.group })}
      data-drop-into={isDropInto ? "" : undefined}
      data-up={isUp && !isLifted ? "" : undefined}
      onAuxClick={(event) => {
        // A middle click closes the group the way its X does, asking first
        // while its agent works.
        if (event.button === 1 && onClose && !restore) {
          event.preventDefault();
          onClose(entry.group);
        }
      }}
      onClick={(event) => {
        if (!restore) {
          onShow?.(entry.group, { newWindow: event.shiftKey });
        }
      }}
      // A middle press would start the list's autoscroll.
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault();
        }
      }}
      onPointerDown={
        onPress
          ? (event) => {
              onPress(entry.group, event);
            }
          : undefined
      }
      role={restore || isLifted ? undefined : "button"}
    >
      <div className="min-w-0 flex-1">
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          {rename.isEditing ? (
            // Clicks, presses and keys in the field are the field's, not the row's.
            <span
              className="-my-1.5 flex min-w-0 flex-1"
              onAuxClick={stopHere}
              onClick={stopHere}
              onKeyDown={stopHere}
              onMouseDown={stopHere}
              onPointerDown={stopHere}
            >
              <ChatTitleField
                className="text-[13px] font-medium"
                grow
                placeholder={ownTitle}
                rename={rename}
                width={undefined}
              />
            </span>
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] leading-5",
                isUnread
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground/85",
              )}
              // A row with a menu renames from it, and from a double click
              // on its title.
              onDoubleClick={menu ? rename.start : undefined}
            >
              {title}
            </span>
          )}
          <RowActionBar
            actions={
              onClose && !restore
                ? [
                    {
                      icon: <XIcon />,
                      id: "close",
                      label: "Close Tab Group",
                      run: () => {
                        onClose(entry.group);
                      },
                    },
                  ]
                : []
            }
          />
        </div>
        <div className="flex h-5 min-w-0 items-center gap-2 text-[12px] leading-5">
          <SecondLine chatTitles={chatTitles} entry={entry} />
        </div>
      </div>
      {restore && (
        <button
          className="ml-auto flex h-6 shrink-0 items-center rounded-md bg-background px-2 text-xs font-medium opacity-0 shadow-xs ring-1 ring-border group-hover/row:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            restore();
          }}
          type="button"
        >
          Open
        </button>
      )}
    </div>
  );
  return menu ? (
    <GroupRowMenu entry={entry} menu={menu} onRename={rename.start}>
      {shown}
    </GroupRowMenu>
  ) : (
    shown
  );
}

/**
 * The second line of a row: its chat's latest line, as the inbox's row says
 * it, and the marks of its tabs, a new tab's aside, at the line's end and at
 * most under half of it; a group whose chat has not started has the marks
 * alone.
 */
function SecondLine({
  chatTitles,
  entry,
}: {
  chatTitles: Map<ChatId, string>;
  entry: TabGroup;
}) {
  const { allTabs } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const tabs = allTabs.filter(
    (tab) => tab.group === entry.group && !isHomeTab(tab),
  );
  const marks = tabs
    .slice(0, 8)
    .map((tab) => (
      <TabMark
        appsBySlug={appsBySlug}
        chatTitles={chatTitles}
        key={tab.id}
        tab={tab}
      />
    ));
  if (entry.kind === "draft") {
    return tabs.length === 0 ? (
      <span className="text-muted-foreground">Nothing open yet</span>
    ) : (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden text-muted-foreground">
        {marks}
      </span>
    );
  }
  return (
    <>
      <span className="flex min-w-0 flex-1">
        <Peek chat={entry.chat} />
      </span>
      {tabs.length > 0 && (
        <span className="flex max-w-[45%] shrink-0 items-center justify-end gap-1 overflow-hidden text-muted-foreground">
          {marks}
        </span>
      )}
    </>
  );
}

function TabMark({
  appsBySlug,
  chatTitles,
  tab,
}: {
  appsBySlug: ReturnType<typeof useAppsBySlug>;
  chatTitles: Map<ChatId, string>;
  tab: WindowTab;
}) {
  if (tab.kind === "page") {
    return (
      <PageFavicon
        className="size-3.5 shrink-0"
        favicon={tab.favicon}
        hasTooltip={false}
        url={tab.url ?? tab.openedUrl ?? ""}
      />
    );
  }
  return (
    <span className="grid size-3.5 shrink-0 place-items-center [&_svg]:size-3.5">
      <ScreenMark
        appsBySlug={appsBySlug}
        chatTitles={chatTitles}
        href={tab.href}
      />
    </span>
  );
}

/**
 * The sidebar's top row, which drags the window: room for the traffic lights
 * on a Mac and for the sidebar's toggle, which stands over the row's start
 * (`SidebarToggleCorner`), then the app's menu off the Mac; the network and
 * update pills, and the bell at its end.
 */
function SidebarTop() {
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-1 pr-3 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
      style={{ paddingLeft: `calc(${toggleLeft(true)} + 2rem)` }}
    >
      {!isMacOS() && <AppMenuButton />}
      <span className="flex-1" />
      <NetworkStatusIndicator />
      <UpdateStatusIndicator />
      <NotificationsBell />
    </div>
  );
}

/** The app's menu, off the Mac, where no menu bar shows it. */
function AppMenuButton() {
  return (
    <button
      aria-label="Menu"
      className="grid size-7 shrink-0 place-items-center rounded-md text-foreground/80 hover:bg-foreground/5"
      onClick={({ currentTarget }) => {
        const { bottom, left } = currentTarget.getBoundingClientRect();
        void rpcClient.window.showAppMenu.call({ x: left, y: bottom });
      }}
      title="Menu"
      type="button"
    >
      <span className="text-base leading-none">≡</span>
    </button>
  );
}

/** The sidebar's foot: the account, which opens Settings, Settings itself, and Help. */
function SidebarFoot({ chatId }: { chatId: ReturnType<typeof chatOfGroup> }) {
  const { data: user } = useLiveUser();
  const { data: workspace } = useQuery(
    rpcClient.workspaces.current.queryOptions(),
  );
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-t border-border/60 pr-3 pl-2">
      <button
        className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left hover:bg-foreground/5"
        onClick={() => {
          openSettings({ tab: "General" });
        }}
        type="button"
      >
        <Avatar className="size-6 rounded-md">
          <AvatarImage alt="" src={user?.image ?? undefined} />
          <AvatarFallback className="rounded-md text-[10px]">
            {user ? getInitials(user.name) : "?"}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate text-[13px] font-medium">
          {user?.name ?? workspace?.name ?? "Sign in"}
        </span>
      </button>
      <ToolbarTooltip label="Settings">
        <button
          aria-label="Settings"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => {
            openSettings({ tab: "General" });
          }}
          type="button"
        >
          <GearSixIcon className="size-4" />
        </button>
      </ToolbarTooltip>
      <HelpMenu chatId={chatId} />
    </div>
  );
}
