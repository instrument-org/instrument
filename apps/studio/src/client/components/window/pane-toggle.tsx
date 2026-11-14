import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";

/**
 * Shows or hides the pane beside a chat, and with it the chat's tabs. Its mark
 * is the inbox toggle's mirrored, so the two buttons at either end of the
 * chat's head read as a pair that each open a side.
 */
export function PaneToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = isOpen ? "Hide tabs" : "Show tabs";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className={cn(
          "size-7 shrink-0",
          isOpen ? "bg-accent text-foreground" : "text-muted-foreground/70",
        )}
        onClick={onToggle}
        size="icon"
        variant="ghost-toolbar"
      >
        <SidebarSimpleIcon className="size-4" mirrored />
      </Button>
    </ToolbarTooltip>
  );
}
