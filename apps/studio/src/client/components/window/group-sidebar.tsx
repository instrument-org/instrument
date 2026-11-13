import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import {
  groupSearchAtom,
  SIDEBAR_WIDTH,
  sidebarViewAtom,
} from "@/client/atoms/tab-groups";
import { type WindowTab } from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
import { NetworkStatusIndicator } from "@/client/components/network-status/network-status-pill";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { WorkingDots } from "@/client/components/transcript/task-card";
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
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";

import { HelpMenu } from "./help-menu";
import { useAppsBySlug } from "./apps-by-slug";
import { type Chat, hasWords, type Project } from "./chats";
import { NotificationsBell } from "./notifications-bell";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { ProjectsSection } from "./projects-section";
import { ScreenMark } from "./pane-tabs";
import { SearchField } from "./search-field";
import { type TabGroup } from "./tab-groups";
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

/**
 * The sidebar of tab groups down the window's left: the window's own row at
 * its top (past the traffic lights, the bell; the update pill at its end),
 * the search with History beside it, the projects, the pinned groups over a
 * plain line, the rest, and New after them, and the account, Settings and
 * Help at its foot. Opening a project takes the list over, under its banner.
 */
export function GroupSidebar({
  chatTitles,
  closed,
  groupUp,
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
  /** The groups in History, newest last. */
  closed: TabGroup[];
  /** The group this window shows. */
  groupUp: string | undefined;
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

  const row = (entry: TabGroup, extra?: { restore?: boolean }) => (
    <GroupRow
      chatTitles={chatTitles}
      entry={entry}
      isUp={entry.group === groupUp}
      key={entry.group}
      onClose={onClose}
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
    const fromHistory = matching(closed).toReversed();
    body = (
      <>
        {found.map((entry) => row(entry))}
        {found.length === 0 && fromHistory.length === 0 && (
          <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
            Nothing matches that.
          </p>
        )}
        {fromHistory.length > 0 && (
          <div className="mx-1 mt-2 mb-1 flex items-center gap-2 px-1.5 text-xs font-medium text-muted-foreground">
            <span>From History</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
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
          closed={closed}
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
        {pinned.map((entry) => row(entry))}
        {pinned.length > 0 && rest.length > 0 && (
          <div className="mx-2.5 my-1.5 h-px shrink-0 bg-border" />
        )}
        {rest.map((entry) => row(entry))}
      </>
    );
  }

  const showsNew = !isSearching && view === "list";
  return (
    <nav
      aria-label="Tab groups"
      className="relative flex h-full shrink-0 flex-col"
      style={{
        width: SIDEBAR_WIDTH,
        ...(project ? projectTint(projectColor(project)) : {}),
      }}
    >
      {project && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-linear-to-b from-(--project-tint-surface)/70 to-transparent" />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <SidebarTop />
        {!project && (
          <div className="flex shrink-0 items-center gap-1 px-2">
            <div className="relative flex min-w-0 flex-1">
              <SearchField
                inputRef={searchRef}
                onChange={setSearch}
                placeholder="Search"
                value={search}
              />
              {!isSearching && (
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
                  <SoftKey>
                    {formatAcceleratorText(
                      WINDOW_SHORTCUTS.searchChats.accelerator,
                    )}
                  </SoftKey>
                </span>
              )}
            </div>
            <ToolbarTooltip label="History">
              <button
                aria-label="History"
                aria-pressed={view === "history"}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg",
                  view === "history"
                    ? "bg-foreground/8 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
                onClick={() => {
                  setView(view === "history" ? "list" : "history");
                }}
                type="button"
              >
                <ClockCounterClockwiseIcon className="size-4.5" />
              </button>
            </ToolbarTooltip>
          </div>
        )}
        <ScrollingList
          body={body}
          newRow={
            showsNew ? (
              <NewRow
                onNew={() => {
                  onNew(project?.id);
                }}
              />
            ) : null
          }
        />
        <SidebarFoot chatId={chatOfGroup(groupUp)} />
      </div>
    </nav>
  );
}

/**
 * The list, with New after its last row, or held at the sidebar's foot over
 * a line once the list is long enough to scroll. A tab let go of over the
 * list's empty space becomes a group of its own (`useGroupTabDrag`).
 */
function ScrollingList({
  body,
  newRow,
}: {
  body: ReactNode;
  newRow: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const measure = () => {
      setScrolls(list.scrollHeight > list.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const child of list.children) {
      observer.observe(child);
    }
    return () => {
      observer.disconnect();
    };
  });
  return (
    <>
      <div
        className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 data-drop-target:bg-brand-500/5"
        data-group-list=""
        ref={listRef}
      >
        {body}
        {!scrolls && newRow}
      </div>
      {scrolls && newRow && (
        <div className="shrink-0 px-2 pb-1">
          <div className="mx-0.5 mb-1 h-px bg-border" />
          {newRow}
        </div>
      )}
    </>
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

function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      className="flex h-8 shrink-0 items-center gap-1 self-start rounded-md px-2 text-[13px] font-medium text-foreground/75 hover:bg-foreground/5"
      onClick={onBack}
      type="button"
    >
      <CaretLeftIcon className="size-3.5" />
      {label}
    </button>
  );
}

/** The groups closed to History, newest first, under the day each was last written in. */
function HistoryList({
  closed,
  row,
}: {
  closed: TabGroup[];
  row: (entry: TabGroup) => ReactNode;
}) {
  const newest = closed
    .flatMap((entry) => (entry.kind === "chat" ? [entry] : []))
    .toSorted((a, b) => b.chat.lastUserMessageAt - a.chat.lastUserMessageAt);
  if (newest.length === 0) {
    return (
      <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
        Tab groups you close show up here.
      </p>
    );
  }
  const days = new Map<string, typeof newest>();
  for (const entry of newest) {
    const day = dayLabel(entry.chat.lastUserMessageAt);
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
 * yet seen, then where it stands in words while its chat works or waits, or
 * else the marks of its tabs, or Chat for a group with only its chat.
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
      {...(restore || isUp ? {} : { "data-group-row": entry.group })}
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
        <div
          className={cn(
            "truncate text-[13px] leading-5",
            isUnread
              ? "font-semibold text-foreground"
              : "font-medium text-foreground/85",
          )}
        >
          {entry.title}
        </div>
        <div className="flex h-5 min-w-0 items-center text-[12px] leading-5">
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
          Restore
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

/** The second line of a row: what its chat is doing, or what its tabs are. */
function SecondLine({
  chatTitles,
  entry,
}: {
  chatTitles: Map<ChatId, string>;
  entry: TabGroup;
}) {
  const { allTabs } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const chat: Chat | undefined = entry.kind === "chat" ? entry.chat : undefined;
  if (chat?.status === "working") {
    const step = chat.latest?.kind === "step" ? chat.latest.text : "Working";
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-brand-600 dark:text-brand-400">
        <WorkingDots />
        <span className="truncate">{step}</span>
      </span>
    );
  }
  if (chat?.status === "waiting") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-foreground/80">
        <QuestionIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          {chat.latest?.kind === "question"
            ? chat.latest.text
            : "Waiting for you"}
        </span>
      </span>
    );
  }
  const tabs = allTabs.filter((tab) => tab.group === entry.group);
  if (tabs.length === 0) {
    return (
      <span className="text-muted-foreground">
        {entry.kind === "chat" ? "Chat" : "Nothing open yet"}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden text-muted-foreground">
      {tabs.slice(0, 8).map((tab) => (
        <TabMark
          appsBySlug={appsBySlug}
          chatTitles={chatTitles}
          key={tab.id}
          tab={tab}
        />
      ))}
    </span>
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
 * The sidebar's top row, which drags the window: past the traffic lights on
 * a Mac, or after the app's menu elsewhere, the bell; the update and network
 * pills at its end.
 */
function SidebarTop() {
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-1 pr-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
      style={
        isMacOS()
          ? { paddingLeft: "calc(5rem / var(--app-zoom, 1))" }
          : { paddingLeft: 8 }
      }
    >
      {!isMacOS() && <AppMenuButton />}
      <NotificationsBell />
      <span className="flex-1" />
      <NetworkStatusIndicator />
      <UpdateStatusIndicator />
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
    <div className="flex h-12 shrink-0 items-center gap-1 border-t border-border/60 px-2">
      <button
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left hover:bg-foreground/5"
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
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => {
            openSettings({ tab: "General" });
          }}
          type="button"
        >
          <GearSixIcon className="size-4.5" />
        </button>
      </ToolbarTooltip>
      <HelpMenu chatId={chatId} />
    </div>
  );
}
