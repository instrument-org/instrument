import { InternalLink } from "@/client/components/internal-link";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { BagIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

export function TaskProjectBreadcrumb({ projectId }: { projectId: ProjectId }) {
  const { data: project } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({ input: { id: projectId } }),
  );

  if (!project) {
    return null;
  }

  return (
    <div className="flex min-w-0 shrink items-center gap-x-1 overflow-hidden text-sm text-muted-foreground">
      <InternalLink
        className="flex min-w-0 items-center gap-x-1 truncate hover:text-foreground"
        openInCurrentTab
        params={{ id: projectId }}
        to="/projects/$id"
      >
        <BagIcon className="size-4 shrink-0" />
        <span className="truncate">{project.name}</span>
      </InternalLink>
      <span className="shrink-0 text-muted-foreground/50">/</span>
    </div>
  );
}
