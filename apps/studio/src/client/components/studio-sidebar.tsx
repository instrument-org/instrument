import { NavPrimary } from "@/client/components/nav-primary";
import { NavSupport } from "@/client/components/nav-support";
import { NavTasks } from "@/client/components/nav-tasks";
import { NavUser } from "@/client/components/nav-user";
import { ServerExceptionsAlert } from "@/client/components/server-exceptions-alert";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/client/components/ui/sidebar";
import { useSelectedTab } from "@/client/hooks/use-selected-tab";
import { useMatchesForPathname } from "@/client/lib/get-route-matches";
import { rpcClient } from "@/client/rpc/client";
import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export function StudioSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const selectedTab = useSelectedTab();

  const matches = useMatchesForPathname(selectedTab?.pathname ?? "");

  const primaryNavItems = useMemo(
    () => [
      {
        icon: PlusIcon,
        isActive: matches.some((match) => match.routeId === "/_app/new-tab"),
        isBrand: true,
        title: "New",
        url: "/new-tab" as const,
      },
    ],
    [matches],
  );

  const { data: favorites } = useQuery(
    rpcClient.favorites.live.listTasks.experimental_liveOptions(),
  );

  const { data: tasksData } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions(),
  );

  const favoriteTaskIds = useMemo(
    () => new Set(favorites?.map((r) => r.id) ?? []),
    [favorites],
  );

  const filteredTasks = useMemo(() => {
    if (!tasksData?.tasks || !favorites?.length) {
      return tasksData?.tasks ?? [];
    }

    return tasksData.tasks.filter((task) => !favoriteTaskIds.has(task.id));
  }, [tasksData, favorites, favoriteTaskIds]);

  return (
    <Sidebar collapsible="none" side="left" {...props}>
      <ServerExceptionsAlert />
      <NavPrimary items={primaryNavItems} />
      <SidebarContent>
        {favorites && favorites.length > 0 && (
          <NavTasks
            favoriteTaskIds={favoriteTaskIds}
            isFavorites
            matches={matches}
            tasks={favorites}
            title="Favorites"
          />
        )}
        {filteredTasks.length > 0 && (
          <NavTasks
            favoriteTaskIds={favoriteTaskIds}
            isFavorites={false}
            matches={matches}
            tasks={filteredTasks}
            title="Tasks"
          />
        )}
      </SidebarContent>
      <NavSupport />
      <SidebarFooter className="border-t border-black/5 p-0 dark:border-white/10">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
