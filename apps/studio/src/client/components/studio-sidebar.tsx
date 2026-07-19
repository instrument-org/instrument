import { InternalLink } from "@/client/components/internal-link";
import { NavProjects } from "@/client/components/nav-projects";
import { NavSupport } from "@/client/components/nav-support";
import { NavTasks } from "@/client/components/nav-tasks";
import { NavUser } from "@/client/components/nav-user";
import { ServerExceptionsAlert } from "@/client/components/server-exceptions-alert";
import { Button } from "@/client/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/client/components/ui/sidebar";
import { rpcClient } from "@/client/rpc/client";
import { NotePencilIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";

export function StudioSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  // The chrome reads the active tab's router from context. Use its live matches
  // rather than re-matching a pathname string, which can throw on a router that
  // was just created for a newly opened tab and hasn't run its first load yet.
  const matches = useRouterState({ select: (s) => s.matches });

  const { data: pinnedTaskIds } = useQuery(
    rpcClient.workspace.pin.live.listTaskIds.experimental_liveOptions(),
  );

  const { data: tasksData } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions(),
  );

  const pinnedTaskIdSet = useMemo(
    () => new Set(pinnedTaskIds ?? []),
    [pinnedTaskIds],
  );

  return (
    <Sidebar collapsible="none" side="left" {...props}>
      <ServerExceptionsAlert />
      <div className="px-3 pt-3">
        <Button
          asChild
          className="w-full justify-center gap-2 font-medium"
          variant="default"
        >
          <InternalLink openInCurrentTab to="/new-tab">
            <NotePencilIcon className="size-4" weight="bold" />
            New task
          </InternalLink>
        </Button>
      </div>
      <SidebarContent className="gap-0 scroll-fade-y">
        <NavProjects matches={matches} />
        {tasksData?.tasks && tasksData.tasks.length > 0 && (
          <NavTasks
            matches={matches}
            pinnedTaskIds={pinnedTaskIdSet}
            tasks={tasksData.tasks}
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
