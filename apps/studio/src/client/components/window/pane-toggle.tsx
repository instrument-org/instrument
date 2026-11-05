import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";

/**
 * Shows or hides the pane beside a chat, and with it the chat's tabs. Closed, it
 * says how many tabs the chat has, since nothing else on screen does.
 */
export function PaneToggle({
  count,
  isOpen,
  onToggle,
}: {
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = isOpen ? "Hide tabs" : "Show tabs";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className="h-7 min-w-7 shrink-0 gap-1 px-1.5 text-muted-foreground/70"
        onClick={onToggle}
        variant="ghost-toolbar"
      >
        <SidebarSimpleIcon className="size-4 -scale-x-100" />
        {!isOpen && count > 0 && (
          <span className="text-xs tabular-nums">{count}</span>
        )}
      </Button>
    </ToolbarTooltip>
  );
}
