import { InternalLink } from "@/client/components/internal-link";
import { rpcClient } from "@/client/rpc/client";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { BagIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

export function ProjectChangesNote({
  data,
}: {
  data: SessionMessageDataPart.ProjectChangesDataPart;
}) {
  // Shared cache key with the breadcrumb's query. A projectId can dangle after
  // its project is deleted; when it no longer resolves we drop the jump-back
  // link and show the snapshot name as plain text.
  const { data: project } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({
      input: { id: data.projectId },
    }),
  );

  const changes: string[] = [];
  if (data.instructionsChanged) {
    changes.push(
      data.instructions ? "updated instructions" : "cleared instructions",
    );
  }
  if (data.foldersAdded.length > 0) {
    changes.push(
      `added ${data.foldersAdded.length} folder${data.foldersAdded.length === 1 ? "" : "s"}`,
    );
  }
  if (data.foldersRemoved.length > 0) {
    changes.push(
      `removed ${data.foldersRemoved.length} folder${data.foldersRemoved.length === 1 ? "" : "s"}`,
    );
  }

  if (changes.length === 0) {
    return null;
  }

  const summary = changes.join(", ");

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70">
        <BagIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          {summary.charAt(0).toUpperCase() + summary.slice(1)} from
        </span>
        {project ? (
          <InternalLink
            className="shrink-0 font-medium text-muted-foreground hover:text-foreground hover:underline"
            openInCurrentTab
            params={{ id: data.projectId }}
            to="/projects/$id"
          >
            {project.name}
          </InternalLink>
        ) : (
          <span className="shrink-0 font-medium">{data.projectName}</span>
        )}
      </div>
    </div>
  );
}
