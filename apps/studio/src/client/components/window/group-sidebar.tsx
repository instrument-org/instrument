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
import { useLiveUser } from "@/client/hooks/use-live-user";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { getInitials } from "@/client/lib/get-initials";
import { showProjectInFiles } from "@/client/lib/show-in-files";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { GroupRowMenu, type GroupRowMenuActions } from "./group-row-menu";
import { HelpMenu } from "./help-menu";
import { sidebarTopInset } from "./inbox-toggle";
import { type Project } from "./chats";
import { NotificationsBell } from "./notifications-bell";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { ProjectsSection } from "./projects-section";
import { SidebarSearch, SoftKey } from "./sidebar-search";
import { GroupRowLines } from "./group-row-lines";
import { RowLinesView } from "./row-half";
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
import { windowTabGroupsAtom } from "./open-groups";
import { groupsInProject, isPinnedGroup, type TabGroup } from "./tab-groups";
import { useWindowTabs } from "./window-tabs";
import { TabMenuAtPoint } from "./tab-menu-items";
import { isOnEmptySpace, WindowSpaceMenu } from "./window-space-menu";

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
 * its top (past the traffic lights, the bell; the update pill at its end),
 * the projects, the pinned groups over a plain line, New, the
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

  const { chatUpIn } = useWindowTabs();
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
      onTogglePin: () => {
        onPin(entry.group, !entry.pinned);
      },
    };
  };

  const row = (entry: TabGroup) => (
    <GroupRow
      chatTitles={chatTitles}
      chord={groupNumbers?.get(entry.group)}
      entry={entry}
      isDropInto={drop?.kind === "into" && drop.group === entry.group}
      isUp={entry.group === groupUp}
      key={entry.group}
      menu={menuOf(entry)}
      onClose={onClose}
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
      <SidebarSearch />
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
 * title, then its other tabs' marks, over what the lead tab says, a chat's
 * state among it. The whole row is one press. While the
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
  const { layoutOf } = useWindowTabs();
  const titleOf = useTabTitle(chatTitles);
  const layout = layoutOf(entry.group);
  const sides = layout.sides.flatMap((side) => {
    const up = side.tabs.find((tab) => tab.id === side.up) ?? side.tabs[0];
    return up ? [{ tabs: side.tabs, up }] : [];
  });
  const ups = sides.map((side) => side.up);
  // Named as a group, so a row whose tab is a page the sidebar also has a
  // button for (Activity) is told apart from that button.
  const label = `${ups.length > 0 ? ups.map(titleOf).join(" and ") : entry.title} tab group`;
  const close = onClose && {
    label: "Close Tab Group",
    run: () => {
      onClose(entry.group);
    },
  };
  const [first, ...rest] = sides;
  const inner = first ? (
    <GroupRowLines
      chatTitles={chatTitles}
      close={close}
      isCloseShown={isCloseShown}
      isOnScreen={isUp}
      sides={[first, ...rest]}
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
  return menu ? <GroupRowMenu menu={menu}>{shown}</GroupRowMenu> : shown;
}

/**
 * The sidebar's top row, which drags the window, centered on the tab strips
 * beside it, under the ground above their card: room for the traffic
 * lights on a Mac, then the app's menu off the Mac; the update pill, the
 * mark that Instrument is out of reach while it is, then the bell at its
 * end.
 */
function SidebarTop() {
  return (
    <div
      className="relative flex h-12 shrink-0 items-center gap-1 pt-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
      style={{ paddingLeft: sidebarTopInset() }}
    >
      {!isMacOS() && <AppMenuButton />}
      <span className="flex-1" />
      <UpdateStatusIndicator />
      <NetworkStatusIndicator isIcon />
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

/**
 * The sidebar's foot: the person signed in, or Settings when nobody is,
 * either opening Settings; then History and Help. The space around them
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
      <HistoryButton />
      <HelpMenu chatId={chatId} />
    </div>
  );
}
