import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { openBuiltInPage } from "@/client/atoms/page-requests";
import { openSettings } from "@/client/atoms/settings-modal";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarProjectAtom,
} from "@/client/atoms/tab-groups";
import { type WindowTab } from "@/client/atoms/window";
import { NetworkStatusIndicator } from "@/client/components/network-status/network-status-pill";
import { HistoryButton } from "@/client/components/activity/history-popover";
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
import { SIDE_MOTION } from "@/client/lib/motion";
import { getInitials } from "@/client/lib/get-initials";
import { showProjectInFiles } from "@/client/lib/show-in-files";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { SCREENS } from "@/shared/instrument-screens";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { FadeTitle } from "./fade-title";
import { GroupRowMenu, type GroupRowMenuActions } from "./group-row-menu";
import { HelpMenu } from "./help-menu";
import { sidebarTopInset } from "./inbox-toggle";
import { useAppsBySlug } from "./apps-by-slug";
import { type Project } from "./chats";
import { ActiveChatsList } from "./active-chats-list";
import { NotificationsBell } from "./notifications-bell";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { ProjectsSection } from "./projects-section";
import { RowHalf, RowLinesView, TabMark } from "./row-half";
import { quiet } from "./row-lines";
import { useTabTitle } from "./tab-title";
import {
  pressGroupRow,
  useSidebarDrag,
  useSidebarTarget,
} from "./drag/use-sidebar-drag";
import { DROP_TONE } from "./drag/tone";
import {
  filledRoomAtom,
  LIST_GAP_PX,
  roomSnapsAtom,
  sidebarDropAtom,
} from "./sidebar-drop";
import { useProjectShift } from "./use-project-shift";
import { useSideMotion } from "./side-motion";
import { windowTabGroupsAtom } from "./open-groups";
import { isPinnedGroup, type TabGroup } from "./tab-groups";
import { chatListOptions } from "./chat-list-query";
import { chatOfTab } from "./tab-model";
import { CHATS_INDEX_HREF } from "./window-href";
import { useWindowTabs } from "./window-tabs";
import { TabMenuAtPoint } from "./tab-menu-items";
import { isOnEmptySpace, WindowSpaceMenu } from "./window-space-menu";

/** A key printed beside the control it works, in a light keycap. */
function SoftKey({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-4.5 shrink-0 items-center rounded-[4px] bg-foreground/[0.04] px-1 font-sans text-[11px] font-medium text-muted-foreground/70 ring-1 ring-foreground/[0.06]">
      {children}
    </span>
  );
}

/** Dragged narrower than this, the sidebar slides shut rather than stopping at its floor. */
const SIDEBAR_COLLAPSE_THRESHOLD = 140;
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
    initial: SIDEBAR_WIDTH_DEFAULT,
    max: Math.min(
      SIDEBAR_WIDTH_MAX,
      Math.max(SIDEBAR_WIDTH_MIN, width - GROUP_WIDTH_MIN),
    ),
    min: SIDEBAR_WIDTH_MIN,
  };
}

/**
 * The sidebar of tab groups down the window's left: the window's own row at
 * its top (past the traffic lights, Activity and the bell; the update pill at its end),
 * the projects, the pinned groups over a plain line, New, the
 * rest under it, newest first, and, in a project, the way into its chats at
 * the list's end; at its foot, the account, Settings and Help. Opening a project takes the list over,
 * under its banner. A row dragged within the list lands where it is let
 * go, pinned above the line or unpinned below it, and one dragged out goes
 * to a window of its own or to another window's list (`pressGroupRow`).
 * A tab or files held over it light the row they would join, or stand as
 * the row they would make in a room between rows (`StandingRow`).
 */
export function GroupSidebar({
  chatTitles,
  groupUp,
  onClose,
  onCloseAll,
  onCloseSide,
  onDuplicate,
  onNew,
  onNewChatProject,
  onNewProject,
  onPin,
  onReopenLast,
  onShow,
  open,
  projects,
}: {
  chatTitles: Map<ChatId, string>;
  /** The group this window shows. */
  groupUp: string | undefined;
  onClose: (group: string) => void;
  /** Closes several groups at once, from the row whose menu asked (`keep`). */
  onCloseAll: (groups: string[], keep: string) => void;
  /** Closes the whole side a tab is up on, from its half of a row of two sides. */
  onCloseSide: (tab: string) => void;
  /** A copy of a group just below it, up in the window. */
  onDuplicate: (entry: TabGroup) => void;
  onNew: (projectId?: string) => void;
  /** Opens the new-project dialog for a chat, from its row in the Chats list. */
  onNewChatProject: (chat: ChatId, name?: string) => void;
  onNewProject: () => void;
  /** Pins a group above the line, or takes it back down. */
  onPin: (group: string, pinned: boolean) => void;
  /** What was closed last back, as Shift+Cmd+T does, from the menu of the list's empty space. */
  onReopenLast: () => void;
  onShow: (group: string, options: { newWindow: boolean }) => void;
  open: TabGroup[];
  projects: Project[];
}) {
  const [projectId, setProjectId] = useAtom(sidebarProjectAtom);
  const [spaceMenu, setSpaceMenu] = useState<{ x: number; y: number }>();
  const project = projects.find((entry) => entry.id === projectId);
  // The list slides in as the sidebar steps into a project or back out of
  // one.
  const shiftRef = useRef<HTMLDivElement>(null);
  useProjectShift(shiftRef, project?.id);
  // The wash keeps the last project's color while it fades out, since the
  // sidebar's own tint goes the moment the list leaves.
  const [lastProject, setLastProject] = useState<Project>();
  if (project && project !== lastProject) {
    setLastProject(project);
  }
  const washProject = project ?? lastProject;

  const { chatUpIn, layoutOf } = useWindowTabs();
  const { data: chatList } = useQuery(chatListOptions());
  // A group is the project's while any chat it has a tab on is filed
  // there, whatever is up in it, or the draft up in it is.
  const inProject = (entry: TabGroup) => {
    if (project === undefined) {
      return true;
    }
    if (entry.kind === "draft" && entry.draft.projectId === project.id) {
      return true;
    }
    const filed = new Set(
      (chatList ?? []).flatMap((chat) =>
        chat.project === project.id ? [chat.id] : [],
      ),
    );
    return layoutOf(entry.group).sides.some((side) =>
      side.tabs.some((tab) => {
        const chat = chatOfTab(tab);
        return chat !== undefined && filed.has(chat);
      }),
    );
  };
  const listed = open.filter(inProject);
  const pinned = listed.filter((entry) => isPinnedGroup(entry));
  const rest = listed.filter((entry) => !isPinnedGroup(entry));
  const chats = open.flatMap((entry) =>
    entry.kind === "chat" ? [entry.chat] : [],
  );
  const arriving = useArrivals(useAtomValue(windowTabGroupsAtom) ?? NO_GROUPS);
  const drop = useAtomValue(sidebarDropAtom);
  const navRef = useRef<HTMLElement>(null);
  useSidebarTarget(() => navRef.current);
  const { lifted, standing: heldTabs } = useSidebarDrag();
  const roomSnaps = useAtomValue(roomSnapsAtom);
  const filled = useAtomValue(filledRoomAtom);
  const room = drop?.kind === "between" ? drop : undefined;
  // The rows the list shows, in its order, which a row's menu closes around.
  const shownRows = [...pinned, ...rest];
  const menuOf = (entry: TabGroup): GroupRowMenuActions => {
    // Pinned rows stay open, as a browser's pinned tabs do.
    const closing = (around: TabGroup[]) => {
      const groups = around.flatMap((each) =>
        isPinnedGroup(each) ? [] : [each.group],
      );
      return groups.length === 0
        ? undefined
        : () => {
            onCloseAll(groups, entry.group);
          };
    };
    const at = shownRows.findIndex((each) => each.group === entry.group);
    return {
      isPinned: entry.pinned,
      onClose: () => {
        onClose(entry.group);
      },
      onCloseAbove: at === -1 ? undefined : closing(shownRows.slice(0, at)),
      onCloseBelow: at === -1 ? undefined : closing(shownRows.slice(at + 1)),
      onCloseOthers: closing(
        shownRows.filter((each) => each.group !== entry.group),
      ),
      onDuplicate: () => {
        onDuplicate(entry);
      },
      onNewWindow: () => {
        onShow(entry.group, { newWindow: true });
      },
      onTogglePin: () => {
        onPin(entry.group, !entry.pinned);
      },
    };
  };

  const row = (entry: TabGroup) => (
    <GroupRow
      chatTitles={chatTitles}
      entry={entry}
      isDropInto={drop?.kind === "into" && drop.group === entry.group}
      isUp={entry.group === groupUp}
      key={entry.group}
      menu={menuOf(entry)}
      onClose={onClose}
      onCloseSide={onCloseSide}
      onPress={pressGroupRow}
      onShow={onShow}
    />
  );

  // What the list shows in order, for the room a drag opens in it: the
  // items from the one it opens in front of on move aside.
  const items = [
    ...pinned.map((entry) => `row:${entry.group}`),
    ...(pinned.length > 0 ? [":divider"] : []),
    ":new",
    ...rest.map((entry) => `row:${entry.group}`),
    ...(project ? [":history"] : []),
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
      isLifted={lifted === entry.group}
      key={`row:${entry.group}`}
      section={section}
      {...place(`row:${entry.group}`)}
    >
      {row(entry)}
    </ListItem>
  );
  const body = (
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
            onNew={() => {
              onNew(project?.id);
            }}
          />
        </ListItem>
        {rest.map((entry) => listItem(entry, "rest"))}
        {project && (
          <ListItem key=":history" {...place(":history")}>
            <AllChatsRow
              icon={<ChatsCircleIcon className="size-4" />}
              label="All chats"
              onOpen={() => {
                openBuiltInPage(
                  `${CHATS_INDEX_HREF}?${new URLSearchParams({ project: project.id }).toString()}`,
                );
              }}
            />
          </ListItem>
        )}
      </AnimatePresence>
      {/* A room at the list's end takes up space for a whole group;
          what a tab stands as there draws over the list's empty space,
          which then stays where it was measured. */}
      {room && room.before === undefined && heldTabs.length === 0 && (
        <div className="shrink-0" style={{ height: room.gap - LIST_GAP_PX }} />
      )}
      {/* The list's empty space under the rows, where a tab held over it
          becomes a group of its own at the list's end. */}
      <div className="min-h-0 flex-1" data-drop-empty="" />
    </>
  );

  return (
    // Its own stacking context, so the project's wash can sit under the rows.
    <nav
      aria-label="Tab groups"
      ref={navRef}
      className={cn(
        "relative isolate flex h-full w-full flex-col",
        project && "project-tint",
      )}
      style={project ? projectTint(projectColor(project)) : undefined}
      onContextMenu={(event) => {
        if (!isOnEmptySpace(event)) {
          return;
        }
        event.preventDefault();
        setSpaceMenu({ x: event.clientX, y: event.clientY });
      }}
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
          <GroupList>
            {body}
            {room && heldTabs.length > 0 && (
              <StandingRow
                chatTitles={chatTitles}
                tabs={heldTabs}
                top={room.top}
              />
            )}
          </GroupList>
        </div>
        {/* The foot, the Chats list over the account, set off from the
            groups by its one line. */}
        <div className="flex shrink-0 flex-col border-t border-border/60">
          <ActiveChatsList
            onNewProject={onNewChatProject}
            projects={projects}
          />
          <SidebarFoot
            chatId={groupUp === undefined ? undefined : chatUpIn(groupUp)}
          />
        </div>
      </div>
      <TabMenuAtPoint
        at={spaceMenu}
        onDismiss={() => {
          setSpaceMenu(undefined);
        }}
      >
        <WindowSpaceMenu
          kind="group"
          onNew={() => {
            onNew(project?.id);
          }}
          onReopenLast={onReopenLast}
        />
      </TabMenuAtPoint>
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
 * as their rows take to arrive: one made, opened from the Chats page or search, or
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
      className={cn("relative shrink-0", isLifted && "hidden")}
      data-drop-group={group}
      data-drop-item={item}
      data-drop-section={section}
      data-leaving={isPresent ? undefined : ""}
      data-lifted={isLifted ? "" : undefined}
      exit={{ height: 0, opacity: 0, overflow: "hidden" }}
      inert={!isPresent}
      // The room opens here, and the row fades in on its own inner box
      // (`chat-arrive`): the two on one box would fight over its opacity,
      // and the row would dip back as the room finished opening.
      initial={
        isArriving ? { height: 0, opacity: 1, overflow: "hidden" } : false
      }
      transition={isReduced || isInstant ? { duration: 0 } : ROW_MOTION}
    >
      <div
        className={cn(
          isArriving && "chat-arrive",
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
      className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2 pl-2"
      data-group-list=""
    >
      {children}
    </div>
  );
}

/**
 * A tab or files held over the sidebar standing in the room the list opens
 * for them, as the row of the group they would make: the first one's title
 * over every one's mark. Drawn over the list on the window's ground, so the
 * rows making room pass under it.
 */
function StandingRow({
  chatTitles,
  tabs,
  top,
}: {
  chatTitles: Map<ChatId, string>;
  tabs: readonly WindowTab[];
  /** Where the room starts, from the list's top in its own px. */
  top: number;
}) {
  const appsBySlug = useAppsBySlug();
  const titleOf = useTabTitle(chatTitles);
  const [first] = tabs;
  if (!first) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-0 left-2 z-10 rounded-lg bg-ground"
      data-standing-row=""
      style={{ top }}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-2.5 py-1.5",
          DROP_TONE,
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex h-5 min-w-0 items-center">
            <FadeTitle className="min-w-0 flex-1 text-[13px] leading-5 font-medium text-foreground/85">
              {titleOf(first)}
            </FadeTitle>
          </div>
          <div className="flex h-5 min-w-0 items-center gap-1 overflow-hidden text-[12px] leading-5 text-muted-foreground">
            {tabs.slice(0, 8).map((tab) => (
              <TabMark
                appsBySlug={appsBySlug}
                chatTitles={chatTitles}
                key={tab.id}
                tab={tab}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** New, under which a tab held over it stands as a group of its own. */
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
 * The row under a project's groups that opens the page of its chats, dimmed
 * so it reads as past the groups rather than one of them.
 */
function AllChatsRow({
  icon,
  label,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      className="mt-1 flex h-8 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground"
      onClick={onOpen}
      type="button"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
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

/**
 * One tab group as two lines, drawing each tab up: a group of one side its
 * tab across the row, a group of two each side's tab in a half of its own,
 * a hairline between them, the half of the side with the keyboard twice as
 * wide as the other so its title reads (`RowHalf`). A tab's
 * mark leads its title, and what it says goes under them, its state among
 * it: a chat's is its own, so a chat in two groups says the same in both.
 * The whole row is one press. While the pointer is on it, an X stands at
 * each half's end, centered on its two lines, which closes that half's whole
 * side, or the group for a row of one side; when that is more than one tab,
 * the first click asks in the half's place and a second there closes
 * (`RowLinesView`). A middle click closes the group. While a tab held over
 * it would land in its group, it takes a quiet fill in place of any other
 * tone. A right click raises its menu (`GroupRowMenu`).
 */
export function GroupRow({
  chatTitles,
  entry,
  isCloseShown = false,
  isDropInto = false,
  isLifted = false,
  isUp,
  menu,
  onClose,
  onCloseSide,
  onPress,
  onShow,
}: {
  chatTitles: Map<ChatId, string>;
  entry: TabGroup;
  /** Its X kept up whatever the pointer does, for a picture of the row under it. */
  isCloseShown?: boolean;
  isDropInto?: boolean;
  /** The copy of a row lifted out of the list, which stands for it under the pointer. */
  isLifted?: boolean;
  isUp: boolean;
  /** What its menu does, for a row of this window's own groups. */
  menu?: GroupRowMenuActions;
  onClose?: (group: string) => void;
  /** Closes the whole side a tab is up on, from its half of a row of two sides. */
  onCloseSide?: (tab: string) => void;
  /** A press that may become a drag of the row. */
  onPress?: (group: string, event: ReactPointerEvent<HTMLElement>) => void;
  onShow?: (group: string, options: { newWindow: boolean }) => void;
}) {
  const { layoutOf } = useWindowTabs();
  const titleOf = useTabTitle(chatTitles);
  const layout = layoutOf(entry.group);
  const ups = layout.sides.flatMap((side) => {
    const up = side.tabs.find((tab) => tab.id === side.up) ?? side.tabs[0];
    return up ? [up] : [];
  });
  // Named as a group, so a row whose tab is a page the sidebar also has a
  // button for (Activity) is told apart from that button.
  const label = `${ups.length > 0 ? ups.map(titleOf).join(" and ") : entry.title} tab group`;
  // What a half's X closes, asking first when that is more than one tab.
  const askOf = (count: number) =>
    count > 1
      ? { full: `Close ${count} tabs?`, short: `Close ${count}?` }
      : undefined;
  const closeOf = (tab: WindowTab, side: number) => {
    if (ups.length > 1) {
      return onCloseSide
        ? {
            ask: askOf(layout.sides[side]?.tabs.length ?? 1),
            label: "Close This Side",
            run: () => {
              onCloseSide(tab.id);
            },
          }
        : undefined;
    }
    return onClose
      ? {
          ask: askOf(layout.sides[0]?.tabs.length ?? 1),
          label: "Close Tab Group",
          run: () => {
            onClose(entry.group);
          },
        }
      : undefined;
  };
  const half = (tab: WindowTab, side: number) => (
    <RowHalf
      chatTitles={chatTitles}
      close={closeOf(tab, side)}
      isCloseShown={isCloseShown}
      isOnScreen={isUp}
      key={tab.id}
      tab={tab}
    />
  );
  // Each half under its side's key (`useSideMotion`), so a half opens and
  // closes with its side in the group and never for a tab brought up.
  const { keys } = useSideMotion(entry.group, layout);
  let inner: ReactNode;
  if (ups.length > 0) {
    inner = (
      <div className="flex min-w-0 items-stretch">
        <AnimatePresence initial={false}>
          {ups.map((tab, index) => (
            <RowHalfPlace isLater={index > 0} key={keys[index] ?? index}>
              {half(tab, index)}
            </RowHalfPlace>
          ))}
        </AnimatePresence>
      </div>
    );
  } else {
    // A group whose tabs are not in yet goes by its own title.
    inner = (
      <RowLinesView
        close={
          onClose && {
            label: "Close Tab Group",
            run: () => {
              onClose(entry.group);
            },
          }
        }
        isCloseShown={isCloseShown}
        lines={quiet(entry.title, "")}
      />
    );
  }
  const shown = (
    <div
      className={cn(
        "group/row flex shrink-0 flex-col rounded-lg px-2.5 py-1.5",
        isDropInto
          ? DROP_TONE
          : isUp
            ? "bg-card shadow-xs ring-1 ring-black/[0.04]"
            : isCloseShown
              ? "bg-foreground/[0.04]"
              : "hover:bg-foreground/[0.04]",
        onShow && "cursor-default",
        onPress && "select-none",
      )}
      {...(isLifted ? {} : { "data-group-row": entry.group })}
      data-drop-into={isDropInto ? "" : undefined}
      data-up={isUp && !isLifted ? "" : undefined}
      onAuxClick={(event) => {
        // A middle click closes the group the way its X does.
        if (event.button === 1 && onClose) {
          event.preventDefault();
          onClose(entry.group);
        }
      }}
      onClick={(event) => {
        onShow?.(entry.group, { newWindow: event.shiftKey });
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
      {...(isLifted ? {} : { "aria-label": label, role: "button" })}
    >
      {inner}
    </div>
  );
  return menu ? <GroupRowMenu menu={menu}>{shown}</GroupRowMenu> : shown;
}

/**
 * A half's place in a row, which opens and closes on the curve its side
 * opens and closes on in the group (`SIDE_MOTION`), the half beside it
 * narrowing or widening with it. A later half leads with the hairline.
 */
function RowHalfPlace({
  children,
  isLater,
}: {
  children: ReactNode;
  isLater: boolean;
}) {
  const isReduced = useReducedMotion() === true;
  return (
    <motion.div
      animate={{ flexGrow: 1, opacity: 1 }}
      className="flex min-w-0 basis-0 overflow-hidden"
      exit={{ flexGrow: 0, opacity: 0 }}
      initial={{ flexGrow: 0, opacity: 0 }}
      transition={isReduced ? { duration: 0 } : SIDE_MOTION}
    >
      {isLater && (
        <span className="mx-2 my-0.5 w-px shrink-0 self-stretch bg-foreground/12" />
      )}
      {children}
    </motion.div>
  );
}

/**
 * The sidebar's top row, which drags the window, centered on the tab strips
 * beside it, under the ground above their card: room for the traffic
 * lights on a Mac, then the app's menu off the Mac; the update pill, the
 * mark that Instrument is out of reach while it is, then History and the
 * bell at its end.
 */
function SidebarTop() {
  return (
    <div
      className="flex h-12 shrink-0 items-center gap-1 pt-2 pr-1 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
      style={{ paddingLeft: sidebarTopInset() }}
    >
      {!isMacOS() && <AppMenuButton />}
      <span className="flex-1" />
      <UpdateStatusIndicator />
      <NetworkStatusIndicator isIcon />
      <HistoryButton
        onShowAll={() => {
          openBuiltInPage(SCREENS.activity.href);
        }}
      />
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

/** The sidebar's foot: the account, which opens Settings; Settings itself; and Help. */
function SidebarFoot({ chatId }: { chatId: ChatId | undefined }) {
  const { data: user } = useLiveUser();
  const { data: workspace } = useQuery(
    rpcClient.workspaces.current.queryOptions(),
  );
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 pr-1 pl-2">
      <button
        className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left hover:bg-foreground/5"
        onClick={() => {
          openSettings();
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
            openSettings();
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
