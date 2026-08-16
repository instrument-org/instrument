import { featuresAtom } from "@/client/atoms/features";
import { InternalLink } from "@/client/components/internal-link";
import { NavProjects } from "@/client/components/nav-projects";
import { NavSkills } from "@/client/components/nav-skills";
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
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";

export function StudioSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  // The chrome reads the active tab's router from context. Use its live matches
  // rather than re-matching a pathname string, which can throw on a router that
  // was just created for a newly opened tab and hasn't run its first load yet.
  const matches = useRouterState({ select: (s) => s.matches });

  const features = useAtomValue(featuresAtom);

  const { data: projects, isPending: isProjectsPending } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const { data: tasksData, isPending: isTasksPending } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions(),
  );

  // Both read local workspace state and land within a frame or two of each
  // other. Hold the content until both sections can render in their final form.
  const isPending = isProjectsPending || isTasksPending;

  const pinnedTaskIdSet = new Set(
    tasksData?.tasks
      .filter((task) => task.pinnedAt !== undefined)
      .map((task) => task.id),
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
        {!isPending && (
          <>
            {features.skills && <NavSkills matches={matches} />}
            <NavProjects matches={matches} projects={projects} />
            {tasksData?.tasks && tasksData.tasks.length > 0 && (
              <NavTasks
                matches={matches}
                pinnedTaskIds={pinnedTaskIdSet}
                tasks={tasksData.tasks}
                title="Tasks"
              />
            )}
          </>
        )}
      </SidebarContent>
      <NavSupport />
      <SidebarFooter className="border-t border-black/5 p-0 dark:border-white/10">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
