import { InternalLink } from "@/client/components/internal-link";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { BagIcon, ChatsCircleIcon } from "@phosphor-icons/react";
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
  // A projectId can dangle after its project is deleted; fall back to the chat
  // icon whenever the project chip itself does not resolve.
  const hasProject = Boolean(projectId && project);

  return (
    <div
      className={toolbarClassName({
        className: "h-8 min-w-0 max-w-80 shrink justify-start gap-x-1 px-2",
        pressed: sidebar === "chat",
      })}
    >
      {projectId && project && (
        <>
          {/*
            Two self-contained project chips toggled by the toolbar's container
            width, so each lays out cleanly on its own rather than degrading by
            hiding sub-parts. Wide: icon + name + separator (name truncates
            first via shrink-[9999]). Narrow: icon only, with breathing room
            before the task title.
          */}
          <span className="hidden min-w-0 shrink-[9999] items-center gap-x-1 @min-[520px]:flex">
            <InternalLink
              className="flex min-w-0 items-center gap-x-1"
              openInCurrentTab
              params={{ id: projectId }}
              to="/projects/$id"
            >
              <BagIcon className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{project.name}</span>
            </InternalLink>
            <span className="shrink-0 text-gray-400">/</span>
          </span>

          <InternalLink
            className="mr-1 flex shrink-0 items-center @min-[520px]:hidden"
            openInCurrentTab
            params={{ id: projectId }}
            to="/projects/$id"
          >
            <BagIcon className="size-4 shrink-0" />
          </InternalLink>
        </>
      )}
      <button
        className="flex min-w-0 items-center gap-x-2 truncate text-left"
        onClick={sidebar === "files" ? onChatClick : undefined}
        type="button"
      >
        {!hasProject && <ChatsCircleIcon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
      </button>
    </div>
  );
}
