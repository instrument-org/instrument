import { InternalLink } from "@/client/components/internal-link";
import { TaskStatusIcon } from "@/client/components/session-status-icon";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { createIconMeta } from "@/shared/tabs";
import { ProjectIdSchema } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

/* eslint-disable perfectionist/sort-objects */
export const Route = createFileRoute("/_app/projects/$id/")({
  params: {
    parse: (rawParams) => ({ id: ProjectIdSchema.parse(rawParams.id) }),
  },
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Project" }, createIconMeta("table-properties")],
  }),
});
/* eslint-enable perfectionist/sort-objects */

function RouteComponent() {
  const { id } = Route.useParams();

  const { data: project, isLoading } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({ input: { id } }),
  );

  const { data: tasksData } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions({
      input: { direction: "desc", sortBy: "updatedAt" },
    }),
  );

  const memberTasks = useMemo(
    () => (tasksData?.tasks ?? []).filter((task) => task.projectId === id),
    [tasksData?.tasks, id],
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex flex-col gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>
        <Button asChild size="sm">
          <InternalLink to="/new-tab">New task</InternalLink>
        </Button>
      </div>

      <div className="mt-8 flex flex-col gap-y-1">
        {memberTasks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No tasks in this project yet.
          </p>
        ) : (
          memberTasks.map((task) => (
            <InternalLink
              className="flex items-center gap-x-2 rounded-md px-3 py-2 hover:bg-muted"
              key={task.id}
              openInCurrentTab
              params={{ id: task.id }}
              to="/tasks/$id"
            >
              <span className="truncate font-medium">{task.title}</span>
              <TaskStatusIcon
                className="ml-auto size-4 shrink-0"
                id={task.id}
              />
            </InternalLink>
          ))
        )}
      </div>
    </div>
  );
}
