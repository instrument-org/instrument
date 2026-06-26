import { InternalLink } from "@/client/components/internal-link";
import { rpcClient } from "@/client/rpc/client";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { BagIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

export function ProjectContextNote({
  data,
  folders,
}: {
  data: SessionMessageDataPart.ProjectContextDataPart;
  folders: SessionMessageDataPart.FolderAttachmentDataPart[];
}) {
  // Shared cache key with the breadcrumb's query. A projectId can dangle after
  // its project is deleted; when it no longer resolves we drop the jump-back
  // link and show the snapshot name as plain text.
  const { data: project } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({
      input: { id: data.projectId },
    }),
  );

  const added: string[] = [];
  if (data.instructions?.trim()) {
    added.push("instructions");
  }
  if (folders.length > 0) {
    added.push(`${folders.length} folder${folders.length === 1 ? "" : "s"}`);
  }

  if (added.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70">
        <BagIcon className="size-3.5 shrink-0" />
        <span className="truncate">Included {added.join(" and ")} from</span>
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
