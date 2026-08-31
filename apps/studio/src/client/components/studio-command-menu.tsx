import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { Skeleton } from "@/client/components/ui/skeleton";
import { toggleSidebar } from "@/client/hooks/use-sidebar";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { debugPages } from "@/client/routes/_app/debug/-debug-routes";
import { scenarios } from "@/client/routes/_app/debug/-transcript/scenarios";
import { rpcClient } from "@/client/rpc/client";
import {
  type Project,
  type Task,
  type TaskId,
} from "@instrument-org/workspace/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom } from "jotai";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { FuzzyHighlight } from "./fuzzy-highlight";
import { RelativeTime } from "./relative-time";
import { TaskStatusIcon } from "./session-status-icon";
import { UnreadDot } from "./unread-dot";

interface DebugItem {
  key: string;
  label: string;
  search?: { scenario: string };
  to: string;
}

interface MatchedDebugItem {
  item: DebugItem;
  labelRanges: null | number[];
}

interface MatchedProject {
  nameRanges: null | number[];
  project: Project;
}

interface MatchedTask {
  task: Task;
  titleRanges: null | number[];
}

const fuzzy = new uFuzzy({ intraMode: 1 });

type ResultRow =
  | { label: string; type: "header" }
  | { matched: MatchedDebugItem; type: "debug" }
  | { matched: MatchedProject; type: "project" }
  | { matched: MatchedTask; type: "task" };

export function StudioCommandMenu() {
  const [open, setOpen] = useAtom(commandMenuOpenAtom);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { navigateTab } = useTabActions();

  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );

  const { mutate: setDeveloperMode } = useMutation(
    rpcClient.preferences.setDeveloperMode.mutationOptions(),
  );

  const { mutate: setReleaseChannel } = useMutation(
    rpcClient.preferences.setReleaseChannel.mutationOptions(),
  );

  const { mutate: checkForUpdates } = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );
  const { mutate: simulateNoUpdate } = useMutation(
    rpcClient.debug.trigger.testNoUpdateNotification.mutationOptions(),
  );
  const taskRouteMatch = useMatch({
    from: "/_app/tasks/$id/",
    shouldThrow: false,
  });
  const newTabRouteMatch = useMatch({
    from: "/_app/new-tab",
    shouldThrow: false,
  });
  const { data: tasksData, isLoading } = useQuery(
    rpcClient.workspace.task.list.queryOptions({
      enabled: open,
      input: { direction: "desc", sortBy: "updatedAt" },
      placeholderData: (prev) => prev,
    }),
  );

  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const { data: pinnedTaskIds } = useQuery(
    rpcClient.workspace.pin.live.listTaskIds.experimental_liveOptions({
      enabled: open,
    }),
  );

  const pinnedTaskIdSet = useMemo(
    () => new Set(pinnedTaskIds ?? []),
    [pinnedTaskIds],
  );

  const tasks = tasksData?.tasks ?? [];

  const currentTaskId = taskRouteMatch?.params.id;

  const candidateTasks = tasks.filter((task) => task.id !== currentTaskId);

  const matchedTasks = useMemo((): MatchedTask[] => {
    if (!search) {
      // Pinned float to top, the order the sidebar shows. A search is ordered by
      // relevance instead: a pin says the task matters, not that it's the better
      // answer to what was typed.
      const pinned = candidateTasks.filter((task) =>
        pinnedTaskIdSet.has(task.id),
      );
      const rest = candidateTasks.filter(
        (task) => !pinnedTaskIdSet.has(task.id),
      );
      return [...pinned, ...rest].map((task) => ({ task, titleRanges: null }));
    }

    const haystack = candidateTasks.map((p) => p.title);
    // eslint-disable-next-line unicorn/no-array-method-this-argument
    const indexes = fuzzy.filter(haystack, search);

    if (!indexes || indexes.length === 0) {
      return [];
    }

    const info = fuzzy.info(indexes, haystack, search);
    const order = fuzzy.sort(info, haystack, search);

    return order.flatMap((orderIdx) => {
      const task = candidateTasks[info.idx[orderIdx] ?? -1];
      return task ? [{ task, titleRanges: info.ranges[orderIdx] ?? null }] : [];
    });
  }, [candidateTasks, pinnedTaskIdSet, search]);

  // Projects are search-only: the empty state stays a list of recent tasks.
  const matchedProjects = useMemo((): MatchedProject[] => {
    const query = search.trim();
    if (!query || !projects || projects.length === 0) {
      return [];
    }

    // "project" rides along in the haystack so searching the word surfaces
    // every project, but only past a few characters -- a one- or two-letter
    // query would otherwise match the keyword and dump the whole list.
    const joined = projects.map((project) =>
      joinFuzzyFields(
        query.length >= 3 ? [project.name, "project"] : [project.name],
      ),
    );
    const haystack = joined.map((entry) => entry.haystack);
    // eslint-disable-next-line unicorn/no-array-method-this-argument
    const indexes = fuzzy.filter(haystack, query);
    if (!indexes || indexes.length === 0) {
      return [];
    }

    const info = fuzzy.info(indexes, haystack, query);
    const order = fuzzy.sort(info, haystack, query);
    return order.flatMap((orderIdx) => {
      const projectIdx = info.idx[orderIdx] ?? -1;
      const project = projects[projectIdx];
      const fields = joined[projectIdx];
      if (!project || !fields) {
        return [];
      }
      const [nameRanges] = fields.splitRanges(info.ranges[orderIdx] ?? null);
      return [{ nameRanges: nameRanges ?? null, project }];
    });
  }, [projects, search]);

  const isOnNewTabPage = !!newTabRouteMatch;
  const commandSearch = search.trim().toLowerCase();

  // In developer mode every debug page is a flat, top-level entry (transcript
  // scenarios included, deep-linked via the scenario search param). Shown on
  // open and fuzzy-filtered by name as the user types.
  const developerMode = preferences?.developerMode ?? false;
  const matchedDebugItems = useMemo((): MatchedDebugItem[] => {
    if (!developerMode) {
      return [];
    }
    const items: DebugItem[] = [
      ...debugPages.map((page) => ({
        key: page.to,
        label: page.label,
        to: page.to,
      })),
      ...scenarios.map((scenario) => ({
        key: `scenario:${scenario.id}`,
        label: scenario.name,
        search: { scenario: scenario.id },
        to: "/debug/components/transcript",
      })),
    ];

    const query = search.trim();
    if (!query) {
      return items.map((item) => ({ item, labelRanges: null }));
    }

    // Search the label and the route path together (so a path fragment like
    // "browser-views" matches), then map the highlight ranges back to the label
    // since that's all we render. Same pipeline as the model picker.
    const joined = items.map((item) => joinFuzzyFields([item.label, item.to]));
    const haystack = joined.map((entry) => entry.haystack);
    // eslint-disable-next-line unicorn/no-array-method-this-argument
    const indexes = fuzzy.filter(haystack, query);
    if (!indexes || indexes.length === 0) {
      return [];
    }

    const info = fuzzy.info(indexes, haystack, query);
    const order = fuzzy.sort(info, haystack, query);
    return order.flatMap((orderIdx) => {
      const itemIdx = info.idx[orderIdx] ?? -1;
      const item = items[itemIdx];
      const fields = joined[itemIdx];
      if (!item || !fields) {
        return [];
      }
      const [labelRanges] = fields.splitRanges(info.ranges[orderIdx] ?? null);
      return [{ item, labelRanges: labelRanges ?? null }];
    });
  }, [developerMode, search]);

  const showNewTaskCommand =
    !isOnNewTabPage && commandMatches("New task", commandSearch);
  const showCheckForUpdatesCommand = commandMatches(
    "Check for updates",
    commandSearch,
  );
  const showToggleSidebarCommand = commandMatches(
    "Toggle sidebar",
    commandSearch,
  );
  const showCommands =
    showNewTaskCommand ||
    showCheckForUpdatesCommand ||
    showToggleSidebarCommand;

  const handleClose = () => {
    setOpen(false);
    // Delay reset until after the close animation (200ms) to avoid a flicker.
    setTimeout(() => {
      setSearch("");
    }, 200);
  };

  const handleSelectTask = (id: TaskId) => {
    handleClose();
    void navigateTab({
      params: { id },
      to: "/tasks/$id",
    });
  };

  const handleSelectProject = (project: Project) => {
    handleClose();
    void navigateTab({
      params: { id: project.id },
      to: "/projects/$id",
    });
  };

  const handleNewTask = () => {
    handleClose();
    void navigate({ to: "/new-tab" });
  };

  const handleCheckForUpdates = () => {
    handleClose();
    if (import.meta.env.DEV) {
      simulateNoUpdate(undefined);
    } else {
      checkForUpdates({});
    }
  };

  const handleToggleSidebar = () => {
    handleClose();
    toggleSidebar();
  };

  const handleSelectDebugItem = (item: DebugItem) => {
    handleClose();
    // `to` comes from the debug route table as a widened string, so TS can't
    // correlate it with a per-route search schema; assert the navigate input.
    void navigate({ search: item.search, to: item.to } as Parameters<
      typeof navigate
    >[0]);
  };

  return (
    <CommandDialog
      description="Search for a task to open..."
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
        } else {
          handleClose();
        }
      }}
      open={open}
      shouldFilter={false}
      title="Open task"
    >
      <CommandInput
        onValueChange={setSearch}
        placeholder="Search tasks..."
        value={search}
      />
      <CommandList className="max-h-none! min-h-48 overflow-visible!">
        {isLoading && tasks.length === 0 ? (
          <div className="space-y-4 px-2 py-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div className="flex items-center gap-x-3" key={i}>
                <Skeleton className="size-8 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {search &&
              search !== "!dev" &&
              search !== "!beta" &&
              !showCommands &&
              matchedDebugItems.length === 0 &&
              matchedProjects.length === 0 &&
              matchedTasks.length === 0 && (
                <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                  No results found
                </div>
              )}
            {showCommands && (
              <CommandGroup>
                {showNewTaskCommand && (
                  <CommandItem onSelect={handleNewTask} value="new-task">
                    <PlusIcon className="size-4" />
                    <span>New task</span>
                  </CommandItem>
                )}
                {showToggleSidebarCommand && (
                  <CommandItem
                    onSelect={handleToggleSidebar}
                    value="toggle-sidebar"
                  >
                    <SidebarSimpleIcon className="size-4" />
                    <span>Toggle sidebar</span>
                  </CommandItem>
                )}
                {showCheckForUpdatesCommand && (
                  <CommandItem
                    onSelect={handleCheckForUpdates}
                    value="check-for-updates"
                  >
                    <ArrowsClockwiseIcon className="size-4" />
                    <span>Check for updates</span>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            {/* Only renders when "!dev" is typed exactly, so it never appears in the default list. */}
            {search === "!dev" && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    handleClose();
                    const next = !developerMode;
                    setDeveloperMode({ enabled: next });
                    toast(
                      next
                        ? "Developer mode enabled"
                        : "Developer mode disabled",
                    );
                  }}
                  value="toggle-developer-mode"
                >
                  <span>Toggle developer mode</span>
                </CommandItem>
              </CommandGroup>
            )}
            {/* Only renders when "!beta" is typed exactly, so it never appears in the default list. */}
            {search === "!beta" && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    handleClose();
                    const isBeta = preferences?.releaseChannel === "beta";
                    setReleaseChannel({
                      channel: isBeta ? undefined : "beta",
                    });
                    toast(
                      isBeta ? "Beta channel removed" : "Beta channel enabled",
                    );
                  }}
                  value="toggle-beta-channel"
                >
                  <span>Toggle beta channel</span>
                </CommandItem>
              </CommandGroup>
            )}
            {(matchedTasks.length > 0 ||
              matchedProjects.length > 0 ||
              matchedDebugItems.length > 0) && (
              <CommandResultsList
                matchedDebugItems={matchedDebugItems}
                matchedProjects={matchedProjects}
                matchedTasks={matchedTasks}
                onSelectDebugItem={handleSelectDebugItem}
                onSelectProject={handleSelectProject}
                onSelectTask={handleSelectTask}
                pinnedTaskIds={pinnedTaskIdSet}
              />
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function commandMatches(label: string, search: string) {
  return search === "" || label.toLowerCase().includes(search);
}

// Tasks, projects, and debug pages share one virtualized, single-scroll region
// so the dialog stays a normal height instead of stacking scroll areas.
function CommandResultsList({
  matchedDebugItems,
  matchedProjects,
  matchedTasks,
  onSelectDebugItem,
  onSelectProject,
  onSelectTask,
  pinnedTaskIds,
}: {
  matchedDebugItems: MatchedDebugItem[];
  matchedProjects: MatchedProject[];
  matchedTasks: MatchedTask[];
  onSelectDebugItem: (item: DebugItem) => void;
  onSelectProject: (project: Project) => void;
  onSelectTask: (id: TaskId) => void;
  pinnedTaskIds: Set<TaskId>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<ResultRow[]>(() => {
    const flat: ResultRow[] = [];
    if (matchedTasks.length > 0) {
      flat.push({ label: "Tasks", type: "header" });
      for (const matched of matchedTasks) {
        flat.push({ matched, type: "task" });
      }
    }
    if (matchedProjects.length > 0) {
      flat.push({ label: "Projects", type: "header" });
      for (const matched of matchedProjects) {
        flat.push({ matched, type: "project" });
      }
    }
    if (matchedDebugItems.length > 0) {
      flat.push({ label: "Debug pages", type: "header" });
      for (const matched of matchedDebugItems) {
        flat.push({ matched, type: "debug" });
      }
    }
    return flat;
  }, [matchedTasks, matchedProjects, matchedDebugItems]);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.type === "header" ? 28 : 36),
    getScrollElement: () => parentRef.current,
    // `offsetHeight`, not `getBoundingClientRect()`: the menu sits inside CSS
    // `zoom`, where the rect is the on-screen height while the row offsets and
    // spacer height this feeds are layout px. Measuring the rect reports every
    // row as `zoom x` its own height, spacing the list out with gaps and
    // stretching the scroll range to match.
    measureElement: (el) => el.offsetHeight,
    overscan: 8,
  });

  return (
    <div
      className="overflow-y-auto p-1"
      ref={parentRef}
      style={{ maxHeight: "320px" }}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) {
            return null;
          }

          return (
            <div
              className="absolute top-0 left-0 w-full"
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              {row.type === "header" ? (
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {row.label}
                </div>
              ) : row.type === "task" ? (
                <CommandItem
                  onSelect={() => {
                    onSelectTask(row.matched.task.id);
                  }}
                  value={row.matched.task.id}
                >
                  {pinnedTaskIds.has(row.matched.task.id) ? (
                    <PushPinIcon className="size-4 shrink-0 opacity-50" />
                  ) : (
                    <ChatCircleIcon className="size-4 shrink-0 opacity-50" />
                  )}
                  <span className="flex-1 truncate text-sm">
                    <FuzzyHighlight
                      ranges={row.matched.titleRanges}
                      text={row.matched.task.title}
                    />
                  </span>
                  {/* Same precedence as the sidebar row: a task the user hasn't
                      read reads as unread even once its run is over. */}
                  {row.matched.task.unreadIndicator ? (
                    <UnreadDot />
                  ) : (
                    <TaskStatusIcon
                      className="size-4 shrink-0"
                      id={row.matched.task.id}
                    />
                  )}
                  <RelativeTime
                    className="text-xs text-muted-foreground/60"
                    compact
                    date={new Date(row.matched.task.updatedAt)}
                    tooltip={false}
                  />
                </CommandItem>
              ) : row.type === "project" ? (
                <CommandItem
                  onSelect={() => {
                    onSelectProject(row.matched.project);
                  }}
                  value={`project:${row.matched.project.id}`}
                >
                  <CardsThreeIcon className="size-4 shrink-0 opacity-50" />
                  <span className="flex-1 truncate text-sm">
                    <FuzzyHighlight
                      ranges={row.matched.nameRanges}
                      text={row.matched.project.name}
                    />
                  </span>
                </CommandItem>
              ) : (
                <CommandItem
                  onSelect={() => {
                    onSelectDebugItem(row.matched.item);
                  }}
                  value={`debug:${row.matched.item.key}`}
                >
                  <CodeIcon className="size-4 shrink-0 opacity-50" />
                  <span className="flex-1 truncate text-sm">
                    <FuzzyHighlight
                      ranges={row.matched.labelRanges}
                      text={row.matched.item.label}
                    />
                  </span>
                </CommandItem>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
