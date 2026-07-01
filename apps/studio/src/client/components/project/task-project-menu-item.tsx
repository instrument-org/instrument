import { openCreateProject } from "@/client/atoms/project-modal";
import { type MenuComponents } from "@/client/components/ui/menu-components";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId, type TaskId } from "@instrument-org/workspace/client";
import { BagIcon, PlusIcon, XCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export function TaskProjectMenuItem({
  currentProjectId,
  menuComponents,
  taskId,
}: {
  currentProjectId: null | ProjectId | undefined;
  menuComponents: MenuComponents;
  taskId: TaskId;
}) {
  const { Item, Separator, Sub, SubContent, SubTrigger } = menuComponents;

  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const { mutateAsync: addTask } = useMutation(
    rpcClient.workspace.project.addTask.mutationOptions({
      onError: (error) => {
        toast.error("Failed to add task to project", {
          description: error.message,
        });
      },
    }),
  );

  const { mutateAsync: removeTask } = useMutation(
    rpcClient.workspace.project.removeTask.mutationOptions({
      onError: (error) => {
        toast.error("Failed to remove task from project", {
          description: error.message,
        });
      },
    }),
  );

  const targetProjects = (projects ?? []).filter(
    (project) => project.id !== currentProjectId,
  );

  return (
    <>
      <Sub>
        <SubTrigger>
          <BagIcon className="size-4 text-muted-foreground" />
          {currentProjectId ? "Move to project" : "Add to project"}
        </SubTrigger>
        <SubContent className="min-w-48">
          {targetProjects.map((project) => (
            <Item
              key={project.id}
              onSelect={() => {
                void addTask({ projectId: project.id, taskId });
              }}
            >
              <BagIcon className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{project.name}</span>
            </Item>
          ))}
          {targetProjects.length > 0 && <Separator />}
          <Item
            onSelect={() => {
              openCreateProject(taskId);
            }}
          >
            <PlusIcon className="size-4 text-muted-foreground" />
            New project
          </Item>
        </SubContent>
      </Sub>
      {currentProjectId && (
        <Item
          onSelect={() => {
            void removeTask({ taskId });
          }}
        >
          <XCircleIcon className="size-4 text-muted-foreground" />
          Remove from project
        </Item>
      )}
    </>
  );
}
