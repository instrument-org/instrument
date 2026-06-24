import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/client/components/ui/sidebar";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { cn } from "@/client/lib/utils";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import { type MakeRouteMatchUnion } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";

import { InternalLink } from "./internal-link";
import { NavTaskItem } from "./nav-task-item";

const TASK_ITEM_HEIGHT = 36;
const TASK_ITEM_GAP = 2;
const TASK_ROW_HEIGHT = TASK_ITEM_HEIGHT + TASK_ITEM_GAP;

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

  // Pinned tasks float to the top of the list while keeping their relative
  // (most-recently-updated-first) order within each group.
  const orderedTasks = useMemo(() => {
    const pinned = tasks.filter((task) => pinnedTaskIds.has(task.id));
    const rest = tasks.filter((task) => !pinnedTaskIds.has(task.id));
    return [...pinned, ...rest];
  }, [tasks, pinnedTaskIds]);

  return (
    <SidebarGroup className="px-3 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel
        asChild
        className={cn(
          "font-semibold text-sidebar-foreground/20",
          isActive && "text-sidebar-foreground/60",
        )}
      >
        <InternalLink openInCurrentTab search={{ filter: "all" }} to="/tasks">
          {title}
        </InternalLink>
      </SidebarGroupLabel>
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scroller = container.closest("[data-sidebar='content']");
    setScrollElement(scroller instanceof HTMLElement ? scroller : null);

    const observer = new ResizeObserver(() => {
      const scrollerRect = scroller?.getBoundingClientRect();
      setScrollMargin(
        container.getBoundingClientRect().top -
          (scrollerRect?.top ?? 0) +
          (scroller?.scrollTop ?? 0),
      );
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tasks.length,
    estimateSize: () => TASK_ROW_HEIGHT,
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
            <NavTaskItem
              isActive={state.isActive}
              isPinned={state.isPinned}
              onOpenInNewTab={onOpenInNewTab}
              task={task}
            />
          </div>
        );
      })}
    </div>
  );
}
