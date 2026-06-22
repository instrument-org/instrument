import { DeleteWithProgressDialog } from "@/client/components/delete-with-progress-dialog";
import { useTrashApp } from "@/client/hooks/use-trash-app";
import { getTrashTerminology } from "@/client/lib/trash-terminology";
import { type Task } from "@instrument-org/workspace/client";
import { toast } from "sonner";

import { TaskStatsCard } from "./stats-card";

export function TaskDeleteDialog({
  navigateOnDelete,
  onDeleteEnd,
  onDeleteStart,
  onOpenChange,
  open,
  task,
}: {
  navigateOnDelete: boolean;
  onDeleteEnd?: () => void;
  onDeleteStart?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  task: Task;
}) {
  const { trashApp } = useTrashApp({ navigateOnDelete });
  const trashTerminology = getTrashTerminology();

  const handleDelete = async () => {
    try {
      onDeleteStart?.();
      await trashApp(task.id);
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
      onOpenChange={onOpenChange}
      open={open}
      title="Delete task?"
    />
  );
}
