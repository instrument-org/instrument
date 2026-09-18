import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";

/** The address of a thread's own task list, which the strip's button opens or brings forward. */
export function threadTasksHref(sessionId: string) {
  return `/orchestrator/tasks?thread=${encodeURIComponent(sessionId)}`;
}

/**
 * The fixed control at the strip's end that shows the thread's tasks in the
 * pane: a list scoped to this thread, brought forward if it is already among
 * the tabs and opened as one otherwise, so it is one press from wherever the
 * pane is. Pressed while the list is the tab on screen. The window's badge
 * still opens every task across the app.
 */
export function ThreadTasksButton({
  isOpen,
  onOpen,
}: {
  /** Whether the thread's task list is the tab on screen. */
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
