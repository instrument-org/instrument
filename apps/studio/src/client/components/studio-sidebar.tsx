import { NavPrimary } from "@/client/components/nav-primary";
import { NavProjects } from "@/client/components/nav-projects";
import { NavSupport } from "@/client/components/nav-support";
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
    rpcClient.favorites.live.listProjects.experimental_liveOptions(),
  );

  const { data: projectsData } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions(),
  );

  const favoriteSubdomains = useMemo(
    () => new Set(favorites?.map((r) => r.subdomain) ?? []),
    [favorites],
  );

  const filteredProjects = useMemo(() => {
    if (!projectsData?.projects || !favorites?.length) {
      return projectsData?.projects ?? [];
    }

    return projectsData.projects.filter(
      (project) => !favoriteSubdomains.has(project.subdomain),
    );
  }, [projectsData, favorites, favoriteSubdomains]);

  return (
    <Sidebar collapsible="none" side="left" {...props}>
      <ServerExceptionsAlert />
      <NavPrimary items={primaryNavItems} />
      <SidebarContent>
        {favorites && favorites.length > 0 && (
          <NavProjects
            favoriteSubdomains={favoriteSubdomains}
            isFavorites
            matches={matches}
            projects={favorites}
            title="Favorites"
          />
        )}
        {filteredProjects.length > 0 && (
          <NavProjects
            favoriteSubdomains={favoriteSubdomains}
            isFavorites={false}
            matches={matches}
            projects={filteredProjects}
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
