import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";

/** Shows or hides the pane beside a chat, and with it the chat's tabs. */
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
        <BrowsersIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
