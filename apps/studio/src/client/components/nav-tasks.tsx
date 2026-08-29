import { zoomAtom } from "@/client/atoms/zoom";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/client/components/ui/sidebar";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { cn } from "@/client/lib/utils";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type MakeRouteMatchUnion } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

import { InternalLink } from "./internal-link";
import { NavTaskItem } from "./nav-task-item";

const TASK_ITEM_HEIGHT = 36;
const TASK_ITEM_GAP = 2;
const TASK_ROW_HEIGHT = TASK_ITEM_HEIGHT + TASK_ITEM_GAP;

// How recently a task has to have been made for its row to be treated as
// arriving. Long enough to cover the trip from the write to the live list,
// short enough that the same row scrolled back into view later is just a row
// again: the list is virtualized, so one leaving and re-entering the viewport
// is an ordinary mount and must not read as something new.
const TASK_ARRIVAL_WINDOW_MS = 3000;

export function NavTasks({
  matches,
  pinnedTaskIds,
  tasks,
  title,
}: {
  matches: MakeRouteMatchUnion[];
  pinnedTaskIds: Set<TaskId>;
  tasks: Task[];
  title: string;
}) {
  const { addTab } = useTabActions();

  const handleOpenInNewTab = (id: TaskId) => {
    void addTab({
      params: { id },
      to: "/tasks/$id",
    });
  };

  const tasksMatch = matches.find((match) => match.routeId === "/_app/tasks/");
  const isTasksPage = tasksMatch !== undefined;
  const currentFilter = tasksMatch?.search.filter ?? "all";
  const isActive = isTasksPage && currentFilter === "all";

  // Pinned float to top; order within each group is most-recently-updated.
  const orderedTasks = useMemo(() => {
    const pinned = tasks.filter((task) => pinnedTaskIds.has(task.id));
    const rest = tasks.filter((task) => !pinnedTaskIds.has(task.id));
    return [...pinned, ...rest];
  }, [tasks, pinnedTaskIds]);

  return (
    <SidebarGroup className="px-3 py-2 group-data-[collapsible=icon]:hidden">
      <div className="group/tasks flex h-8 items-center">
        <SidebarGroupLabel
          asChild
          className={cn(
            "h-8 flex-1 font-semibold text-sidebar-foreground/40",
            isActive && "text-sidebar-foreground/60",
          )}
        >
          <InternalLink openInCurrentTab search={{ filter: "all" }} to="/tasks">
            {title}
          </InternalLink>
        </SidebarGroupLabel>
        <InternalLink
          aria-label="New task"
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 opacity-0 group-hover/tasks:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          openInCurrentTab
          to="/new-tab"
        >
          <PlusIcon className="!size-3" />
        </InternalLink>
      </div>
      <SidebarMenu className="gap-0.5">
        <TasksList
          matches={matches}
          onOpenInNewTab={handleOpenInNewTab}
          pinnedTaskIds={pinnedTaskIds}
          tasks={orderedTasks}
        />
      </SidebarMenu>
    </SidebarGroup>
  );
}

function TasksList({
  matches,
  onOpenInNewTab,
  pinnedTaskIds,
  tasks,
}: {
  matches: MakeRouteMatchUnion[];
  onOpenInNewTab: (id: TaskId) => void;
  pinnedTaskIds: Set<TaskId>;
  tasks: Task[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const zoom = useAtomValue(zoomAtom);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scroller = container.closest("[data-sidebar='content']");
    setScrollElement(scroller instanceof HTMLElement ? scroller : null);

    const observer = new ResizeObserver(() => {
      const scrollerRect = scroller?.getBoundingClientRect();
      // The rect delta is on-screen px (scaled by the app zoom); scrollTop is
      // layout px. Divide the delta back to layout px so scrollMargin, which the
      // virtualizer consumes as layout px, stays correct at zoom != 1.
      setScrollMargin(
        (container.getBoundingClientRect().top - (scrollerRect?.top ?? 0)) /
          zoom +
          (scroller?.scrollTop ?? 0),
      );
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [zoom]);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    estimateSize: () => TASK_ROW_HEIGHT,
    // Keyed by task rather than by position, so a task arriving at the top
    // takes a new row instead of pushing every row below it onto a different
    // task. React then keeps each row where it was, and only the new one is
    // new.
    getItemKey: (index) => tasks[index]?.id ?? index,
    getScrollElement: () => scrollElement,
    overscan: 5,
    scrollMargin,
  });

  const taskStates = useMemo(
    () =>
      tasks.map((task) => ({
        id: task.id,
        isActive: matches.some(
          (match) =>
            match.routeId === "/_app/tasks/$id/" && match.params.id === task.id,
        ),
        isPinned: pinnedTaskIds.has(task.id),
      })),
    [tasks, matches, pinnedTaskIds],
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualItems.map((virtualItem) => {
        const task = tasks[virtualItem.index];
        const state = taskStates[virtualItem.index];
        if (!task || !state) {
          return null;
        }
        // A task made while the sidebar is up arrives on its own, from another
        // tab or from the page the user is reading, and the row is the only
        // sign of it. Opacity and transform only, on the one row: nothing here
        // measures or reflows, so a long list stays as cheap to draw as it was.
        const isArriving =
          Date.now() - task.createdAt.getTime() < TASK_ARRIVAL_WINDOW_MS;

        return (
          <div
            key={virtualItem.key}
            style={{
              height: TASK_ITEM_HEIGHT,
              left: 0,
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
              width: "100%",
            }}
          >
            {/* Inside the positioned row rather than on it: the virtualizer
                owns that element's transform. A stylesheet keyframe rather
                than an animated component, so a list this long carries no
                per-row machinery for something that happens to one row of it
                once. */}
            <div
              className={cn(
                isArriving &&
                  "animate-in duration-200 fade-in slide-in-from-left-2",
              )}
            >
              <NavTaskItem
                isActive={state.isActive}
                isPinned={state.isPinned}
                onOpenInNewTab={onOpenInNewTab}
                task={task}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
