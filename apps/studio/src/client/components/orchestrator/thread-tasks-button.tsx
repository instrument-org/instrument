import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";

/**
 * The fixed control at the strip's end that shows the thread's tasks in the
 * pane: a list scoped to this thread as the pane's face over whatever tab is
 * up, never a tab of its own, so it is one press from wherever the pane is
 * and nothing to close afterward. Pressed while the face is up; pressing it
 * again puts it away.
 */
export function ThreadTasksButton({
  isOpen,
  onOpen,
}: {
  /** Whether the thread's task list is the pane's face. */
  isOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <ToolbarTooltip label="Tasks">
      <Button
        aria-label="Tasks"
        aria-pressed={isOpen}
        className={toolbarClassName({ className: "shrink-0", pressed: isOpen })}
        onClick={onOpen}
        size="icon-sm"
        variant="ghost"
      >
        <ListChecksIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
