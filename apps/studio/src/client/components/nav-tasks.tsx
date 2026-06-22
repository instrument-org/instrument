import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/client/components/ui/sidebar";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { type MakeRouteMatchUnion } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";

import { InternalLink } from "./internal-link";
import { NavTaskItem } from "./nav-task-item";

const FAVORITES_LIMIT = 5;
const TASK_ITEM_HEIGHT = 36;
const TASK_ITEM_GAP = 2;
const TASK_ROW_HEIGHT = TASK_ITEM_HEIGHT + TASK_ITEM_GAP;

export function NavTasks({
  favoriteTaskIds,
  isFavorites,
  matches,
  sortFavoritesBy = "activity",
  tasks,
  title,
}: {
  favoriteTaskIds: Set<string>;
  isFavorites: boolean;
  matches: MakeRouteMatchUnion[];
  sortFavoritesBy?: "activity" | "added";
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

  const { mutate: removeFavorite } = useMutation(
    rpcClient.favorites.remove.mutationOptions(),
  );
  const handleRemoveFavorite = (id: TaskId) => {
    removeFavorite({ id });
  };

  const tasksMatch = matches.find((match) => match.routeId === "/_app/tasks/");

  const isTasksPage = tasksMatch !== undefined;
  const currentFilter = tasksMatch?.search.filter ?? "all";

  const isActive = isTasksPage
    ? isFavorites
      ? currentFilter === "favorites"
      : currentFilter === "all"
    : false;

  const visibleFavorites = isFavorites
    ? sortFavoritesBy === "activity"
      ? tasks.slice(0, FAVORITES_LIMIT)
      : tasks.slice(-FAVORITES_LIMIT)
    : tasks;

  const hasMoreFavorites = isFavorites && tasks.length > FAVORITES_LIMIT;

  const isTaskActive = (id: string) =>
    matches.some(
      (match) => match.routeId === "/_app/tasks/$id/" && match.params.id === id,
    );

  return (
    <SidebarGroup className="px-3 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel
        asChild
        className={cn(
          "font-semibold text-sidebar-foreground/20",
          isActive && "text-sidebar-foreground/60",
        )}
      >
        <InternalLink
          openInCurrentTab
          search={{ filter: isFavorites ? "favorites" : "all" }}
          to="/tasks"
        >
          {title}
        </InternalLink>
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0.5">
        {isFavorites ? (
          <>
            {visibleFavorites.map((task) => (
              <NavTaskItem
                isActive={isTaskActive(task.id)}
                isFavorited={favoriteTaskIds.has(task.id)}
                isFavorites
                key={task.id}
                onOpenInNewTab={handleOpenInNewTab}
                onRemoveFavorite={handleRemoveFavorite}
                task={task}
              />
            ))}
            {hasMoreFavorites && (
              <li className="px-2 pt-1.5 pb-1">
                <InternalLink
                  className="flex items-center gap-0.5 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
                  openInCurrentTab
                  search={{ filter: "favorites" }}
                  to="/tasks"
                >
                  View all favorites
                  <CaretRightIcon className="size-3" />
                </InternalLink>
              </li>
            )}
          </>
        ) : (
          <TasksList
            favoriteTaskIds={favoriteTaskIds}
            matches={matches}
            onOpenInNewTab={handleOpenInNewTab}
            tasks={tasks}
          />
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function TasksList({
  favoriteTaskIds,
  matches,
  onOpenInNewTab,
  tasks,
}: {
  favoriteTaskIds: Set<string>;
  matches: MakeRouteMatchUnion[];
  onOpenInNewTab: (id: TaskId) => void;
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
        isFavorited: favoriteTaskIds.has(task.id),
      })),
    [tasks, matches, favoriteTaskIds],
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
              isFavorited={state.isFavorited}
              isFavorites={false}
              onOpenInNewTab={onOpenInNewTab}
              task={task}
            />
          </div>
        );
      })}
    </div>
  );
}
