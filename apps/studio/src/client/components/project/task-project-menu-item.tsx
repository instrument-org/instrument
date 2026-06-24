import { useOpenCreateProject } from "@/client/atoms/create-project";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { BriefcaseIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

// Renders the task's project affordance in a dropdown menu: a "Remove from
// project" item when the task is already filed, otherwise an "Add to project"
// submenu listing projects plus a "New project" entry.
export function TaskProjectMenuItem({ taskId }: { taskId: TaskId }) {
  const openCreate = useOpenCreateProject();

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

  if (currentProjectId) {
    return (
      <DropdownMenuItem
        onSelect={() => {
          void removeTask({ taskId });
        }}
      >
        <BriefcaseIcon className="size-4 text-muted-foreground" />
        Remove from project
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <BriefcaseIcon className="size-4 text-muted-foreground" />
        Add to project
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-48">
        {projects?.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => {
              void addTask({ projectId: project.id, taskId });
            }}
          >
            <BriefcaseIcon className="size-4 text-muted-foreground" />
            <span className="flex-1 truncate">{project.name}</span>
          </DropdownMenuItem>
        ))}
        {projects && projects.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onSelect={() => {
            openCreate();
          }}
        >
          <PlusIcon className="size-4 text-muted-foreground" />
          New project
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
