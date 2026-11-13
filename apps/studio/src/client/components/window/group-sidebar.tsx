import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import {
  groupSearchAtom,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
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
import { formatAbsoluteTime } from "@/client/lib/relative-time";
import { getInitials } from "@/client/lib/get-initials";
import { showProjectInFiles } from "@/client/lib/show-in-files";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";

import { HelpMenu } from "./help-menu";
import { toggleLeft } from "./inbox-toggle";
import { useAppsBySlug } from "./apps-by-slug";
import { activityLabel, hasWords, type Project } from "./chats";
import { Peek } from "./chat-row";
import { NotificationsBell } from "./notifications-bell";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { ProjectsSection } from "./projects-section";
import { RowActionBar } from "./row-action-bar";
import { pageTabTitle } from "./file-tabs";
import { ScreenMark } from "./pane-tabs";
import { screenPresentation } from "./screen-presentation";
import { SearchField } from "./search-field";
import { useProjectShift } from "./use-project-shift";
import {
  lastActiveAt,
  type TabGroup,
  windowTabGroupsAtom,
} from "./tab-groups";
import { isHomeTab } from "./tab-model";
import { useNow } from "./use-now";
import { chatOfGroup } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/** A key printed beside the control it works, in a light keycap. */
export function SoftKey({ children }: { children: ReactNode }) {
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
 * under its banner.
 */
export function GroupSidebar({
  chatTitles,
  elsewhere,
  groupUp,
  history,
  onClose,
  onNew,
  onNewProject,
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
  onNew: (projectId?: string) => void;
  onNewProject: () => void;
  onRestore: (group: string) => void;
  onShow: (group: string, options: { newWindow: boolean }) => void;
  open: TabGroup[];
  projects: Project[];
  searchRef?: Ref<HTMLInputElement>;
}) {
  const [view, setView] = useAtom(sidebarViewAtom);
  const [search, setSearch] = useAtom(groupSearchAtom);
  const [projectId, setProjectId] = useState<string>();
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
  const matching = (entries: TabGroup[]) =>
    entries.filter((entry) => hasWords(search, [entry.title]));
  const chats = open.flatMap((entry) =>
    entry.kind === "chat" ? [entry.chat] : [],
  );
  const arriving = useArrivals(useAtomValue(windowTabGroupsAtom) ?? []);

  const row = (
    entry: TabGroup,
    extra?: { isElsewhere?: boolean; restore?: boolean },
  ) => (
    <GroupRow
      chatTitles={chatTitles}
      entry={entry}
      isUp={entry.group === groupUp}
      key={entry.group}
      {...(extra?.isElsewhere ? {} : { onClose })}
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

  let body: ReactNode;
  if (isSearching) {
    const found = matching(open);
    const inOtherWindows = matching(elsewhere);
    const fromHistory = matching(history);
    body = (
      <>
        {found.map((entry) => row(entry))}
        {found.length === 0 &&
          inOtherWindows.length === 0 &&
          fromHistory.length === 0 && (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
              Nothing matches that.
            </p>
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
          {pinned.map((entry) => (
            <ListItem
              isArriving={arriving.has(entry.group)}
              key={`row:${entry.group}`}
            >
              {row(entry)}
            </ListItem>
          ))}
          {pinned.length > 0 && (
            <ListItem key=":divider">
              <div className="mx-2.5 my-1.5 h-px bg-border" />
            </ListItem>
          )}
          <ListItem key=":new">
            <NewRow
              onNew={() => {
                onNew(project?.id);
              }}
            />
          </ListItem>
          {rest.map((entry) => (
            <ListItem
              isArriving={arriving.has(entry.group)}
              key={`row:${entry.group}`}
            >
              {row(entry)}
            </ListItem>
          ))}
          {!project && (
            <ListItem key=":history">
              <HistoryRow
                onOpen={() => {
                  setView("history");
                }}
              />
            </ListItem>
          )}
        </AnimatePresence>
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
          <GroupList>{body}</GroupList>
        </div>
        <SidebarFoot chatId={chatOfGroup(groupUp)} />
      </div>
    </nav>
  );
}

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
 * it fades, out of reach meanwhile.
 */
function ListItem({
  children,
  isArriving = false,
}: {
  children: ReactNode;
  isArriving?: boolean;
}) {
  const isPresent = useIsPresent();
  const isReduced = useReducedMotion() === true;
  return (
    <motion.div
      animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
      className={cn("shrink-0", isArriving && "chat-arrive")}
      data-leaving={isPresent ? undefined : ""}
      exit={{ height: 0, opacity: 0, overflow: "hidden" }}
      inert={!isPresent}
      initial={isArriving ? { height: 0, overflow: "hidden" } : false}
      transition={isReduced ? { duration: 0 } : ROW_MOTION}
    >
      {children}
    </motion.div>
  );
}

/**
 * The list, which scrolls whole, New with it. A tab let go of over the
 * list's empty space becomes a group of its own (`useGroupTabCarry`).
 */
function GroupList({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 data-drop-target:bg-brand-500/5"
      data-group-list=""
    >
      {children}
    </div>
  );
}

function NewRow({ onNew }: { onNew: () => void }) {
  return (
    <button
      className="flex h-9 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
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
 * One tab group as two lines, the inbox's two-line row: its title, bold
 * while it holds something not yet seen, with when the person last wrote in
 * its chat at the line's end; then its chat's latest line (the step it is
 * on, the question it waits on, or its last reply), with the marks of the
 * group's tabs at the line's end. A group whose chat has not started has
 * only its tabs' marks there. While the pointer is on a row that closes, a
 * close X stands in the time's place.
 */
export function GroupRow({
  chatTitles,
  entry,
  isUp,
  onClose,
  onShow,
  restore,
}: {
  chatTitles: Map<ChatId, string>;
  entry: TabGroup;
  isUp: boolean;
  onClose?: (group: string) => void;
  onShow?: (group: string, options: { newWindow: boolean }) => void;
  restore?: () => void;
}) {
  const chat = entry.kind === "chat" ? entry.chat : undefined;
  const isUnread = chat?.unread === true;
  const now = useNow();
  const { selectedTabIn } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  // A group whose chat has no words yet is named by the tab it has up.
  const up =
    entry.kind === "draft" && entry.draft.words.trim() === ""
      ? selectedTabIn(entry.group)
      : undefined;
  let title = entry.title;
  if (up?.kind === "page") {
    title = pageTabTitle(up) || title;
  } else if (up !== undefined) {
    title = screenPresentation(up.href, { appsBySlug, chatTitles }).title;
  }
  return (
    <div
      className={cn(
        "group/row flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5",
        isUp
          ? "bg-card shadow-xs ring-1 ring-black/[0.04]"
          : "hover:bg-foreground/[0.04]",
        "data-drop-target:bg-brand-500/10 data-drop-target:ring-2 data-drop-target:ring-brand-500",
        onShow && "cursor-default",
      )}
      {...(restore ? {} : { "data-group-row": entry.group })}
      onClick={(event) => {
        if (!restore) {
          onShow?.(entry.group, { newWindow: event.shiftKey });
        }
      }}
      onContextMenu={(event) => {
        if (!onClose || restore) {
          return;
        }
        event.preventDefault();
        void rowMenu(entry).then((picked) => {
          if (picked === "close") {
            onClose(entry.group);
          } else if (picked === "newWindow") {
            onShow?.(entry.group, { newWindow: true });
          }
        });
      }}
      role={restore ? undefined : "button"}
    >
      <div className="min-w-0 flex-1">
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-5",
              isUnread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/85",
            )}
          >
            {title}
          </span>
          {/* The time steps aside for the close X while the pointer is on the row. */}
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
            resting={
              chat && (
                <span
                  className={cn(
                    "shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums",
                    isUnread && "font-semibold",
                  )}
                  title={formatAbsoluteTime(new Date(chat.lastUserMessageAt))}
                >
                  {activityLabel(new Date(chat.lastUserMessageAt), now)}
                </span>
              )
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
}

async function rowMenu(entry: TabGroup) {
  const items = [
    ...(entry.kind === "chat"
      ? [
          {
            id: entry.chat.starred ? "unpin" : "pin",
            label: entry.chat.starred ? "Unpin" : "Pin",
          },
        ]
      : []),
    { id: "newWindow", label: "Open in New Window" },
    { separator: true as const },
    { id: "close", label: "Close Tab Group" },
  ];
  const picked = await rpcClient.utils.showContextMenu.call({ items });
  if (entry.kind === "chat" && (picked.id === "pin" || picked.id === "unpin")) {
    await rpcClient.workspace.chats.star.call({
      id: entry.chat.id,
      starred: picked.id === "pin",
    });
  }
  return picked.id;
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
      style={{ paddingLeft: `calc(${toggleLeft()} + 2rem)` }}
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
