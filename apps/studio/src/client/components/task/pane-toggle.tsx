import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useTaskPane, useTaskPaneActions } from "@/client/hooks/use-task-pane";
import { type TaskId } from "@instrument-org/workspace/client";
import { SidebarSimpleIcon } from "@phosphor-icons/react";

/**
 * Opens and closes the task's pane.
 *
 * One control in two places rather than two controls: the task header holds it
 * while the pane is closed, and the pane's own tab strip holds it while it is
 * open. Both are flush with the window's right edge, so it lands on the same
 * pixel either way and toggling repeatedly never moves the cursor.
 *
 * Rotated, because the icon draws a left-hand sidebar and this is the pane on
 * the right.
 */
export function PaneToggle({ taskId }: { taskId: TaskId }) {
  const pane = useTaskPane(taskId);
  const { toggle } = useTaskPaneActions(taskId);

  return (
    <Button
      aria-label={pane.open ? "Close panel" : "Open panel"}
      className={toolbarClassName({ className: "shrink-0", pressed: false })}
      onClick={toggle}
      size="icon-sm"
      variant="ghost"
    >
      <SidebarSimpleIcon className="size-4 rotate-180" />
    </Button>
  );
}
