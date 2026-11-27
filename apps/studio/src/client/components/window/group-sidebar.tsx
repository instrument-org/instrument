import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarProjectAtom,
} from "@/client/atoms/tab-groups";
import { NetworkStatusIndicator } from "@/client/components/network-status/network-status-pill";
import { type RailBounds } from "@/client/components/studio-sidebar-rail";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { UpdateStatusIndicator } from "@/client/components/update-status-indicator";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { Input } from "@/client/components/ui/input";
import { plainGroupName } from "@instrument-org/shared";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { getInitials } from "@/client/lib/get-initials";
import { showProjectInFiles } from "@/client/lib/show-in-files";
import { cn, isMacOS } from "@/client/lib/utils";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChordHint } from "./chord-hint";
import { HistoryButton } from "./recently-closed-menu";
import {
  groupChordLabel,
  groupChordNumbers,
  heldHintAtom,
  sidebarRowOrderAtom,
} from "./held-chord-hints";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";

import { GroupRowMenu, type GroupRowMenuActions } from "./group-row-menu";
import { HelpMenu } from "./help-menu";
import { sidebarTopInset } from "./inbox-toggle";
import { type Project } from "./chats";
import { NotificationsBell } from "./notifications-bell";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { ProjectsSection } from "./projects-section";
import { SoftKey } from "@/client/components/soft-key";
import { SidebarSearch } from "./sidebar-search";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { HoverPicture } from "./hover-picture";
import { useGroupPicture } from "./hover-pictures";
import { groupTitleOf, leadTabOf, rowSidesOf } from "./group-leads";
import { stopHere } from "./row-shell";
import { chatOfTab } from "./tab-model";
import { GroupRowLines } from "./group-row-lines";
import { RowLinesView } from "./row-half";
import { quiet } from "./row-lines";
import { useTabNames } from "./tab-title";
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
import { windowTabGroupsAtom } from "./open-groups";
import { groupsInProject, isPinnedGroup, type TabGroup } from "./tab-groups";
import {
  useGroupLayout,
  useGroupLead,
  useGroupName,
  useWindowTabs,
} from "./window-tabs";
import { TabMenuAtPoint } from "./tab-menu-items";
import { isOnEmptySpace, WindowSpaceMenu } from "./window-space-menu";

/** Dragged narrower than this, the sidebar slides shut rather than stopping at its floor. */
const SIDEBAR_COLLAPSE_THRESHOLD = 140;
/** The least the group beside the sidebar or the side panel keeps while either is dragged wider. */
export const GROUP_WIDTH_MIN = 560;

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
 * its top (past the traffic lights, the bell; the update pill at its end),
 * the projects, the pinned groups, a plain line, New, the
 * rest under it, newest first; at its foot, the account, History and Help. Opening a project takes the list over,
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
  onDuplicate,
  onNew,
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
  /** A copy of a group just below it, up in the window. */
  onDuplicate: (entry: TabGroup) => void;
  onNew: () => void;
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

  const { chatUpIn, setGroupOwn } = useWindowTabs();
  const listed = groupsInProject(open, project?.id, projects);
  const pinned = listed.filter((entry) => isPinnedGroup(entry));
  const rest = listed.filter((entry) => !isPinnedGroup(entry));
  const chats = open.flatMap((entry) =>
    entry.kind === "chat" ? [entry.chat] : [],
  );
  const arriving = useArrivals(useAtomValue(windowTabGroupsAtom) ?? NO_GROUPS);
  const drop = useAtomValue(sidebarDropAtom);
  const navRef = useRef<HTMLElement>(null);
  useSidebarTarget(() => navRef.current);
  const { lifted } = useSidebarDrag();
  const roomSnaps = useAtomValue(roomSnapsAtom);
  const filled = useAtomValue(filledRoomAtom);
  const room = drop?.kind === "between" ? drop : undefined;
  // The rows the list shows, in its order, which a row's menu closes around
  // and the group chords pick by place.
  const shownRows = [...pinned, ...rest];
  const shownOrder = shownRows.map((entry) => entry.group);
  const shownKey = shownOrder.join("\n");
  const setRowOrder = useSetAtom(sidebarRowOrderAtom);
  useEffect(() => {
    setRowOrder(shownKey === "" ? [] : shownKey.split("\n"));
    return () => {
      setRowOrder(undefined);
    };
  }, [setRowOrder, shownKey]);
  const groupNumbers =
    useAtomValue(heldHintAtom) === "groups"
      ? groupChordNumbers(shownOrder)
      : undefined;
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
      onName: (name) => {
        setGroupOwn(entry.group, { name });
      },
      onTogglePin: () => {
        onPin(entry.group, !entry.pinned);
      },
    };
  };

  // A row's menu acts through this, so a row that kept an earlier menu
  // (`SidebarRow`) acts on the rows as they are when one is picked.
  const latest = useSteadyCallbacks({
    menuFor: (group: string) => {
      const entry = shownRows.find((each) => each.group === group);
      return entry === undefined ? undefined : menuOf(entry);
    },
  });

  // What the list shows in order, for the room a drag opens in it: the
  // items from the one it opens in front of on move aside.
  // The line sets the projects and the pinned rows apart from New, so the
  // main list always draws it; one project's list, only under pinned rows.
  const hasDivider = !project || pinned.length > 0;
  const items = [
    ...pinned.map((entry) => `row:${entry.group}`),
    ...(hasDivider ? [":divider"] : []),
    ":new",
    ...rest.map((entry) => `row:${entry.group}`),
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
    <SidebarRow
      chatTitles={chatTitles}
      chord={groupNumbers?.get(entry.group)}
      entry={entry}
      isArriving={arriving.has(entry.group) && entry.group !== filled}
      isDropInto={drop?.kind === "into" && drop.group === entry.group}
      isLifted={lifted === entry.group}
      isUp={entry.group === groupUp}
      key={`row:${entry.group}`}
      menu={menuOf(entry)}
      menuFor={latest.menuFor}
      onClose={onClose}
      onShow={onShow}
      section={section}
      {...place(`row:${entry.group}`)}
    />
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
        {hasDivider && (
          <ListItem isInstant key=":divider" {...place(":divider")}>
            <div className="mx-2.5 my-1.5 h-px bg-border" />
          </ListItem>
        )}
        <ListItem key=":new" {...place(":new")}>
          <NewRow onNew={onNew} />
        </ListItem>
        {rest.map((entry) => listItem(entry, "rest"))}
      </AnimatePresence>
      {/* A room at the list's end takes up space for a whole group. */}
      {room && room.before === undefined && room.gap > 0 && (
        <div className="shrink-0" style={{ height: room.gap - LIST_GAP_PX }} />
      )}
      {/* The list's empty space under the rows, where a tab held over it
          becomes a group of its own at the list's end, and which moves the
          window like the top row, being the window's own ground. From a
          press until a drag lets go it is the page's alone, so nothing
          carried onto it can be taken for moving the window. */}
      <div
        className="min-h-0 flex-1 [-webkit-app-region:drag] in-data-pressing:[-webkit-app-region:no-drag] in-data-tab-held:[-webkit-app-region:no-drag]"
        data-drop-empty=""
      />
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
          {/* Search stays put while the list under it scrolls. */}
          <div className="shrink-0 pr-1 pl-2">
            <SidebarSearch />
          </div>
          <GroupList>
            {body}
            {room?.gap === 0 && <ListDropLine top={room.top} />}
          </GroupList>
        </div>
        {/* The foot, the account, set off from the groups by its one line. */}
        <div className="flex shrink-0 flex-col border-t border-border/60">
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
          onNew={onNew}
          onReopenLast={onReopenLast}
        />
      </TabMenuAtPoint>
    </nav>
  );
}

/** The list of a window that has none yet, one array for every render. */
const NO_GROUPS: readonly string[] = [];

/** Whether two entries for a group say the same, field by field. */
function isSameEntry(a: TabGroup, b: TabGroup): boolean {
  const was: Record<string, unknown> = a;
  const now: Record<string, unknown> = b;
  const keys = Object.keys(was);
  return (
    keys.length === Object.keys(now).length &&
    keys.every((key) => key in now && was[key] === now[key])
  );
}

/** A group's menu offering what `menu` offers, whose actions run the latest menu for the group. */
function steadyMenu(
  group: string,
  menu: GroupRowMenuActions,
  latest: (group: string) => GroupRowMenuActions | undefined,
): GroupRowMenuActions {
  const closer = (
    pick: (now: GroupRowMenuActions) => (() => void) | undefined,
  ) =>
    pick(menu) === undefined
      ? undefined
      : () => {
          const now = latest(group);
          if (now) {
            pick(now)?.();
          }
        };
  return {
    isPinned: menu.isPinned,
    onClose: () => latest(group)?.onClose(),
    onCloseAbove: closer((now) => now.onCloseAbove),
    onCloseBelow: closer((now) => now.onCloseBelow),
    onCloseOthers: closer((now) => now.onCloseOthers),
    onDuplicate: () => latest(group)?.onDuplicate(),
    onNewWindow: () => latest(group)?.onNewWindow(),
    onName: (name) => latest(group)?.onName(name),
    onTogglePin: () => latest(group)?.onTogglePin(),
  };
}

/** What a group's menu offers, which a row is drawn again for. */
function offersOf(menu: GroupRowMenuActions): string {
  return [
    menu.isPinned,
    menu.onCloseAbove !== undefined,
    menu.onCloseBelow !== undefined,
    menu.onCloseOthers !== undefined,
  ].join();
}

/**
 * Whether a row would draw the same: its entry the same field by field,
 * its menu offering the same, and the rest the same values.
 */
function isSameRow(a: SidebarRowProps, b: SidebarRowProps): boolean {
  const was: Record<string, unknown> = a;
  const now: Record<string, unknown> = b;
  const keys = Object.keys(was);
  return (
    keys.length === Object.keys(now).length &&
    keys.every((key) =>
      key === "entry"
        ? isSameEntry(a.entry, b.entry)
        : key === "menu"
          ? offersOf(a.menu) === offersOf(b.menu)
          : key in now && Object.is(was[key], now[key]),
    )
  );
}

type SidebarRowProps = Parameters<typeof SidebarRowView>[0];

/**
 * One group's row in its place in the list. Kept by hand (`memo`, by
 * `isSameRow`): the list draws its rows in a loop the React Compiler keeps
 * nothing of, and draws them all again on every change to the window's
 * tabs, which with dozens of groups is most of what a new tab or a tab
 * switch costs. A row kept with an earlier menu acts through `menuFor`.
 */
const SidebarRow = memo(SidebarRowView, isSameRow);

function SidebarRowView({
  chatTitles,
  chord,
  entry,
  isArriving,
  isDropInto,
  isLifted,
  isUp,
  item,
  menu,
  menuFor,
  onClose,
  onShow,
  section,
  shift,
  snaps,
}: {
  chatTitles: Map<ChatId, string>;
  chord: number | undefined;
  entry: TabGroup;
  isArriving: boolean;
  isDropInto: boolean;
  isLifted: boolean;
  isUp: boolean;
  item: string;
  menu: GroupRowMenuActions;
  /** The menu the list would make for a group now. */
  menuFor: (group: string) => GroupRowMenuActions | undefined;
  onClose: (group: string) => void;
  onShow: (group: string, options: { newWindow: boolean }) => void;
  section: "pinned" | "rest";
  shift?: number;
  snaps: boolean;
}) {
  return (
    <ListItem
      group={entry.group}
      isArriving={isArriving}
      isLifted={isLifted}
      item={item}
      section={section}
      {...(shift === undefined ? {} : { shift })}
      snaps={snaps}
    >
      <GroupRow
        chatTitles={chatTitles}
        chord={chord}
        entry={entry}
        isDropInto={isDropInto}
        isUp={isUp}
        menu={steadyMenu(entry.group, menu, menuFor)}
        onClose={onClose}
        onPress={pressGroupRow}
        onShow={onShow}
      />
    </ListItem>
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
 * The list under search, which scrolls whole, projects and New with it,
 * fading out at an end with more past it, and where a drag over it shows
 * where it lands (`sidebarDropAt`) and a lifted row stands.
 */
function GroupList({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scroll-fade-y pr-1 pb-2 pl-2"
      data-group-list=""
    >
      {children}
    </div>
  );
}

/**
 * The line between two rows where a tab, files or a link held over the
 * list would become a group of their own, the rows staying put, gliding
 * from gap to gap in 90ms as the bookmarks bar's line does across the bar.
 */
function ListDropLine({
  top,
}: {
  /** Its middle, from the list's top in its own px. */
  top: number;
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1 left-3 z-10 h-0.5 -translate-y-1/2 rounded-full bg-primary transition-[top] duration-90 ease-out motion-reduce:transition-none"
      data-list-drop-line=""
      style={{ top }}
    />
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
 * One tab group as two lines (`GroupRowLines`): its lead tab's mark and
 * title over what the lead tab says, a chat's state among it, then its other
 * tabs' marks. The whole row is one press. While the
 * pointer is on it, one X at its end closes the whole group, as a middle
 * click does, with nothing asked: Reopen brings it back. While a tab held
 * over it would land in its group, it is raised and ringed in place of any
 * other tone. A right click raises its menu (`GroupRowMenu`).
 */
export function GroupRow({
  chatTitles,
  chord,
  entry,
  isCloseShown = false,
  isDropInto = false,
  isLifted = false,
  isUp,
  menu,
  onClose,
  onPress,
  onShow,
}: {
  chatTitles: Map<ChatId, string>;
  /** The group chord's number that picks it, shown at its end while that modifier is held. */
  chord?: number | undefined;
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
  /** A press that may become a drag of the row. */
  onPress?: (group: string, event: ReactPointerEvent<HTMLElement>) => void;
  onShow?: (group: string, options: { newWindow: boolean }) => void;
}) {
  const names = useTabNames(chatTitles);
  const held = useGroupLead(entry.group);
  const name = useGroupName(entry.group);
  const naming = useInlineRename({
    allowsBlank: true,
    onSave: (next) => {
      menu?.onName(plainGroupName(next));
      return Promise.resolve();
    },
    value: name ?? "",
  });
  const layout = useGroupLayout(entry.group);
  const sides = rowSidesOf(layout);
  // Named as a group, by the title its row shows, so a row whose tab is a
  // page the sidebar also has a button for (Activity) is told apart from
  // that button.
  const label = `${groupTitleOf(layout, held, names) ?? entry.title} tab group`;
  const close = onClose && {
    label: "Close Tab Group",
    run: () => {
      onClose(entry.group);
    },
  };
  const inner = sides ? (
    <GroupRowLines
      chatTitles={chatTitles}
      close={close}
      held={held}
      isCloseShown={isCloseShown}
      isOnScreen={isUp}
      name={name}
      nameField={
        naming.isEditing ? (
          // Clicks, presses and keys in the field are the field's, not the row's.
          <span
            className="-my-0.5 flex min-w-0 flex-1"
            onAuxClick={stopHere}
            onClick={stopHere}
            onKeyDown={stopHere}
            onMouseDown={stopHere}
            onPointerDown={stopHere}
          >
            <Input
              aria-label="Tab group name"
              className="h-6 px-1.5 text-[12px] focus-visible:-outline-offset-3"
              placeholder="Name"
              {...naming.inputProps}
            />
          </span>
        ) : undefined
      }
      sides={sides}
    />
  ) : (
    // A group whose tabs are not in yet goes by its own title.
    <RowLinesView
      close={close}
      isCloseShown={isCloseShown}
      lines={quiet(entry.title, "")}
    />
  );
  const shown = (
    <div
      className={cn(
        "group/row relative flex shrink-0 flex-col rounded-lg px-2.5 py-1.5",
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
      {chord !== undefined && (
        <ChordHint className="absolute top-1/2 right-2 -translate-y-1/2">
          {groupChordLabel(chord)}
        </ChordHint>
      )}
    </div>
  );
  if (!menu) {
    return shown;
  }
  return (
    <GroupRowPicture
      group={entry.group}
      isUp={isUp}
      label={label}
      wrap={(trigger) => (
        <GroupRowMenu
          menu={menu}
          naming={
            sides && chatOfTab(leadTabOf(sides, held)) === undefined
              ? { hasName: name !== undefined, start: naming.start }
              : undefined
          }
        >
          {trigger}
        </GroupRowMenu>
      )}
    >
      {shown}
    </GroupRowPicture>
  );
}

/** How long the pointer rests on a row before the first picture; the rows after it show theirs at once. */
const PICTURE_DELAY_MS = 450;

/**
 * A row with a picture beside it on hover: the whole of what picking it
 * would put up, as it last stood. Nothing for the group already up, or one
 * there is no picture of. It takes no pointer, and it goes as the pointer
 * leaves the row or presses.
 */
function GroupRowPicture({
  children,
  group,
  isUp,
  label,
  wrap,
}: {
  children: ReactNode;
  group: string;
  isUp: boolean;
  label: string;
  wrap: (trigger: ReactNode) => ReactNode;
}) {
  const groupPicture = useGroupPicture(group);
  const picture = isUp ? undefined : groupPicture;
  return (
    <Tooltip delayDuration={PICTURE_DELAY_MS} disableHoverableContent>
      {wrap(
        <TooltipTrigger
          asChild
          // A held pointer is carrying a row, or reordering them.
          onPointerMove={(event) => {
            if (event.buttons !== 0) {
              event.preventDefault();
            }
          }}
        >
          {children}
        </TooltipTrigger>,
      )}
      {picture !== undefined && (
        <TooltipContent
          align="start"
          aria-label={label}
          className="pointer-events-none w-80 overflow-hidden rounded-xl border p-0 shadow-float-lg"
          collisionPadding={8}
          side="right"
        >
          <HoverPicture url={picture} />
        </TooltipContent>
      )}
    </Tooltip>
  );
}

/**
 * The sidebar's top row, which drags the window, centered on a Mac on the tab
 * strips beside it, and elsewhere on the ground above their card: room for
 * the window's corner, then, against the sidebar's right edge, whatever stays
 * until it is dealt with, the connection first and then the update, and empty
 * ground otherwise.
 */
function SidebarTop() {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-end gap-1 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
        isMacOS() ? "h-12 pt-2" : "h-8",
      )}
      style={{ paddingLeft: sidebarTopInset() }}
    >
      <NetworkStatusIndicator isSlim />
      <UpdateStatusIndicator />
    </div>
  );
}

/**
 * The sidebar's foot: the person signed in, or Settings when nobody is,
 * either opening Settings; then the bell, History and Help. The space around them
 * moves the window, as the top row's does.
 */
function SidebarFoot({ chatId }: { chatId: ChatId | undefined }) {
  const { data: user, isPending } = useLiveUser();
  return (
    <div className="relative flex h-11 shrink-0 items-center gap-1 pl-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
      <button
        className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left hover:bg-foreground/5"
        onClick={() => {
          openSettings();
        }}
        type="button"
      >
        {user ? (
          <>
            <Avatar className="size-6 rounded-md">
              <AvatarImage alt="" src={user.image ?? undefined} />
              <AvatarFallback className="rounded-md text-[10px]">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 truncate text-[13px] font-medium">
              {user.name}
            </span>
          </>
        ) : (
          !isPending && (
            <>
              <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">
                <GearSixIcon className="size-4" />
              </span>
              <span className="min-w-0 truncate text-[13px] font-medium">
                Settings
              </span>
            </>
          )
        )}
      </button>
      <NotificationsBell />
      <HistoryButton />
      <HelpMenu chatId={chatId} />
    </div>
  );
}
