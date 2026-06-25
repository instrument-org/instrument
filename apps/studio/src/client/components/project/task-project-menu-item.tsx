import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { openCreateProject } from "@/client/lib/open-create-project";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { BagIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export function TaskProjectMenuItem({ taskId }: { taskId: TaskId }) {
  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const { data: tasksData } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions(),
  );
  const currentProjectId = tasksData?.tasks.find(
    (task) => task.id === taskId,
  )?.projectId;

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
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <BagIcon className="size-4 text-muted-foreground" />
          {currentProjectId ? "Move to project" : "Add to project"}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-48">
          {targetProjects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => {
                void addTask({ projectId: project.id, taskId });
              }}
            >
              <BagIcon className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{project.name}</span>
            </DropdownMenuItem>
          ))}
          {targetProjects.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onSelect={() => {
              openCreateProject(taskId);
            }}
          >
            <PlusIcon className="size-4 text-muted-foreground" />
            New project
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {currentProjectId && (
        <DropdownMenuItem
          onSelect={() => {
            void removeTask({ taskId });
          }}
        >
          <BagIcon className="size-4 text-muted-foreground" />
          Remove from project
        </DropdownMenuItem>
      )}
    </>
  );
}
