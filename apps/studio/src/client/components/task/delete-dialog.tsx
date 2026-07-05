import { DeleteWithProgressDialog } from "@/client/components/delete-with-progress-dialog";
import { useTrashTask } from "@/client/hooks/use-trash-task";
import { getTrashTerminology } from "@/client/lib/trash-terminology";
import { type Task } from "@instrument-org/workspace/client";
import { toast } from "sonner";

import { TaskStatsCard } from "./stats-card";

export function TaskDeleteDialog({
  onDeleteEnd,
  onDeleteStart,
  onExitComplete,
  onOpenChange,
  open,
  task,
}: {
  onDeleteEnd?: () => void;
  onDeleteStart?: () => void;
  onExitComplete?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  task: Task;
}) {
  const { trashTask } = useTrashTask();
  const trashTerminology = getTrashTerminology();

  const handleDelete = async () => {
    try {
      onDeleteStart?.();
      await trashTask(task.id);
    } catch {
      toast.error("Failed to delete task", {
        description:
          "Please close any external applications that might be using this folder (editors, terminals, servers, etc.) and try again.",
      });
      throw new Error("Failed to delete task");
    } finally {
      onDeleteEnd?.();
    }
  };

  return (
    <DeleteWithProgressDialog
      content={<TaskStatsCard task={task} />}
      description={`This task will be moved to your system ${trashTerminology}. You can restore it from there if needed.`}
      items={[task]}
      onDelete={handleDelete}
      onExitComplete={onExitComplete}
      onOpenChange={onOpenChange}
      open={open}
      title="Delete task?"
    />
  );
}
