import { InternalLink } from "@/client/components/internal-link";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { Input } from "@/client/components/ui/input";
import {
  contextMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { type useInlineRename } from "@/client/hooks/use-inline-rename";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { BagIcon, ChatsCircleIcon } from "@phosphor-icons/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

export function TaskBreadcrumb({
  onChatClick,
  rename,
  renderMenuItems,
  sidebar,
  task,
}: {
  onChatClick: () => void;
  rename: ReturnType<typeof useInlineRename>;
  renderMenuItems: (menuComponents: MenuComponents) => ReactNode;
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

  if (rename.isEditing) {
    return (
      <div className="flex h-8 min-w-0 max-w-80 flex-1 items-center px-1">
        <Input className="h-7 text-sm" {...rename.inputProps} />
      </div>
    );
  }

  return (
    <div
      className={toolbarClassName({
        className:
          "h-8 min-w-0 max-w-80 shrink justify-start gap-x-1 overflow-hidden px-2",
        pressed: sidebar === "chat",
      })}
    >
      {projectId && project && (
        <>
          {/*
            Project icon as its own shrink-0 chip: it can never be squeezed away
            or overlapped, however tight the breadcrumb gets.
          */}
          <InternalLink
            className="flex shrink-0 items-center"
            openInCurrentTab
            params={{ id: projectId }}
            to="/projects/$id"
          >
            <BagIcon className="size-4" />
          </InternalLink>
          {/*
            Project name. min-w-0 must be on the link itself, not just the inner
            span: nested-flex truncation needs min-w-0 on every ancestor, or the
            link stays stuck at its content width and the task title truncates
            instead. shrink-[9999] makes the name truncate before the task.
          */}
          <InternalLink
            className="flex min-w-0 shrink-[9999] items-center"
            openInCurrentTab
            params={{ id: projectId }}
            to="/projects/$id"
          >
            <span className="min-w-0 truncate">{project.name}</span>
          </InternalLink>
          {/*
            Separator stays with the task title — a standalone shrink-0 element
            so it remains visible even after the project name fully collapses.
          */}
          <span className="shrink-0 text-gray-400">/</span>
        </>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className="flex min-w-0 items-center gap-x-2 truncate text-left"
            onClick={sidebar === "files" ? onChatClick : undefined}
            onDoubleClick={() => {
              rename.start();
            }}
            type="button"
          >
            {!hasProject && <ChatsCircleIcon className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{task.title}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {renderMenuItems(contextMenuComponents)}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
