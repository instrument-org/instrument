import { InternalLink } from "@/client/components/internal-link";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { BagIcon } from "@phosphor-icons/react";
import { skipToken, useQuery } from "@tanstack/react-query";

export function TaskBreadcrumb({
  onChatClick,
  sidebar,
  task,
}: {
  onChatClick: () => void;
  sidebar: "chat" | "files";
  task: Task;
}) {
  const projectId = task.projectId;
  const { data: project } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({
      input: projectId ? { id: projectId } : skipToken,
    }),
  );

  return (
    <div
      className={toolbarClassName({
        className: "h-8 min-w-0 max-w-80 shrink justify-start gap-x-1 px-2",
        pressed: sidebar === "chat",
      })}
    >
      {projectId && project && (
        <>
          <InternalLink
            className="flex min-w-0 items-center gap-x-1 truncate"
            openInCurrentTab
            params={{ id: projectId }}
            to="/projects/$id"
          >
            <BagIcon className="size-4 shrink-0" />
            <span className="truncate">{project.name}</span>
          </InternalLink>
          <span className="shrink-0 text-gray-400">/</span>
        </>
      )}
      <button
        className="min-w-0 flex-1 truncate text-left"
        onClick={sidebar === "files" ? onChatClick : undefined}
        type="button"
      >
        {task.title}
      </button>
    </div>
  );
}
